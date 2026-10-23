import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";
import { chooseReAddNote } from "../shared/page/re-add-note.js";
import { createStorage, createHistory } from "./theme-head.js";

const MINUTE_MS = 60 * 1000;
const NOW = Date.parse("2026-10-22T16:00:00Z");
const PAGE_CODE = "shared/page/";
const OLD_ADDRESS = "https://mlb-app.example-subdomain.workers.dev/k3y/";
const NEW_ADDRESS = "https://mlb.sports.example/";
const HANDOFF_ADDRESS = `${NEW_ADDRESS}access/handoff?token=t0ken`;

/**
 * The plain script as a page's head runs it, at `href`, with what pick-theme.js gives it.
 * @param {{ href?: string, stored?: Record<string, string>, isOnHomeScreen?: boolean,
 *   isAppleBrowser?: boolean, isMoving?: boolean, phoneLook?: "light" | "dark",
 *   answer?: () => Promise<Response> }} [page]
 */
function loadPageMove({
  href = OLD_ADDRESS,
  stored = {},
  isOnHomeScreen = false,
  isAppleBrowser = true,
  isMoving = true,
  phoneLook = "light",
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
    history: createHistory(location),
    navigator: isAppleBrowser ? { standalone: isOnHomeScreen } : {},
    matchMedia: (query) => ({
      matches: query.includes("standalone") ? isOnHomeScreen : phoneLook === "dark",
    }),
    performance: { getEntriesByType: () => [{ type: "navigate" }] },
    document: {
      documentElement: { dataset: {} },
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
  });
  runInContext(readRepoFile(`${PAGE_CODE}page-move.js`), context);
  const pageMove = runInContext(
    `({ isOldAddress, packCarried, unpackCarried, takeCarriedChoices, readPageMove,
      keepPageMoveIcon, forgetPageMove, isNotificationsAskKept, requestPageMove,
      leaveOldAddress, MAX_CARRIED_LENGTH })`,
    context,
  );
  const themeSource = readRepoFile(`${PAGE_CODE}pick-theme.js`);
  const marker = "if (!isOnHomeScreen()) takeThemeFromApp();";
  const startup = themeSource.indexOf(marker);
  assert.notEqual(startup, -1, `Theme startup marker missing: ${marker}`);
  runInContext(themeSource.slice(0, startup), context);
  function startTheme() {
    runInContext(themeSource.slice(startup), context);
    return runInContext(
      "({ choice: readPickedAppearance(), icon: readHomeScreenIcon(), picked: resolveTheme(readPickedAppearance()) })",
      context,
    );
  }
  return {
    ...pageMove,
    localStorage,
    sessionStorage,
    location,
    requests,
    startTheme,
    setPhoneLook: (look) => {
      phoneLook = look;
    },
  };
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

test("an older move's first address gives the Home Screen app the welcome's default icon", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })),
    isOnHomeScreen: true,
  });
  assert.equal(page.takeCarriedChoices(NOW), "dark");
});

test("launching an older move's original address keeps the chosen icon and shows no re-add note", () => {
  for (const look of /** @type {const} */ (["light", "dark"])) {
    const phoneLook = look === "dark" ? "light" : "dark";
    const page = loadPageMove({
      href: addCarried(
        NEW_ADDRESS,
        writeCarried({ fromApp: true, choices: { appearance: JSON.stringify(look) } }),
      ),
      isOnHomeScreen: true,
      phoneLook,
    });
    const state = page.startTheme();
    assert.equal(state.icon, look);
    assert.equal(
      chooseReAddNote({
        ...state,
        isIosApp: true,
        isSwitched: false,
        isDismissed: false,
      }),
      null,
    );
  }
});

test("a move's explicit icon outranks its carried appearance", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true, icon: "light" })),
    isOnHomeScreen: true,
  });
  assert.equal(page.takeCarriedChoices(NOW), "light");
});

test("reopening an older fixed-look move repairs the icon recorded before the move was taken", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })),
    isOnHomeScreen: true,
    stored: {
      appearance: '"dark"',
      homeScreenIcon: "light",
      carriedChoicesTaken: String(NOW),
    },
  });
  assert.equal(page.startTheme().icon, "dark");
});

