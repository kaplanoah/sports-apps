import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";
import { settle } from "./settle.js";

const SCOPE = "https://mlb-app.example.workers.dev/k3y/";
const OLD_ENDPOINT = "https://web.push.apple.com/old";
const NEW_ENDPOINT = "https://web.push.apple.com/new";

// The Worker serves the shared page files under shared/, beside each app's own.
const readPageFile = (app, path) =>
  readRepoFile(
    path.startsWith("shared/")
      ? `shared/page/${path.slice("shared/".length)}`
      : `apps/${app}/page/${path}`,
  );

/**
 * A browser's cache of responses, in memory, with the parts of the cache API the worker uses.
 * @param {(request: any) => Promise<Response>} fetch
 */
function createCacheStorage(fetch) {
  const caches = new Map();
  // Caches whose reads fail, as a phone's storage can.
  const unreadable = new Set();
  const readKey = (request) => (typeof request === "string" ? request : request.url);
  const openCache = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const entries = caches.get(name);
    return {
      match: async (request) => {
        if (unreadable.has(name)) throw new DOMException("The storage is gone", "UnknownError");
        return entries.get(readKey(request))?.clone();
      },
      put: async (request, response) => void entries.set(readKey(request), response),
      addAll: async (requests) => {
        const responses = await Promise.all(requests.map((request) => fetch(request)));
        if (responses.some((response) => !response.ok)) throw new TypeError("a file failed");
        responses.forEach((response, index) => entries.set(readKey(requests[index]), response));
      },
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (request) => entries.delete(readKey(request)),
    };
  };
  return {
    open: async (name) => openCache(name),
    match: async (request, { cacheName }) =>
      caches.has(cacheName) ? openCache(cacheName).match(request) : undefined,
    delete: async (name) => caches.delete(name),
    listKept: (name) => [...(caches.get(name)?.keys() ?? [])],
    breakReads: (name) => unreadable.add(name),
  };
}

const answerPublicKey = (publicKey) => async () => new Response(JSON.stringify({ publicKey }));

// Runs an app's service worker with stand-ins for what the browser gives it.
function startServiceWorker({ publicKey = "AQID_w", app = "mlb", answer = null } = {}) {
  const listeners = {};
  const requests = [];
  const subscribed = [];
  const createSubscription = (endpoint) => ({
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  });
  const answerRequest = answer ?? answerPublicKey(publicKey);
  const fetch = async (request, init = {}) => {
    const url = typeof request === "object" && "url" in request ? request.url : String(request);
    requests.push({
      url,
      method: init.method || "GET",
      body: init.body,
      referrerPolicy: init.referrerPolicy,
    });
    return answerRequest(url);
  };
  const caches = createCacheStorage(fetch);
  const shown = [];
  const windows = [];
  const opened = [];
  const self = {
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => {
        opened.push(url);
      },
    },
    skipWaiting: async () => {},
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
    registration: {
      scope: SCOPE,
      showNotification: async (title, options) => shown.push({ title, ...options }),
      pushManager: {
        subscribe: async (options) => {
          subscribed.push(options);
          return createSubscription(NEW_ENDPOINT);
        },
      },
    },
  };
  const context = createContext({ self, fetch, caches, URL, JSON, atob, Response });
  context.importScripts = (...paths) =>
    paths.forEach((path) => runInContext(readPageFile(app, path), context));
  runInContext(readPageFile(app, "sw.js"), context);
  const noteWorkerStep = runInContext("noteWorkerStep", context);
  // The steps the worker kept so far, once its writes have landed.
  const readSteps = async () => {
    await runInContext("writing", context);
    const kept = await caches.match(`${SCOPE}service-worker-steps`, {
      cacheName: "service-worker-steps",
    });
    return kept ? (await kept.json()).map(({ text }) => text) : [];
  };
  // A worker can extend an event while it handles it, so each wait is read as it's added.
  const finish = async (waiting) => {
    for (let index = 0; index < waiting.length; index++) await waiting[index];
  };
  const startEvent = (type, fields) => {
    const waiting = [];
    for (const listener of listeners[type] ?? [])
      listener({ ...fields, waitUntil: (promise) => waiting.push(promise) });
    return waiting;
  };
  const dispatch = (type, fields) => finish(startEvent(type, fields));
  // What the worker answers for a request, or null when it leaves the request to the browser.
  const request = async (url, { mode = "no-cors", method = "GET", destination = "" } = {}) => {
    let answered = null;
    const waiting = startEvent("fetch", {
      request: { url, mode, method, destination },
      respondWith: (promise) => (answered = promise),
    });
    const response = answered && (await answered);
    await finish(waiting);
    return response;
  };
  // What the worker answers a page that asks it to read the page again.
  const refreshCopy = async () => {
    let answer = null;
    await dispatch("message", {
      data: { type: "refreshPageCopy" },
      ports: [{ postMessage: (message) => (answer = message) }],
    });
    return answer;
  };
  // A page leaving the screen names the pictures from other sites it showed.
  const keepImages = (urls) =>
    dispatch("message", { data: { type: "keepImages", urls }, ports: [] });
  return {
    dispatch,
    request,
    refreshCopy,
    keepImages,
    noteWorkerStep,
    readSteps,
    caches,
    requests,
    subscribed,
    shown,
    windows,
    opened,
    createSubscription,
  };
}

