import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

const MINUTE_MS = 60 * 1000;
const NOW = Date.parse("2026-10-22T16:00:00Z");
const PAGE_CODE = "shared/page/";
const OLD_ADDRESS = "https://mlb-app.example-subdomain.workers.dev/k3y/";
const NEW_ADDRESS = "https://mlb.sports.example/";
const HANDOFF_ADDRESS = `${NEW_ADDRESS}access/handoff?token=t0ken`;

/** @param {Record<string, string>} entries */
function createStorage(entries = {}) {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

/**
 * The plain script as a page's head runs it, at `href`, with what pick-theme.js gives it.
 * @param {{ href?: string, stored?: Record<string, string>, isOnHomeScreen?: boolean,
 *   isAppleBrowser?: boolean, isMoving?: boolean, answer?: () => Promise<Response> }} [page]
 */
function loadPageMove({
  href = OLD_ADDRESS,
  stored = {},
  isOnHomeScreen = false,
  isAppleBrowser = true,
  isMoving = true,
  answer = async () => Response.json({ address: HANDOFF_ADDRESS, expiresInMs: 10 * MINUTE_MS }),
} = {}) {
  const localStorage = createStorage(stored);
  const sessionStorage = createStorage();
  const location = {
    href,
    /** @type {string | null} */
    replaced: null,
    replace(address) {
      location.replaced = String(address);
    },
  };
  const requests = [];
  const context = createContext({
    localStorage,
    sessionStorage,
    location,
    history: {
      state: null,
      replaceState: (state, unused, address) => {
        location.href = String(address);
      },
    },
    document: {
      querySelector: (selector) =>
        isMoving && selector === 'meta[name="moving-to-page-host"]'
          ? { getAttribute: () => "true" }
          : null,
    },
    URL,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    fetch: (path, init) => {
      requests.push({ path, method: init?.method });
      return answer();
    },
    isLook: (value) => value === "light" || value === "dark",
    isOnHomeScreen: () => isOnHomeScreen,
    isAppleBrowser: () => isAppleBrowser,
    readPhoneLook: () => "light",
    readAppearanceChoice: (stored) => {
      try {
        return JSON.parse(stored);
      } catch {
        return "auto";
      }
    },
  });
  runInContext(readRepoFile(`${PAGE_CODE}page-move.js`), context);
  const pageMove = runInContext(
    `({ isOldAddress, packCarried, unpackCarried, takeCarriedChoices, readPageMove,
      keepPageMoveIcon, forgetPageMove, isNotificationsAskKept, requestPageMove,
      leaveOldAddress, MAX_CARRIED_LENGTH })`,
    context,
  );
  return { ...pageMove, localStorage, sessionStorage, location, requests };
}

const CHOICES = {
  appearance: '"dark"',
  rankings: '["NYM","ATL"]',
  newsChoices: '{"athletic":false}',
  updatesSeenAt: "1761000000000",
  releaseNotesShownUntil: '{"at":1761000000000}',
};

/** @param {Partial<{ at: number, choices: Record<string, string>, icon: string | null,
 *   notifications: boolean, fromApp: boolean }>} carried */
const writeCarried = (carried) =>
  loadPageMove().packCarried({
    at: NOW,
    choices: CHOICES,
    icon: null,
    notifications: false,
    fromApp: false,
    ...carried,
  });

/** @param {string} base @param {string} carried */
const addCarried = (base, carried) => {
  const address = new URL(base);
  address.searchParams.set("carried", carried);
  return address.href;
};

/** A value from the page's own realm, in this test's objects. */
const copy = (value) => JSON.parse(JSON.stringify(value));

test("an old address is a workers.dev one under a key", () => {
  const { isOldAddress } = loadPageMove();
  assert.equal(isOldAddress(OLD_ADDRESS), true);
  assert.equal(isOldAddress(`${OLD_ADDRESS}?theme=dark`), true);
  assert.equal(isOldAddress("https://mlb-app.example-subdomain.workers.dev/"), false);
  assert.equal(isOldAddress(NEW_ADDRESS), false);
  assert.equal(isOldAddress(`${NEW_ADDRESS}k3y/`), false);
});

test("the carried choices unpack as they were packed", () => {
  const { packCarried, unpackCarried } = loadPageMove();
  const carried = {
    at: NOW,
    choices: CHOICES,
    icon: "dark",
    notifications: true,
    fromApp: true,
  };
  assert.deepEqual(copy(unpackCarried(packCarried(carried))), carried);
  assert.match(packCarried(carried), /^[\w-]+$/);
});

test("a choice that would make the address too long stays behind", () => {
  const { packCarried, unpackCarried, MAX_CARRIED_LENGTH } = loadPageMove();
  const rankings = JSON.stringify(Array.from({ length: 400 }, (unused, index) => `club${index}`));
  const packed = packCarried({
    at: NOW,
    choices: { ...CHOICES, rankings },
    icon: null,
    notifications: false,
    fromApp: false,
  });
  assert.ok(packed.length <= MAX_CARRIED_LENGTH);
  const { rankings: leftBehind, ...rest } = CHOICES;
  assert.ok(leftBehind);
  assert.deepEqual(copy(unpackCarried(packed).choices), rest);
});

test("a value that isn't a move unpacks to nothing, and unknown choices drop", () => {
  const { unpackCarried } = loadPageMove();
  assert.equal(unpackCarried("not*base64"), null);
  assert.equal(unpackCarried(btoa("[1,2]")), null);
  assert.equal(unpackCarried(btoa('{"choices":{}}')), null);
  const packed = btoa(JSON.stringify({ at: NOW, choices: { appearance: '"dark"', key: "k3y" } }));
  assert.deepEqual(copy(unpackCarried(packed)), {
    at: NOW,
    choices: { appearance: '"dark"' },
    icon: null,
    notifications: false,
    fromApp: false,
  });
});

test("the carried choices are the ones each device keeps with createViewerChoice", () => {
  const source = readRepoFile(`${PAGE_CODE}page-move.js`);
  const carried = JSON.parse(
    source
      .match(/const CARRIED_CHOICES = (\[[^\]]*\])/)[1]
      .replace(/,\s*\]/, "]")
      .replaceAll("'", '"'),
  );
  const pageFiles = listTrackedFiles().filter((path) =>
    /^(?:shared|apps\/[^/]+)\/page\/.*\.js$/.test(path),
  );
  const kept = pageFiles.flatMap((path) =>
    [...readRepoFile(path).matchAll(/createViewerChoice\(\s*"(\w+)"/g)].map((match) => match[1]),
  );
  assert.deepEqual([...new Set(kept)].sort(), [...carried].sort());
});

