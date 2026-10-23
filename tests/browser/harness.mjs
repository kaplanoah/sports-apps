import { test as base, expect } from "@playwright/test";
import { escapePattern } from "../../shared/page/escape-pattern.js";
import { createDurableObjectContext } from "../durable-object-context.js";

/** @type {import("@playwright/test").Fixtures<{ pageErrors: string[] }, {}, import("@playwright/test").PlaywrightTestArgs>} */
const pageErrorsFixture = {
  pageErrors: [
    async ({ page }, use) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
};

export const test = base.extend(pageErrorsFixture);
export { expect };

/**
 * An app's store in a stand-in Durable Object, holding `stored`, whose clock starts at `now`, and
 * whose pushes all succeed, as does every other request but what `fetchImpl` answers.
 * `fireAlarm` runs its next update, `passTime` moves its clock on, and `acceptWatcher` opens a
 * page's socket through the store, as the Worker does, so the page hears what the store says as it
 * opens, which `countAccepted` counts once the page has heard it.
 * @template {{ fetch: (request: Request) => Promise<Response>, webSocketMessage: (socket: any, message: string | Buffer) => void, alarm: () => Promise<void> }} Store
 * @param {new (ctx: any, env: object, options: object) => Store} SeasonStore the app's store class
 * @param {object} options
 * @param {(season: string) => Promise<object>} options.loadSnapshot
 * @param {string} options.now
 * @param {Record<string, unknown>} [options.stored] documents by path
 * @param {(url: string) => Promise<Response>} [options.fetchImpl] what the store's own jobs read
 */
export function createTestStore(
  SeasonStore,
  { loadSnapshot, now, stored = {}, fetchImpl = async () => new Response(null, { status: 201 }) },
) {
  const context = createDurableObjectContext();
  for (const [path, data] of Object.entries(stored)) context.stored.set(path, data);
  const clock = { now: Date.parse(now) };
  // The page's sockets the store accepts next, in the order the page opened them.
  const arriving = [];
  let acceptedCount = 0;
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      createLoadSnapshot: () => loadSnapshot,
      now: () => clock.now,
      fetchImpl,
      openSocket: (ctx) => {
        const socket = arriving.shift();
        ctx.acceptWebSocket(socket);
        return { socket, response: new Response(null) };
      },
    },
  );
  // The store's next update runs when its alarm comes due, so firing it moves the clock there.
  const fireAlarm = async () => {
    clock.now = Math.max(clock.now, (await context.ctx.storage.getAlarm()) ?? clock.now);
    await store.alarm();
  };
  /** @param {{ send: (message: string) => void }} socket */
  const acceptWatcher = async (socket) => {
    arriving.push(socket);
    await store.fetch(new Request("https://store/watch", { headers: { upgrade: "websocket" } }));
    acceptedCount += 1;
  };
  /** @param {number} ms */
  const passTime = (ms) => {
    clock.now += ms;
  };
  const countAccepted = () => acceptedCount;
  return { context, store, fireAlarm, passTime, acceptWatcher, countAccepted };
}

/**
 * What a test does on the Worker's side of `testStore`: run the update its alarm runs on its own
 * schedule, pass time while the page sleeps, which brings its next update due, and count the
 * sockets it has accepted, each once it has told the page whether an update is coming.
 * @param {ReturnType<typeof createTestStore>} testStore
 */
export const createWorkerControls = (testStore) => ({
  updateFromWorker: () => testStore.fireAlarm(),
  /** @param {number} ms */
  passTimeAtWorker: (ms) => testStore.passTime(ms),
  countWatchersHeard: () => testStore.countAccepted(),
});

// Routes match with patterns rather than functions: Playwright checks a pattern itself, but asks the
// test about every request a function might match, which slows every page load.
export const TEST_SERVER = /^http:\/\/127\.0\.0\.1[:/]/;
const OTHER_HOSTS = /^https?:\/\/(?!127\.0\.0\.1[:/])/;

/**
 * Matches requests for `path`, whatever their query, or for anything under it when it ends with a
 * slash.
 * @param {string} path
 */
export function matchPath(path) {
  const end = path.endsWith("/") ? "" : "(?:[?#]|$)";
  return new RegExp(`^\\w+://[^/]+${escapePattern(path)}${end}`);
}

/** @param {import("@playwright/test").Page} page */
const blockOtherHosts = (page) => page.route(OTHER_HOSTS, (route) => route.abort());

/**
 * @param {import("@playwright/test").Route} route
 * @param {{ fetch: (request: Request) => Promise<Response> }} store
 */
