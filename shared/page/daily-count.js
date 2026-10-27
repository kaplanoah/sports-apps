// Counts each device once per Eastern day, so the owner can learn how many devices open the app.
// The device keeps only the last day it was counted, which every device counted that day shares,
// and the count it sends carries nothing at all, so nothing tells one device from another.

import { reloadWhenSignedOut } from "./access.js";
import { readEasternDay } from "./days.js";
import { readStoredText, storeText } from "./local-storage.js";
import { watchTimeAway } from "./resume.js";

const COUNTED_DAY_KEY = "countedDay";
const COUNT_PATH = "count";

// A device whose storage refuses still counts once a load, not on every return.
/** @type {string | null} */
let countedThisLoad = null;
let isSending = false;

/**
 * Whether a device is owed a count: once each Eastern day, and never from an automated browser,
 * like a test's.
 * @param {{ countedDay: string | null, now: number, isAutomated: boolean }} state
 */
export const isCountOwed = ({ countedDay, now, isAutomated }) =>
  !isAutomated && countedDay !== readEasternDay(now).date;

// The day is kept only once the Worker took the count, so a send that failed tries again on the
// next open or return.
/** @param {string} today */
async function sendCount(today) {
  isSending = true;
  const response = await fetch(new URL(COUNT_PATH, location.href), { method: "POST" }).catch(
    () => null,
  );
  isSending = false;
  if (!response) return;
  reloadWhenSignedOut(response);
  if (!response.ok) return;
  countedThisLoad = today;
  storeText(COUNTED_DAY_KEY, today);
}

function countIfOwed() {
  const now = Date.now();
  const countedDay = readStoredText(COUNTED_DAY_KEY) ?? countedThisLoad;
  if (isSending || !isCountOwed({ countedDay, now, isAutomated: navigator.webdriver })) return;
  sendCount(readEasternDay(now).date);
}

export function startDailyCount() {
  countIfOwed();
  watchTimeAway(countIfOwed);
}
