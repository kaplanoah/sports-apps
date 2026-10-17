import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { renderCatchUpLines, startCatchUpNote } from "../shared/page/catch-up-note.js";
import { readStampText } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

const UPDATING_WAIT_MS = 2000;
const STALLED_WAIT_MS = 10 * 1000;
// 5:33 PM Eastern on Sunday, October 4, and two minutes before it.
const NOW = Date.parse("2026-10-04T21:33:00Z");
const SYNCED_AT = Date.parse("2026-10-04T21:31:00Z");
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** @type {Record<string, () => void>} */
let windowListeners = {};
/** @type {Record<string, () => void>} */
let documentListeners = {};
/** @type {Map<string, string>} */
let saved = new Map();

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  windowListeners = {};
  documentListeners = {};
  saved = new Map();
  globalThis.addEventListener = /** @type {any} */ (
    (type, listener) => (windowListeners[type] = listener)
  );
  globalThis.document = /** @type {any} */ ({
    hidden: false,
    addEventListener: (type, listener) => (documentListeners[type] = listener),
  });
  globalThis.localStorage = /** @type {any} */ ({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });
  setOnline(true);
});

afterEach(() => {
  mock.timers.reset();
  delete (/** @type {any} */ (globalThis).addEventListener);
  delete (/** @type {any} */ (globalThis).document);
  delete (/** @type {any} */ (globalThis).localStorage);
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
});

/** @param {boolean} isOnline */
function setOnline(isOnline) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: isOnline },
  });
}

// A store whose catching up the test sets, starting behind, as a page's store starts.
/** @param {number | null} [syncedAt] when the store last had what the Worker holds */
function startNote(syncedAt = SYNCED_AT) {
  /** @type {(isCaughtUp: boolean) => void} */
  let announce = () => {};
  let noteSyncedAt = () => {};
  const store = {
    watchCatchUp: (/** @type {(isCaughtUp: boolean) => void} */ onChange) => {
      announce = onChange;
      onChange(false);
    },
    readSyncedAt: () => syncedAt,
    watchSyncedAt: (/** @type {() => void} */ onChange) => {
      noteSyncedAt = onChange;
    },
  };
  let redraws = 0;
  startCatchUpNote(store, () => (redraws += 1));
  return {
    announce: (/** @type {boolean} */ isCaughtUp) => announce(isCaughtUp),
    // The store read everything without its socket, at `at`.
    readAt: (/** @type {number} */ at) => {
      syncedAt = at;
      noteSyncedAt();
    },
    countRedraws: () => redraws,
  };
}

const readLines = () =>
  checkInTimeZone(EASTERN, () =>
    renderCatchUpLines().map((line) => readStampText(line).replace(/\s+/g, " ").trim()),
  );
const readMarkup = () => renderCatchUpLines().map((line) => line.text);

test("a page still catching up says when its scores are from, once that has lasted long enough to notice", () => {
  const { countRedraws } = startNote();
  mock.timers.tick(UPDATING_WAIT_MS - 1);
  assert.deepEqual(readLines(), []);
  assert.equal(countRedraws(), 0);

  mock.timers.tick(1);

  assert.deepEqual(readLines(), ["Scores as of 5:31 PM"]);
  assert.match(readMarkup()[0], /catch-up-ring/);
  assert.doesNotMatch(readMarkup()[0], /stamp-err/);
  assert.equal(countRedraws(), 1);
});

test("before the page first catches up, its scores are from when its last visit was current", () => {
  saved.set("syncedAt", String(SYNCED_AT));
  startNote(null);

  mock.timers.tick(UPDATING_WAIT_MS);

  assert.deepEqual(readLines(), ["Scores as of 5:31 PM"]);
});

test("scores from another day name the day", () => {
  startNote(Date.parse("2026-10-04T01:58:00Z"));

  mock.timers.tick(UPDATING_WAIT_MS);

  assert.deepEqual(readLines(), ["Scores as of yesterday 9:58 PM"]);
});

test("a page that has never been current says it's getting the latest scores", () => {
  startNote(null);

  mock.timers.tick(UPDATING_WAIT_MS);

  assert.deepEqual(readLines(), ["Getting the latest scores"]);
});

test("a wait that goes on says the server isn't answering, as a problem", () => {
  startNote();

  mock.timers.tick(STALLED_WAIT_MS);

  assert.deepEqual(readLines(), ["Can't reach the server. Scores as of 5:31 PM."]);
  assert.match(readMarkup()[0], /catch-up-line stamp-err/);
  assert.match(readMarkup()[0], /catch-up-ring/);
});

test("a page that can't reach the server's socket but reads the store says its scores are from the latest read, and keeps it", () => {
  const { readAt, countRedraws } = startNote();
  mock.timers.tick(STALLED_WAIT_MS);
  const redraws = countRedraws();

  readAt(Date.parse("2026-10-04T21:33:00Z"));

  assert.deepEqual(readLines(), ["Can't reach the server. Scores as of 5:33 PM."]);
  assert.equal(countRedraws(), redraws + 1);
  assert.equal(saved.get("syncedAt"), String(Date.parse("2026-10-04T21:33:00Z")));
});

test("an offline page still catching up says so at once, as a problem", () => {
  setOnline(false);
  startNote();

  assert.deepEqual(readLines(), ["You're offline. Scores as of 5:31 PM."]);
  assert.match(readMarkup()[0], /catch-up-line stamp-err/);
  assert.doesNotMatch(readMarkup()[0], /catch-up-ring/);
});

test("a page that has never been current says it's offline, or can't reach the server, in a line with no period", () => {
  const readDecodedLines = () => readLines().map((line) => line.replace(/&#39;/g, "'"));
  setOnline(false);
  startNote(null);
  assert.deepEqual(readDecodedLines(), ["You're offline"]);

  setOnline(true);
  mock.timers.tick(STALLED_WAIT_MS);
  assert.deepEqual(readDecodedLines(), ["Can't reach the server"]);
});

test("a page that goes offline while catching up says so as it does", () => {
  const { countRedraws } = startNote();

  setOnline(false);
  windowListeners.offline();

  assert.deepEqual(readLines(), ["You're offline. Scores as of 5:31 PM."]);
  assert.equal(countRedraws(), 1);
});

test("a page that catches up drops the line, and never shows it when that's in time", () => {
  const late = startNote();
  mock.timers.tick(STALLED_WAIT_MS);
  late.announce(true);
  assert.deepEqual(readLines(), []);
  assert.equal(late.countRedraws(), 3);

  const prompt = startNote();
  prompt.announce(true);
  mock.timers.tick(STALLED_WAIT_MS);
  assert.deepEqual(readLines(), []);
  assert.equal(prompt.countRedraws(), 0);
});

test("a page coming back waits again before showing the line", () => {
  const { announce } = startNote();
  mock.timers.tick(STALLED_WAIT_MS);

  announce(false);

  assert.deepEqual(readLines(), []);
  mock.timers.tick(UPDATING_WAIT_MS);
  assert.deepEqual(readLines(), ["Scores as of 5:31 PM"]);
});

test("when the page was last current is kept for its next visit", () => {
  const { announce } = startNote();
  assert.equal(saved.get("syncedAt"), String(SYNCED_AT));

  announce(true);
  mock.timers.tick(60 * 1000);
  /** @type {any} */ (globalThis.document).hidden = true;
  documentListeners.visibilitychange();

  assert.equal(saved.get("syncedAt"), String(NOW + 60 * 1000));
});
