import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

const PAGE_CODE = new URL("../shared/page/", import.meta.url);
const NEW_ADDRESS = "https://app.example.com/";

/**
 * Opens the page's head scripts as a page opens at `href`, with `stored` in its storage.
 * @param {{ href: string, isOnHomeScreen?: boolean, stored?: Record<string, string> }} page
 */
function openPage({ href, isOnHomeScreen = false, stored = {} }) {
  const storage = new Map(Object.entries(stored));
  const address = { href };
  const context = createContext({
    URL,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    location: {
      get href() {
        return address.href;
      },
      replace: () => assert.fail("the head scripts never leave the page"),
    },
    history: {
      state: null,
      replaceState: (_state, _title, replaced) => (address.href = String(replaced)),
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    matchMedia: (query) => ({ matches: query === "(display-mode: standalone)" && isOnHomeScreen }),
    navigator: {},
    performance: { getEntriesByType: () => [] },
    document: { documentElement: { dataset: {} } },
  });
  for (const script of ["move-choices.js", "pick-theme.js"])
    runInContext(readFileSync(new URL(script, PAGE_CODE), "utf8"), context);
  return {
    storage: Object.fromEntries(storage),
    address: new URL(address.href),
    /** @param {string} name */
    read: (name) => runInContext(name, context),
  };
}

const { read: readBlankPage } = openPage({ href: NEW_ADDRESS });
const packMove = readBlankPage("packMove");
const unpackMove = (packed) => structuredClone(readBlankPage("unpackMove")(packed));
const MOVE_LENGTH_LIMIT = readBlankPage("MOVE_LENGTH_LIMIT");

const OLD_CHOICES = {
  appearance: '"dark"',
  rankings: '{"2026":[147,121]}',
  updatesSeenAt: '{"2026":1760000000000}',
};

/** @param {{ choices?: Record<string, string>, icon?: string | null, isNotifying?: boolean }} move */
const addressWithMove = ({ choices = OLD_CHOICES, icon = null, isNotifying = false } = {}) =>
  `${NEW_ADDRESS}?move=${packMove({ choices, icon, isNotifying })}`;

test("the move carries every choice either app keeps for a viewer, and nothing else", () => {
  const made = listTrackedFiles()
    .filter((path) => /^(?:shared\/page|apps\/[^/]+\/page)\/.*\.js$/.test(path))
    .flatMap((path) =>
      [...readRepoFile(path).matchAll(/createViewerChoice\("([^"]+)"/g)].map((match) => match[1]),
    );
  assert.deepEqual([...new Set(made)].sort(), [...readBlankPage("MOVED_CHOICES")].sort());
});

test("a move packs into one address-safe value and unpacks to the same", () => {
  const move = { choices: OLD_CHOICES, icon: "dark", isNotifying: true };
  const packed = packMove(move);
  assert.match(packed, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(unpackMove(packed), move);
});

test("a move too long for an address leaves out its largest choices until it fits", () => {
  const choices = { ...OLD_CHOICES, newsChoices: JSON.stringify("x".repeat(3000)) };
  const packed = packMove({ choices, icon: null, isNotifying: false });
  assert.ok(packed.length < MOVE_LENGTH_LIMIT);
  assert.deepEqual(unpackMove(packed).choices, OLD_CHOICES);
});

test("unpacking drops what a move may not carry, and reads anything else as no move", () => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.deepEqual(
    unpackMove(
      encode({
        choices: { appearance: '"light"', homeScreenIcon: "dark", rankings: 3 },
        icon: "blue",
        isNotifying: "yes",
      }),
    ),
    { choices: { appearance: '"light"' }, icon: null, isNotifying: false },
  );
  assert.equal(unpackMove(null), null);
  assert.equal(unpackMove("not a move!"), null);
  assert.equal(unpackMove(encode("text")), null);
  assert.equal(unpackMove(encode(null)), null);
});

test("the new icon's first open takes the move's choices and icon into empty storage, asks about notifications, and drops the move", () => {
  const { storage, address } = openPage({
    href: addressWithMove({ icon: "dark", isNotifying: true }),
    isOnHomeScreen: true,
  });
  assert.deepEqual(storage, {
    ...OLD_CHOICES,
    homeScreenIcon: "dark",
    moveNotificationsAsk: "ask",
  });
  assert.equal(address.searchParams.get("move"), null);
});

test("the new icon doesn't ask about notifications that were off at the old address", () => {
  const { storage } = openPage({ href: addressWithMove(), isOnHomeScreen: true });
  assert.equal(storage.moveNotificationsAsk, undefined);
});

test("an app or browser with choices of its own keeps them over a move's", () => {
  const own = { appearance: '"light"' };
  for (const isOnHomeScreen of [true, false]) {
    const { storage } = openPage({ href: addressWithMove(), isOnHomeScreen, stored: own });
    assert.equal(storage.appearance, own.appearance);
    assert.equal(storage.rankings, undefined);
  }
});

test("a browser keeps the move in its address for the app it adds, carrying its own choices", () => {
  const { storage, address } = openPage({ href: addressWithMove({ isNotifying: true }) });
  assert.deepEqual(storage, OLD_CHOICES);
  assert.deepEqual(unpackMove(address.searchParams.get("move")), {
    choices: OLD_CHOICES,
    icon: null,
    isNotifying: true,
  });
  assert.equal(address.searchParams.get("theme"), "dark");
});

test("a copied link's move carries the browser's own choices, never the sender's", () => {
  const own = { appearance: '"light"', rankings: '{"2026":[121,147]}' };
  const { address } = openPage({ href: addressWithMove(), stored: own });
  assert.deepEqual(unpackMove(address.searchParams.get("move")).choices, own);
});

test("a page drops a move it can't read from its address", () => {
  for (const isOnHomeScreen of [true, false]) {
    const { storage, address } = openPage({ href: `${NEW_ADDRESS}?move=%%%`, isOnHomeScreen });
    assert.equal(address.searchParams.get("move"), null);
    assert.equal(storage.appearance, undefined);
  }
});