test("the Home Screen app keeps the carried choices into empty storage, and drops them from its address", () => {
  const carried = writeCarried({ notifications: true, icon: "dark" });
  const page = loadPageMove({
    href: addCarried(`${NEW_ADDRESS}?theme=dark`, carried),
    isOnHomeScreen: true,
  });
  assert.equal(page.takeCarriedChoices(NOW + 60 * MINUTE_MS), "dark");
  assert.equal(page.location.href, `${NEW_ADDRESS}?theme=dark`);
  for (const [key, text] of Object.entries(CHOICES))
    assert.equal(page.localStorage.getItem(key), text);
  assert.equal(page.isNotificationsAskKept(), true);
});

test("the Home Screen app keeps its own choices over the carried ones", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({})),
    isOnHomeScreen: true,
    stored: { appearance: '"light"' },
  });
  page.takeCarriedChoices(NOW);
  assert.equal(page.localStorage.getItem("appearance"), '"light"');
  assert.equal(page.localStorage.getItem("rankings"), null);
  assert.equal(page.isNotificationsAskKept(), false);
});

test("the Home Screen app takes a move once, though it opens at the same address each time", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({})),
    isOnHomeScreen: true,
  });
  page.takeCarriedChoices(NOW);
  page.localStorage.removeItem("appearance");
  page.location.href = addCarried(NEW_ADDRESS, writeCarried({ notifications: true }));
  page.takeCarriedChoices(NOW);
  assert.equal(page.localStorage.getItem("appearance"), null);
  assert.equal(page.isNotificationsAskKept(), false);
});

