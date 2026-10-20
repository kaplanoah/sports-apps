// When settings shows the note that says how to bring a Home Screen app's icon up to date. An
// iPhone's Home Screen app keeps the icon the page offered as it was added, which pick-theme.js
// keeps for each install, so the note shows while the look picked is the other one. An install
// that doesn't know its icon, as one open when this shipped doesn't until its next open from the
// Home Screen, shows it from the first time the viewer switches looks. Either way it stays until
// the viewer dismisses it. Each install keeps both for itself, as a fresh install has a fresh
// icon, and storage can refuse access, as in a private window, and then they last until the page
// reloads.

import { readStoredText, storeText } from "./local-storage.js";

const DISMISSED_KEY = "reAddNoteDismissed";
const SWITCHED_KEY = "lookSwitched";

let isDismissedInMemory = false;
let isSwitchedInMemory = false;

// pick-theme.js tests a look the same way, but this runs in Node's tests too, where it isn't.
/**
 * @param {unknown} look
 * @returns {look is "light" | "dark"}
 */
const isLook = (look) => look === "light" || look === "dark";

/** @param {"light" | "dark"} look */
const findOtherLook = (look) => (look === "light" ? "dark" : "light");

/**
 * The note, while settings shows it, in an iPhone's or iPad's Home Screen app, until the viewer
 * dismisses it: the icon the app has, the one re-adding the site on the choice picked would give
 * it, which on System is the phone's look now, and that choice. An app that knows its icon shows
 * it while the look the choice gives isn't the icon's. One that doesn't shows it once the viewer
 * has switched looks, with the other look as the icon it has.
 * @param {{
 *   isIosApp: boolean,
 *   choice: string,
 *   icon: string | null,
 *   phoneLook: "light" | "dark",
 *   isSwitched: boolean,
 *   isDismissed: boolean,
 * }} state
 * @returns {{ icon: "light" | "dark", picked: "light" | "dark", choice: string } | null}
 */
export function chooseReAddNote({ isIosApp, choice, icon, phoneLook, isSwitched, isDismissed }) {
  if (!isIosApp || isDismissed) return null;
  const picked = isLook(choice) ? choice : phoneLook;
  if (isLook(icon)) return picked !== icon ? { icon, picked, choice } : null;
  if (!isSwitched) return null;
  return { icon: findOtherLook(picked), picked, choice };
}

// A phone reports a change of its look made while the page was away 50 to 70ms after the page is
// back, so a second leaves room for a slow one.
const RETURN_SETTLE_MS = 1000;

/**
 * Whether a change of the phone's look came while the page was away, or as it came back. The phone
 * has already shown the app in its new look by then, so the note takes its new state at once,
 * rather than easing from the old one.
 * @param {{ isHidden: boolean, changedAt: number, shownAt: number }} change
 *   `changedAt` and `shownAt`, when the page last came to the screen, on one clock in milliseconds
 * @returns {boolean}
 */
export const isLookChangeOnReturn = ({ isHidden, changedAt, shownAt }) =>
  isHidden || changedAt - shownAt < RETURN_SETTLE_MS;

/** @param {string} key */
const isKept = (key) => readStoredText(key) !== null;

export const isReAddNoteDismissed = () => isDismissedInMemory || isKept(DISMISSED_KEY);

export function keepReAddNoteDismissed() {
  isDismissedInMemory = true;
  storeText(DISMISSED_KEY, "dismissed");
}

/** Whether the viewer has switched looks on this install. */
export const isLookSwitched = () => isSwitchedInMemory || isKept(SWITCHED_KEY);

export function keepLookSwitched() {
  isSwitchedInMemory = true;
  storeText(SWITCHED_KEY, "switched");
}
