import { html } from "./html.js";
import { readStoredText, storeText } from "./local-storage.js";
import { renderStampWhen } from "./stamp.js";

// The page shows what it last drew, and keeps what it has while it's away, so until the store has
// answered it can look current when it isn't. The header's first line says so once that has
// lasted long enough to notice, and at once when the phone is offline, with when the scores shown
// were last current. A wait that goes on says the server isn't answering, while the page keeps
// trying.

const UPDATING_WAIT_MS = 2000;
const STALLED_WAIT_MS = 10 * 1000;
const SYNCED_AT_KEY = "syncedAt";

// An open ring with a 55-degree gap, drawn to match Phosphor's circle-notch at its Light weight,
// whose own gap is narrower: a 12-unit line on a radius of 96, with round ends.
const RING = html`<svg class="catch-up-ring" viewBox="0 0 256 256" aria-hidden="true">
  <path
    d="M177.56,45.78A96,96,0,1,1,78.44,45.78"
    fill="none"
    stroke="currentColor"
    stroke-width="12"
    stroke-linecap="round"
  />
</svg>`;

// Phosphor's cell-signal-slash, at its Regular weight, as in a line of text.
const OFFLINE_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M88,152v48a8,8,0,0,1-16,0V152a8,8,0,0,1,16,0ZM40,184a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-8A8,8,0,0,0,40,184Zm173.92,26.62-160-176A8,8,0,1,0,42.08,45.38L112,122.29V200a8,8,0,0,0,16,0V139.89l24,26.4V200a8,8,0,0,0,16,0V183.89l34.08,37.49a8,8,0,1,0,11.84-10.76Zm-53.92-87a8,8,0,0,0,8-8V72a8,8,0,0,0-16,0v43.63A8,8,0,0,0,160,123.63Zm40,44a8,8,0,0,0,8-8V32a8,8,0,0,0-16,0V159.63A8,8,0,0,0,200,167.63Z"
  />
</svg>`;

/**
 * @typedef {{
 *   watchCatchUp: (onChange: (isCaughtUp: boolean) => void) => void,
 *   readSyncedAt: () => number | null,
 *   watchSyncedAt: (onChange: () => void) => void,
 * }} CatchUpStore
 */

/** @type {CatchUpStore | null} */
let watchedStore = null;
let isBehind = false;
let isUpdatingShown = false;
let isStalled = false;

/** @returns {number | null} */
function readSavedSyncedAt() {
  const saved = Number(readStoredText(SYNCED_AT_KEY));
  return saved > 0 ? saved : null;
}

// A time storage won't take leaves the next load's line without one.
/** @param {number} at */
const saveSyncedAt = (at) => storeText(SYNCED_AT_KEY, String(at));

// Before the page first catches up, what it shows is what it showed on its last visit.
const readSyncedAt = () => watchedStore?.readSyncedAt() ?? readSavedSyncedAt();

/** @param {Date} now */
function renderAsOf(now) {
  const syncedAt = readSyncedAt();
  return syncedAt === null
    ? null
    : html`Scores as of <b>${renderStampWhen(new Date(syncedAt), now)}</b>`;
}

/**
 * @param {import("./html.js").Markup} icon
 * @param {import("./html.js").Markup | string} text
 * @param {boolean} isProblem
 */
const renderLine = (icon, text, isProblem) =>
  html`<span class="${isProblem ? "catch-up-line stamp-err" : "catch-up-line"}"
    >${icon}<span>${text}</span></span
  >`;

/** @param {Date} now */
function renderCatchUpLine(now) {
  if (!isBehind) return null;
  const asOf = renderAsOf(now);
  if (navigator.onLine === false)
    return renderLine(OFFLINE_ICON, asOf ? html`You're offline. ${asOf}.` : "You're offline", true);
  if (isStalled)
    return renderLine(
      RING,
      asOf ? html`Can't reach the server. ${asOf}.` : "Can't reach the server",
      true,
    );
  if (isUpdatingShown) return renderLine(RING, asOf ?? "Getting the latest scores", false);
  return null;
}

/**
 * The header's first line while the page is catching up, if it has one.
 * @param {Date} [now]
 * @returns {import("./html.js").Markup[]}
 */
export function renderCatchUpLines(now = new Date()) {
  const line = renderCatchUpLine(now);
  return line ? [line] : [];
}

/** @param {CatchUpStore} store */
function saveStoreSyncedAt(store) {
  const syncedAt = store.readSyncedAt();
  if (syncedAt !== null) saveSyncedAt(syncedAt);
}

/**
 * Redraws with `redraw` each time the line changes, and keeps when the page was last current for
 * its next visit.
 * @param {CatchUpStore} store
 * @param {() => void} redraw
 */
export function startCatchUpNote(store, redraw) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let updatingTimer;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let stalledTimer;
  watchedStore = store;
  isBehind = false;
  isUpdatingShown = false;
  isStalled = false;
  let shownText = "";
  const redrawIfChanged = () => {
    const text = renderCatchUpLines()
      .map((line) => line.text)
      .join("");
    if (text === shownText) return;
    shownText = text;
    redraw();
  };
  store.watchCatchUp((isCaughtUp) => {
    clearTimeout(updatingTimer);
    clearTimeout(stalledTimer);
    isBehind = !isCaughtUp;
    isUpdatingShown = false;
    isStalled = false;
    saveStoreSyncedAt(store);
    if (isBehind) {
      updatingTimer = setTimeout(() => {
        isUpdatingShown = true;
        redrawIfChanged();
      }, UPDATING_WAIT_MS);
      stalledTimer = setTimeout(() => {
        isStalled = true;
        redrawIfChanged();
      }, STALLED_WAIT_MS);
    }
    redrawIfChanged();
  });
  // A page still behind can read the store without its socket, which moves when its scores are
  // from.
  store.watchSyncedAt(() => {
    saveStoreSyncedAt(store);
    redrawIfChanged();
  });
  addEventListener("online", redrawIfChanged);
  addEventListener("offline", redrawIfChanged);
  // A page caught up as it leaves the screen is current until then, which is when its next visit's
  // scores are from if the phone drops it.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !isBehind) saveSyncedAt(Date.now());
  });
}
