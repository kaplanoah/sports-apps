// Counts each browser or Home Screen app once per Eastern day at each of the app's addresses, since
// each keeps its own storage, so the owner can learn how many open the app. It keeps only the last day it was counted, which every one counted that day shares, and
// the count it sends carries nothing at all, so nothing tells one from another.

import { reloadWhenSignedOut } from "./access.js";
import { COUNT_ROUTE } from "./count-path.js";
import { readEasternDay } from "./days.js";
import { readStoredText, storeText } from "./local-storage.js";
import { WAKING_REQUEST_TIMEOUT_MS } from "./release.js";
import { watchTimeAway } from "./resume.js";

const COUNTED_DAY_KEY = "countedDay";

// A browser whose storage refuses still counts once a load, not on every return.
/** @type {string | null} */
let countedThisLoad = null;
let isSending = false;

/**
 * Whether a count is owed: once each Eastern day, and never from an automated browser, like a
 * test's.
 * @param {{ countedDays: (string | null)[], now: number, isAutomated: boolean }} state
 */
export const isCountOwed = ({ countedDays, now, isAutomated }) =>
  !isAutomated && !countedDays.includes(readEasternDay(now).date);

// The day is kept only once the Worker took the count, so a send that failed tries again on the
// next open or return.
/** @param {string} today */
async function sendCount(today) {
  isSending = true;
  const response = await fetch(new URL(COUNT_ROUTE, location.href), {
    method: "POST",
    signal: AbortSignal.timeout(WAKING_REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  isSending = false;
  if (!response) return;
  reloadWhenSignedOut(response);
  if (!response.ok) return;
  countedThisLoad = today;
  storeText(COUNTED_DAY_KEY, today);
}

function countIfOwed() {
  const now = Date.now();
  const countedDays = [readStoredText(COUNTED_DAY_KEY), countedThisLoad];
  if (isSending || !isCountOwed({ countedDays, now, isAutomated: navigator.webdriver })) return;
  sendCount(readEasternDay(now).date);
}

export function startDailyCount() {
  countIfOwed();
  watchTimeAway(countIfOwed);
}