const listSubscriptionRequests = (requests) =>
  requests
    .filter(({ url }) => url === `${SCOPE}push/subscription`)
    .map(({ method, body }) => [method, JSON.parse(body).endpoint]);

test("a subscription the browser replaced is saved, and the old one removed", async () => {
  const worker = startServiceWorker();
  await worker.dispatch("pushsubscriptionchange", {
    oldSubscription: worker.createSubscription(OLD_ENDPOINT),
    newSubscription: worker.createSubscription(NEW_ENDPOINT),
  });
  assert.deepEqual(listSubscriptionRequests(worker.requests), [
    ["PUT", NEW_ENDPOINT],
    ["DELETE", OLD_ENDPOINT],
  ]);
});

test("a replaced subscription the Worker won't save keeps the old one, and fails the change", async () => {
  const worker = startServiceWorker({
    answer: async (url) =>
      url === `${SCOPE}push/subscription`
        ? new Response("", { status: 503 })
        : answerPublicKey("AQID_w")(),
  });

  await assert.rejects(
    worker.dispatch("pushsubscriptionchange", {
      oldSubscription: worker.createSubscription(OLD_ENDPOINT),
      newSubscription: worker.createSubscription(NEW_ENDPOINT),
    }),
    /answered 503/,
  );
  assert.deepEqual(listSubscriptionRequests(worker.requests), [["PUT", NEW_ENDPOINT]]);
});

test("a subscription the browser dropped is made again with the Worker's key", async () => {
  const worker = startServiceWorker({ publicKey: "AQID_w" });
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
  const [options] = worker.subscribed;
  assert.equal(options.userVisibleOnly, true);
  assert.deepEqual([...options.applicationServerKey], [1, 2, 3, 255]);
  assert.deepEqual(listSubscriptionRequests(worker.requests), [["PUT", NEW_ENDPOINT]]);
});

test("a push shows its message, and one that can't be read shows the app's name", async () => {
  for (const [app, pageName] of [
    ["mlb", "MLB"],
    ["wnba", "WNBA"],
  ]) {
    const worker = startServiceWorker({ app });
    const message = { title: "The Dream beat the Mystics 84-79", body: "", tag: "final:1" };
    await worker.dispatch("push", { data: { json: () => message } });
    await worker.dispatch("push", {
      data: {
        json: () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      },
    });
    assert.deepEqual(
      worker.shown.map(({ title }) => title),
      [message.title, pageName],
    );
  }
});

const writePage = (commit) => `<!doctype html>
  <link rel="stylesheet" href="release/${commit}/styles.css" />
  <link rel="stylesheet" href="https://fonts.example/text.css" />
  <link rel="icon" href="icon.svg" />
  <link rel="modulepreload" href="release/${commit}/js/app.js" />
  <script type="module" src="release/${commit}/js/app.js"></script>
`;
const GATE = "<h1>Access code</h1>";
const STYLESHEET = `@font-face { src: url("fonts/text.woff2") format("woff2"); }
:root { --select-arrow: url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E"); }
`;