test("an older System move keeps its installed icon across cold launches and phone look changes", () => {
  const href = addCarried(
    NEW_ADDRESS,
    writeCarried({ fromApp: true, choices: { appearance: '"auto"' } }),
  );
  const first = loadPageMove({ href, isOnHomeScreen: true, phoneLook: "dark" });
  assert.equal(first.startTheme().icon, "dark");
  const stored = Object.fromEntries(first.localStorage.items);
  stored.appearance = '"auto"';
  const reopened = loadPageMove({ href, stored, isOnHomeScreen: true, phoneLook: "light" });
  const state = reopened.startTheme();
  assert.equal(state.icon, "dark");
  assert.equal(state.picked, "light");
  assert.notEqual(
    chooseReAddNote({ ...state, isIosApp: true, isSwitched: false, isDismissed: false }),
    null,
  );
});

test("Safari reloads a migration icon pick even when the address already names its matching theme", () => {
  const page = loadPageMove({
    href: addCarried(`${NEW_ADDRESS}?theme=light`, writeCarried({ fromApp: true, icon: "dark" })),
  });
  page.takeCarriedChoices(NOW);
  page.keepPageMoveIcon("light");
  const address = new URL(page.location.replaced);
  assert.equal(address.searchParams.get("theme"), "light");
  assert.equal(page.unpackCarried(address.searchParams.get("carried")).icon, "light");
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
  assert.equal(page.takeCarriedChoices(NOW), "dark");
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

test("a move opens the browser on the source app's appearance and icon, keeping other browser choices", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })),
    stored: { appearance: '"light"', rankings: '["BOS"]' },
  });
  page.takeCarriedChoices(NOW);
  assert.equal(page.localStorage.getItem("appearance"), '"dark"');
  assert.equal(page.localStorage.getItem("rankings"), '["BOS"]');
  assert.equal(page.readPageMove().icon, "dark");
});

test("a move from System sets the browser to the selected icon's look even without a stored source choice", () => {
  const page = loadPageMove({
    href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true, choices: {} })),
    stored: { appearance: '"dark"' },
  });
  page.takeCarriedChoices(NOW);
  assert.equal(page.localStorage.getItem("appearance"), '"light"');
  assert.equal(page.readPageMove().icon, "light");
});

test("picking a migration icon carries its matching appearance into the new app", () => {
  const page = loadPageMove({ href: addCarried(NEW_ADDRESS, writeCarried({ fromApp: true })) });
  page.takeCarriedChoices(NOW);
  page.keepPageMoveIcon("light");
  const address = new URL(page.location.replaced);
  const carried = page.unpackCarried(address.searchParams.get("carried"));
  assert.equal(carried.icon, "light");
  assert.equal(carried.choices.appearance, '"light"');
  const installed = loadPageMove({
    href: addCarried(NEW_ADDRESS, address.searchParams.get("carried")),
    isOnHomeScreen: true,
    phoneLook: "dark",
  });
  const state = installed.startTheme();
  assert.equal(state.choice, "light");
  assert.equal(state.icon, "light");
});

test("a move on System resolves against the phone controlled by that page", () => {
  const carried = writeCarried({ fromApp: true, choices: { appearance: '"auto"' } });
  const page = loadPageMove({ href: addCarried(NEW_ADDRESS, carried), phoneLook: "dark" });
  page.takeCarriedChoices(NOW);
  assert.equal(page.readPageMove().icon, "dark");
  page.setPhoneLook("light");
  page.location.href = addCarried(NEW_ADDRESS, carried);
  page.takeCarriedChoices(NOW);
  assert.equal(page.readPageMove().icon, "light");
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

test("a Home Screen move's first handoff names its default icon before the browser opens", async () => {
  const page = loadPageMove({ isOnHomeScreen: true, stored: CHOICES });
  const address = await page.requestPageMove({ fromApp: true });
  assert.equal(page.unpackCarried(address.searchParams.get("carried")).icon, "dark");
});

test("a System move carries the source phone's icon even if the destination phone's look differs", async () => {
  const page = loadPageMove({
    isOnHomeScreen: true,
    phoneLook: "dark",
    stored: { appearance: '"auto"' },
  });
  const address = await page.requestPageMove({ fromApp: true });
  const carried = address.searchParams.get("carried");
  assert.equal(page.unpackCarried(carried).icon, "dark");
  const installed = loadPageMove({
    href: addCarried(NEW_ADDRESS, carried),
    isOnHomeScreen: true,
    phoneLook: "light",
  });
  assert.equal(installed.takeCarriedChoices(NOW), "dark");
});