async function answerFromStore(route, store) {
  const request = route.request();
  const answer = await store.fetch(
    new Request(request.url(), {
      method: request.method(),
      headers: request.headers(),
      body: request.postData() ?? undefined,
    }),
  );
  await route.fulfill({
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Parameters<typeof answerFromStore>[1]} store
 */
async function routeStoreRequests(page, store) {
  await page.route(matchPath("/store/"), (route) => answerFromStore(route, store));
  await page.route(matchPath("/push/"), (route) => answerFromStore(route, store));
}

/**
 * @template Item
 * @param {Item[]} list
 * @param {Item} item
 */
function removeItem(list, item) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {ReturnType<typeof createTestStore>} testStore
 * @returns {Promise<import("@playwright/test").WebSocketRoute[]>} the sockets the page has open
 */
async function routeWatchSockets(page, { context, store, acceptWatcher }) {
  const openSockets = [];
  await page.routeWebSocket(
    (url) => url.pathname === "/watch",
    (socket) => {
      let attachment = null;
      const accepted = {
        send: (message) => socket.send(message),
        serializeAttachment: (value) => {
          attachment = structuredClone(value);
        },
        deserializeAttachment: () => attachment,
      };
      openSockets.push(socket);
      let isClosed = false;
      const forget = () => removeItem(context.ctx.getWebSockets(), accepted);
      socket.onMessage((message) => store.webSocketMessage(accepted, message));
      socket.onClose(() => {
        isClosed = true;
        removeItem(openSockets, socket);
        forget();
      });
      // A socket the page closed before the store accepted it no longer counts as open.
      acceptWatcher(accepted).then(() => {
        if (isClosed) forget();
      });
    },
  );
  return openSockets;
}

/**
 * Keeps the page from reaching anything but the test server, and answers its store, its pushes,
 * and its watch socket from `store`. Routes added after it come first.
 * @param {import("@playwright/test").Page} page
 * @param {ReturnType<typeof createTestStore>} testStore
 */
export async function connectToStore(page, testStore) {
  await blockOtherHosts(page);
  await routeStoreRequests(page, testStore.store);
  return routeWatchSockets(page, testStore);
}

/**
 * Loads the page with its clock set to `now`. A phone's browser opens on the welcome until it's
 * closed, so a page not about it starts with it closed.
 * @param {import("@playwright/test").Page} page
 * @param {string} now
 * @param {{ isShowingWelcome?: boolean, path?: string }} [options]
 */
export async function loadPageAt(page, now, { isShowingWelcome = false, path = "/" } = {}) {
  if (!isShowingWelcome)
    await page.addInitScript(() => localStorage.setItem("homeScreenWelcomeClosed", "closed"));
  await page.clock.install({ time: new Date(now) });
  await page.goto(path);
}

const PAGE_KEY = "test-key";

/**
 * @param {import("@playwright/test").Route} route
 * @param {{ fetch: (request: Request, env: object) => Response | Promise<Response> }} worker
 * @param {object} env
 */
async function answerThroughWorker(route, worker, env) {
  const request = route.request();
  const answer = await worker.fetch(
    new Request(request.url(), {
      method: request.method(),
      headers: await request.allHeaders(),
      body: request.postData() ?? undefined,
    }),
    env,
  );
  await route.fulfill({
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
    body: Buffer.from(await answer.arrayBuffer()),
  });
}

export const LOCKED_PAGE_PATH = `/${PAGE_KEY}/`;

/** @param {URL} url */
export const isLockedWatchSocket = (url) => url.pathname === `${LOCKED_PAGE_PATH}watch`;

/**
 * Serves the page at its key's address behind an access code, with every request under the key
 * answered by `worker` in front of `testStore`, with the page's clock at `now`. With a `pageHost`,
 * the Worker also serves the page at that https host without the key, as its PAGE_HOST secret
 * names it.
 * @param {import("@playwright/test").Page} page
 * @param {object} options
 * @param {Parameters<typeof answerThroughWorker>[1]} options.worker the app's Worker
 * @param {ReturnType<typeof createTestStore>} options.testStore
 * @param {string} options.accessCode
 * @param {string} options.now
 * @param {string} [options.pageHost]
 */
export async function serveLockedPage(page, { worker, testStore, accessCode, now, pageHost }) {
  const tries = { isOverLimit: false };
  const env = {
    APP_KEY: PAGE_KEY,
    ACCESS_CODE: accessCode,
    ACCESS_SIGNING_KEY: "test-signing-key",
    ACCESS_LIMIT: { limit: async () => ({ success: !tries.isOverLimit }) },
    STORE: { idFromName: () => "store", get: () => testStore.store },
    ...(pageHost && { PAGE_HOST: pageHost }),
  };
  /** @param {import("@playwright/test").WebSocketRoute} socket */
  const acceptWatcher = (socket) =>
    testStore.acceptWatcher({ send: (message) => socket.send(message) });
  await blockOtherHosts(page);
  await page.route(matchPath(LOCKED_PAGE_PATH), (route) => answerThroughWorker(route, worker, env));
  await page.routeWebSocket(isLockedWatchSocket, acceptWatcher);
  if (pageHost) {
    await page.route(new RegExp(`^https://${escapePattern(pageHost)}/`), (route) =>
      answerThroughWorker(route, worker, env),
    );
    await page.routeWebSocket(
      new RegExp(`^wss://${escapePattern(pageHost)}/watch$`),
      acceptWatcher,
    );
  }
  await page.clock.install({ time: new Date(now) });

  return {
    /** @param {string} code */
    changeAccessCode: (code) => {
      env.ACCESS_CODE = code;
    },
    limitTries: () => {
      tries.isOverLimit = true;
    },
  };
}