/**
 * The Worker as the service worker reaches it, on one release at a time, or not at all, with the
 * files of any `earlier` releases still there, as while a deploy reaches each server, and each
 * file `held` answering only once its promise settles.
 * @param {{ release: string, earlier?: string[], held?: Map<string, Promise<void>>, pageStatus?: number, isOffline?: boolean, isSignedOut?: boolean, missing?: Set<string> }} server
 */
const serveRelease = (server) => async (url) => {
  if (server.isOffline) throw new TypeError("Failed to fetch");
  await server.held?.get(url.slice(SCOPE.length));
  if (url === SCOPE && server.pageStatus) return new Response("", { status: server.pageStatus });
  if (url === SCOPE && server.isSignedOut)
    return new Response(GATE, { headers: { "cache-control": "no-store" } });
  if (url === SCOPE)
    return new Response(writePage(server.release), { headers: { "cache-control": "no-cache" } });
  const path = url.slice(SCOPE.length);
  const isServed = [server.release, ...(server.earlier ?? [])].some((release) =>
    path.startsWith(`release/${release}/`),
  );
  if (isServed && !server.missing?.has(path))
    return new Response(path.endsWith(".css") ? STYLESHEET : `file ${path}`);
  return new Response("Not found", { status: 404 });
};

const NAVIGATION = { mode: "navigate" };
const IMAGE = { destination: "image" };

/** @param {ReturnType<typeof startServiceWorker>} worker */
const readCopy = async (worker) => {
  const copy = await worker.caches.match(SCOPE, { cacheName: "page" });
  return copy ? copy.text() : null;
};

/** @param {string} commit */
const listReleaseFiles = (commit) =>
  [
    SCOPE,
    `${SCOPE}release/${commit}/fonts/text.woff2`,
    `${SCOPE}release/${commit}/js/app.js`,
    `${SCOPE}release/${commit}/styles.css`,
  ].sort();

/** @param {ReturnType<typeof startServiceWorker>} worker */
const listKept = (worker) => worker.caches.listKept("page").sort();

test("the page is kept with every file of its own it loads, and opens whole from the copy offline", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.deepEqual(listKept(worker), listReleaseFiles("a"));

  server.isOffline = true;

  assert.equal(
    await (await worker.request(`${SCOPE}index.html`, NAVIGATION)).text(),
    writePage("a"),
  );
  const code = await worker.request(`${SCOPE}release/a/js/app.js`);
  assert.equal(await code.text(), "file release/a/js/app.js");
});

test("a newer page replaces the copy only once all its files are kept, and the old ones go", async () => {
  const server = { release: "a", missing: new Set() };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  server.missing.add("release/b/js/app.js");

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.equal(await readCopy(worker), writePage("a"));
  server.missing.clear();

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  assert.equal(await readCopy(worker), writePage("b"));
  assert.deepEqual(listKept(worker), listReleaseFiles("b"));
});

test("a page the Worker can't answer leaves the copy as it was", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  Object.assign(server, { release: "b", pageStatus: 503 });

  await worker.request(SCOPE, NAVIGATION);

  assert.equal(await readCopy(worker), writePage("a"));
});

test("a signed-out phone's copy goes, so its next open shows the gate", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.isSignedOut = true;

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));

  assert.equal(await readCopy(worker), null);
  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), GATE);
});

test("a file the copy needs that the Worker no longer has forgets the copy, and only that", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  const extraFont = await worker.request(`${SCOPE}release/a/fonts/extra.woff2`);
  assert.equal(extraFont.status, 404);
  assert.equal(await readCopy(worker), writePage("a"));
  await (await worker.caches.open("page")).delete(`${SCOPE}release/a/js/app.js`);

  const code = await worker.request(`${SCOPE}release/a/js/app.js`);

  assert.equal(code.status, 404);
  assert.equal(await readCopy(worker), null);
});

