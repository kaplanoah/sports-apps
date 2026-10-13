// A phone keeps a home-screen page suspended for days and resumes it as it was, with no way to
// reload it but quitting the app. So a page coming back catches up on what changed while it was
// away, and reloads itself only when a deploy has replaced it, since a reload blanks the screen.
// A phone waking a page often fails its first requests, so a release check that got no answer
// tries again on each tick until one does.

import { fetchRelease, loadRelease } from "./release.js";
import { refreshPageCopy } from "./service-worker.js";

// Timers stop while a phone suspends the page, so a tick this late means the page was asleep,
// even when the phone never said it was hidden.
const TICK_MS = 15 * 1000;
const ASLEEP_MS = 60 * 1000;
// A page hidden this long stops listening for changes, so the Worker knows no one is looking.
const HIDDEN_PAUSE_MS = 60 * 1000;

let activeAt = Date.now();
let wasHidden = false;
let isCheckingRelease = false;
let isRecheckWanted = false;
let isReleaseCheckOwed = false;
let isReloadPending = false;
/** @type {() => boolean} */
let isBusy = () => false;
/** @type {(awayMs: number) => void} */
let catchUp = () => {};
/** @type {() => void} */
let pause = () => {};
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pauseTimer;
/** @type {((awayMs: number) => void)[]} */
const awayWatchers = [];

/**
 * @param {import("./release.js").Release | null} loaded
 * @param {import("./release.js").Release | null} current
 */
const isReplaced = (loaded, current) => !!loaded && !!current && loaded.commit !== current.commit;

// A reload while the app is busy, as mid-drag, would drop what's under way, so it waits for the
// first tick after.
function reloadPage() {
  if (isBusy()) isReloadPending = true;
  else location.reload();
}

async function checkRelease() {
  try {
    const [loaded, current] = await Promise.all([loadRelease(), fetchRelease()]);
    isReleaseCheckOwed = false;
    if (!isReplaced(loaded, current)) return;
    // A reload opens the service worker's copy, so it waits until the copy holds the newer page.
    if (await refreshPageCopy()) reloadPage();
    else isReleaseCheckOwed = true;
  } catch {
    isReleaseCheckOwed = true;
  }
}

// A check asked for while one is under way runs once that one ends, since the one under way may
// have read the release before a deploy replaced it.
export async function reloadIfReplaced() {
  if (isCheckingRelease) {
    isRecheckWanted = true;
    return;
  }
  isCheckingRelease = true;
  await checkRelease();
  isCheckingRelease = false;
  if (!isRecheckWanted) return;
  isRecheckWanted = false;
  await reloadIfReplaced();
}

// Focus can come with no time away, and a phone can wake a page without hiding it first, so only
// a page that was hidden or asleep catches up.
function catchUpOnReturn() {
  if (document.hidden) return;
  clearTimeout(pauseTimer);
  const awayMs = Date.now() - activeAt;
  const hasBeenAway = wasHidden || awayMs >= ASLEEP_MS;
  activeAt = Date.now();
  wasHidden = false;
  if (hasBeenAway) {
    for (const watcher of awayWatchers) watcher(awayMs);
    catchUp(awayMs);
  }
  reloadIfReplaced();
}

function tick() {
  if (document.hidden) return;
  if (isReloadPending) reloadPage();
  else if (Date.now() - activeAt >= ASLEEP_MS) catchUpOnReturn();
  else {
    activeAt = Date.now();
    if (isReleaseCheckOwed) reloadIfReplaced();
  }
}

/**
 * Calls `watcher` with how long the page was away each time it comes back from being hidden or
 * asleep, once `watchReturns` is watching.
 * @param {(awayMs: number) => void} watcher
 */
export function watchTimeAway(watcher) {
  awayWatchers.push(watcher);
}

// A phone freezes timers while it suspends the page, so the pause can come due only once the page
// is back, after it opened a new socket that the pause would close.
function pauseIfHidden() {
  if (document.hidden) pause();
}

function noteHidden() {
  activeAt = Date.now();
  wasHidden = true;
  pauseTimer = setTimeout(pauseIfHidden, HIDDEN_PAUSE_MS);
}

// iOS doesn't always report a home-screen page coming back, so every sign of it counts. `pause`
// runs once the page has been hidden a while, and `catchUp` when it's back, with how long it was
// away.
/** @param {{ isBusy?: () => boolean, catchUp?: (awayMs: number) => void, pause?: () => void }} [options] */
export function watchReturns(options = {}) {
  isBusy = options.isBusy ?? isBusy;
  catchUp = options.catchUp ?? catchUp;
  pause = options.pause ?? pause;
  loadRelease().catch(() => {
    isReleaseCheckOwed = true;
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(pauseTimer);
    if (document.hidden) noteHidden();
    else catchUpOnReturn();
  });
  addEventListener("pageshow", (event) => {
    if (event.persisted) catchUpOnReturn();
  });
  addEventListener("focus", catchUpOnReturn);
  setInterval(tick, TICK_MS);
}