test("a browser keeps fresh carried choices into empty storage only, and drops them from its address", () => {
  const fresh = loadPageMove({ href: addCarried(NEW_ADDRESS, writeCarried({})) });
  fresh.takeCarriedChoices(NOW + 5 * MINUTE_MS);
  assert.equal(fresh.localStorage.getItem("appearance"), CHOICES.appearance);
  assert.equal(fresh.location.href, NEW_ADDRESS);

  const owned = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({})),
    stored: { newsChoices: "{}" },
  });
  owned.takeCarriedChoices(NOW);
  assert.equal(owned.localStorage.getItem("appearance"), null);
  assert.equal(owned.localStorage.getItem("newsChoices"), "{}");
});

test("a copied link carries no choices into a browser once it's old", () => {
  const page = loadPageMove({ href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })) });
  page.takeCarriedChoices(NOW + 10 * MINUTE_MS);
  assert.deepEqual([...page.localStorage.items.keys()], []);
  assert.equal(page.readPageMove(), null);
  assert.equal(page.location.href, NEW_ADDRESS);
});

test("a move from the Home Screen app keeps its icon in the browser's address while it's finished", () => {
  const page = loadPageMove({ href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })) });
  assert.equal(page.takeCarriedChoices(NOW), null);
  assert.equal(page.readPageMove().icon, "dark");
  const address = new URL(page.location.href);
  assert.equal(page.unpackCarried(address.searchParams.get("carried")).icon, "dark");

  page.keepPageMoveIcon("light");
  assert.equal(page.readPageMove().icon, "light");
  const replaced = new URL(page.location.replaced);
  assert.equal(page.unpackCarried(replaced.searchParams.get("carried")).icon, "light");

  page.forgetPageMove();
  assert.equal(page.readPageMove(), null);
  assert.equal(page.location.href, NEW_ADDRESS);
});

test("a move's icon starts on the theme the app showed, even where the browser keeps its own", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })),
    stored: { appearance: '"light"' },
  });
  page.takeCarriedChoices(NOW);
  assert.equal(page.localStorage.getItem("appearance"), '"light"');
  assert.equal(page.readPageMove().icon, "dark");
});

test("a browser off Safari keeps the icon picked in its address without loading again", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true, icon: "dark" })),
    isAppleBrowser: false,
  });
  page.takeCarriedChoices(NOW);
  page.keepPageMoveIcon("light");
  assert.equal(page.location.replaced, null);
  const address = new URL(page.location.href);
  assert.equal(page.unpackCarried(address.searchParams.get("carried")).icon, "light");
});

test("a pick of the icon without a move changes nothing", () => {
  const page = loadPageMove({ href: NEW_ADDRESS });
  page.keepPageMoveIcon("light");
  assert.equal(page.readPageMove(), null);
  assert.equal(page.location.replaced, null);
});

test("a browser at the old address leaves for the new one with its choices", async () => {
  const page = loadPageMove({ href: `${OLD_ADDRESS}?theme=dark`, stored: CHOICES });
  await page.leaveOldAddress();
  assert.deepEqual(page.requests, [{ path: "access/move", method: "POST" }]);
  const address = new URL(page.location.replaced);
  assert.equal(address.origin + address.pathname, `${NEW_ADDRESS}access/handoff`);
  assert.equal(address.searchParams.get("token"), "t0ken");
  const carried = page.unpackCarried(address.searchParams.get("carried"));
  assert.deepEqual(copy(carried.choices), CHOICES);
  assert.equal(carried.fromApp, false);
  assert.ok(address.href.length < 2000);
});

test("a page stays where it is when it isn't moving, is a Home Screen app, or gets no handoff", async () => {
  for (const page of [
    loadPageMove({ isMoving: false }),
    loadPageMove({ isOnHomeScreen: true }),
    loadPageMove({ href: NEW_ADDRESS }),
    loadPageMove({ answer: async () => new Response("", { status: 404 }) }),
    loadPageMove({ answer: async () => Promise.reject(new TypeError("offline")) }),
  ]) {
    await page.leaveOldAddress();
    assert.equal(page.location.replaced, null);
  }
});

test("a move from the Home Screen app carries notifications and where it left from", async () => {
  const page = loadPageMove({ isOnHomeScreen: true, stored: CHOICES });
  const address = await page.requestPageMove({ notifications: true, fromApp: true });
  const carried = page.unpackCarried(address.searchParams.get("carried"));
  assert.equal(carried.notifications, true);
  assert.equal(carried.fromApp, true);
});