test("only the page, its own files, and other sites' pictures go through the service worker", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });
  await worker.request(SCOPE, NAVIGATION);

  for (const url of [
    `${SCOPE}version.json`,
    `${SCOPE}release/a/version.json`,
    `${SCOPE}store/seasons/2026`,
    `${SCOPE}icon-180.png`,
    "https://fonts.example/text.css",
  ])
    assert.equal(await worker.request(url), null, url);
  assert.equal(await worker.request(`${SCOPE}icon-180.png`, IMAGE), null);
  assert.equal(await worker.request(SCOPE), null);
  assert.equal(await worker.request(`${SCOPE}gate.html`, NAVIGATION), null);
  assert.equal(await worker.request(SCOPE, { ...NAVIGATION, method: "POST" }), null);
});

test("a phone gets its first copy as soon as the service worker starts", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });

  await worker.dispatch("activate", {});

  for (let turn = 0; turn < 100 && !(await readCopy(worker)); turn++) await settle();
  assert.deepEqual(listKept(worker), listReleaseFiles("a"));
});

test("a page asking for a fresh copy hears whether the copy now holds the Worker's page", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";

  assert.equal(await worker.refreshCopy(), true);
  assert.equal(await readCopy(worker), writePage("b"));

  Object.assign(server, { release: "c", isOffline: true });
  assert.equal(await worker.refreshCopy(), false);
  Object.assign(server, { isOffline: false, pageStatus: 503 });
  assert.equal(await worker.refreshCopy(), false);
  assert.equal(await readCopy(worker), writePage("b"));

  Object.assign(server, { pageStatus: undefined, isSignedOut: true });
  assert.equal(await worker.refreshCopy(), true);
  assert.equal(await readCopy(worker), null);
});

/** Lets every read and write under way land. */
async function settleWorker() {
  for (let turn = 0; turn < 100; turn++) await settle();
}

test("an open the copy can't answer yet, while the worker's first read is under way, leaves the copy whole", async () => {
  /** @type {() => void} */
  let sendFont = () => {};
  const font = new Promise((resolve) => (sendFont = () => resolve(undefined)));
  const server = {
    release: "a",
    earlier: ["a"],
    held: new Map([["release/a/fonts/text.woff2", font]]),
  };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.dispatch("activate", {});
  server.release = "b";

  const opening = worker.request(SCOPE, NAVIGATION);
  await settleWorker();
  sendFont();
  await opening;
  await settleWorker();

  const copy = await readCopy(worker);
  assert.deepEqual(listKept(worker), listReleaseFiles(copy === writePage("a") ? "a" : "b"));
});

test("a release check while a read from before the deploy is under way reads the page again, and hears whether the copy holds the newer page", async () => {
  const server = { release: "a", earlier: ["a"] };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.dispatch("activate", {});
  server.release = "b";

  assert.equal(await worker.refreshCopy(), true);

  assert.equal(await readCopy(worker), writePage("b"));
  assert.deepEqual(listKept(worker), listReleaseFiles("b"));
});

test("pages asking at once share one read of the page", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });

  await Promise.all([worker.refreshCopy(), worker.refreshCopy()]);

  assert.equal(worker.requests.filter(({ url }) => url === SCOPE).length, 1);
});

test("the next try on a weak connection reads only the files the last one missed", async () => {
  const server = { release: "a", missing: new Set() };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  server.missing.add("release/b/js/app.js");
  assert.equal(await worker.refreshCopy(), false);
  server.missing.clear();

  assert.equal(await worker.refreshCopy(), true);

  const reads = (path) => worker.requests.filter(({ url }) => url === `${SCOPE}${path}`).length;
  assert.equal(reads("release/b/styles.css"), 1);
  assert.equal(reads("release/b/js/app.js"), 2);
});

test("a font the copy's stylesheet needs that the Worker no longer has forgets the copy", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  server.release = "b";
  await (await worker.caches.open("page")).delete(`${SCOPE}release/a/fonts/text.woff2`);

  const font = await worker.request(`${SCOPE}release/a/fonts/text.woff2`);

  assert.equal(font.status, 404);
  assert.equal(await readCopy(worker), null);
});

const PHOTOS = ["a", "b", "c"].map((name) => `https://photos.example/${name}.jpg`);

/**
 * Another site's pictures, or nothing while the phone is offline.
 * @param {{ isOffline?: boolean }} server
 */
const servePhotos = (server) => async (url) => {
  if (server.isOffline) throw new TypeError("Failed to fetch");
  return new Response(`photo ${url}`);
};

test("the pictures from other sites a page last showed open from the service worker, offline too, and only those stay", async () => {
  const server = {};
  const worker = startServiceWorker({ answer: servePhotos(server) });
  await worker.keepImages([PHOTOS[0], PHOTOS[1]]);
  await worker.keepImages([PHOTOS[1], PHOTOS[2]]);

  server.isOffline = true;

  assert.equal(await (await worker.request(PHOTOS[1], IMAGE)).text(), `photo ${PHOTOS[1]}`);
  assert.deepEqual(worker.caches.listKept("images").sort(), [PHOTOS[1], PHOTOS[2]]);
});

test("a picture already kept isn't read again, and none is read telling its site the page's address", async () => {
  const worker = startServiceWorker({ answer: servePhotos({}) });

  await worker.keepImages([PHOTOS[0]]);
  await worker.keepImages([PHOTOS[0], PHOTOS[1]]);

  assert.deepEqual(worker.requests, [
    { url: PHOTOS[0], method: "GET", body: undefined, referrerPolicy: "no-referrer" },
    { url: PHOTOS[1], method: "GET", body: undefined, referrerPolicy: "no-referrer" },
  ]);
});

test("a picture from another site that isn't kept is read from its site, and one that fails isn't kept", async () => {
  const server = {};
  const worker = startServiceWorker({ answer: servePhotos(server) });

  assert.equal(await (await worker.request(PHOTOS[0], IMAGE)).text(), `photo ${PHOTOS[0]}`);
  server.isOffline = true;
  await worker.keepImages([PHOTOS[1]]);

  assert.deepEqual(worker.caches.listKept("images"), []);
});

test("a copy the phone can't read is passed over for the Worker, which answers in its place, and the worker says so", async () => {
  const server = { release: "a", missing: new Set(["release/a/fonts/extra.woff2"]) };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  await worker.request(SCOPE, NAVIGATION);
  await worker.keepImages([PHOTOS[0]]);
  worker.caches.breakReads("page");
  worker.caches.breakReads("images");

  assert.equal(await (await worker.request(SCOPE, NAVIGATION)).text(), writePage("a"));
  const code = await worker.request(`${SCOPE}release/a/js/app.js`);
  assert.equal(await code.text(), "file release/a/js/app.js");
  const missing = await worker.request(`${SCOPE}release/a/fonts/extra.woff2`);
  assert.equal(missing.status, 404);
  assert.equal(await readCopy(worker).catch(() => "unreadable"), "unreadable");
  await worker.request(PHOTOS[0], IMAGE);
  assert.equal(worker.requests.filter(({ url }) => url === PHOTOS[0]).length, 2);

  assert.deepEqual(
    (await worker.readSteps()).filter((step) => !step.startsWith("Opened the page from the copy")),
    [
      "Started",
      "Opened the page from the Worker",
      "Couldn't read the page from the copy: The storage is gone",
      "Opened the page from the Worker",
      "Couldn't read app.js from the copy: The storage is gone",
      "Couldn't read extra.woff2 from the copy: The storage is gone",
      "Couldn't check the copy for extra.woff2: The storage is gone",
      "Couldn't read a.jpg from the copy: The storage is gone",
    ],
  );
});

test("the worker keeps its last steps for Diagnostics: each start, install, activation, and push, and each page it opened and how", async () => {
  const server = { release: "a" };
  const worker = startServiceWorker({ answer: serveRelease(server) });
  assert.deepEqual(await worker.readSteps(), ["Started"]);

  await worker.request(SCOPE, NAVIGATION);
  await worker.request(SCOPE, NAVIGATION);
  await worker.dispatch("install", {});
  await worker.dispatch("activate", {});
  await worker.dispatch("push", { data: { json: () => ({ title: "Final", body: "", tag: "f" }) } });
  await (await worker.caches.open("page")).delete(SCOPE);
  server.pageStatus = 503;
  await worker.request(SCOPE, NAVIGATION);
  Object.assign(server, { pageStatus: undefined, isOffline: true });
  await assert.rejects(worker.request(SCOPE, NAVIGATION), /Failed to fetch/);

  assert.deepEqual(await worker.readSteps(), [
    "Started",
    "Opened the page from the Worker",
    "Opened the page from the copy",
    "Installed",
    "Activated",
    "Push received",
    "Opened the page from the Worker, which answered 503",
    "Couldn't open the page: Failed to fetch",
  ]);
});

test("the worker keeps its last 60 steps", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });
  for (let step = 1; step <= 70; step += 1) worker.noteWorkerStep(`step ${step}`);

  const steps = await worker.readSteps();

  assert.equal(steps.length, 60);
  assert.equal(steps[0], "step 11");
  assert.equal(steps.at(-1), "step 70");
});

test("the page reads the steps the worker kept at the same address, and forgets them with Diagnostics", async () => {
  const worker = startServiceWorker({ answer: serveRelease({ release: "a" }) });
  await worker.request(SCOPE, NAVIGATION);
  const { readServiceWorkerSteps, forgetServiceWorkerSteps } =
    await import("../shared/page/service-worker.js");
  Object.assign(globalThis, { caches: worker.caches, location: { href: `${SCOPE}index.html` } });
  try {
    assert.deepEqual(
      (await readServiceWorkerSteps()).map(({ text }) => text),
      ["Started", "Opened the page from the Worker"],
    );
    await forgetServiceWorkerSteps();
    assert.deepEqual(await readServiceWorkerSteps(), []);
  } finally {
    Reflect.deleteProperty(globalThis, "caches");
    Reflect.deleteProperty(globalThis, "location");
  }
});

test("a service worker that failed to register is registered again the next time the page asks", async (t) => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  });
  const answers = [
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => Promise.resolve("registered"),
  ];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: { register: () => /** @type {() => Promise<string>} */ (answers.shift())() },
    },
  });
  const { registerServiceWorker } = await import("../shared/page/service-worker.js");

  await assert.rejects(registerServiceWorker(), /Failed to fetch/);

  assert.equal(await registerServiceWorker(), "registered");
  assert.equal(await registerServiceWorker(), "registered");
});

test("a reminder retains its game intent, opens a safe launch URL and navigates an existing client", async () => {
  for (const app of ["mlb", "wnba"]) {
    const worker = startServiceWorker({ app });
    const message = {
      title: "Away @ Home starting now on FOX",
      game: "123",
      season: 2026,
      tag: "game-reminder:123",
    };
    await worker.dispatch("push", { data: { json: () => message } });
    assert.deepEqual(JSON.parse(JSON.stringify(worker.shown[0].data)), {
      game: "123",
      season: 2026,
    });
    const notification = { data: worker.shown[0].data, close() {} };
    await worker.dispatch("notificationclick", { notification });
    assert.deepEqual(worker.opened, [`${SCOPE}?game=123&season=2026`]);
    const steps = [];
    worker.windows.push({
      url: `${SCOPE}?theme=dark`,
      navigate: async (url) => steps.push(url),
      focus: async () => steps.push("focus"),
    });
    await worker.dispatch("notificationclick", { notification });
    assert.deepEqual(steps, [`${SCOPE}?game=123&season=2026`, "focus"]);
    assert.equal(worker.opened.length, 1);
  }
});

test("notification navigation rejects foreign URLs and malformed game intents", async () => {
  for (const game of ["https://elsewhere.example/", "../other", "123?next=elsewhere", "", null]) {
    const worker = startServiceWorker();
    await worker.dispatch("notificationclick", {
      notification: { data: { game, season: 2026 }, close() {} },
    });
    assert.deepEqual(worker.opened, [SCOPE]);
  }
});

test("endpoint renewal sends the old subscription proof so the server can preserve preferences and receipts", async () => {
  const worker = startServiceWorker();
  const previous = worker.createSubscription(OLD_ENDPOINT);
  await worker.dispatch("pushsubscriptionchange", {
    oldSubscription: previous,
    newSubscription: worker.createSubscription(NEW_ENDPOINT),
  });
  assert.deepEqual(JSON.parse(worker.requests[0].body).previousSubscription, previous.toJSON());
});
