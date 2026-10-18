// When settings shows the note that says how to bring a Home Screen app's icon up to date. An
// iPhone's Home Screen app keeps the icon the page offered as it was added, which pick-theme.js
// keeps for each install, so the note shows while the look picked is the other one, until the
// viewer dismisses it, which each install keeps for itself too, as a fresh install has a fresh
// icon. Storage can refuse access, as in a private window, and then a dismissal lasts until the
// page reloads.

const HOME_SCREEN_ICON_KEY = "homeScreenIcon";
const DISMISSED_KEY = "reAddNoteDismissed";

let isDismissedInMemory = false;

/**
 * @param {unknown} look
 * @returns {look is "light" | "dark"}
 */
const isLook = (look) => look === "light" || look === "dark";

/**
 * The icon the app has and the one the look picked would give it, while settings shows the note:
 * in an iPhone's or iPad's Home Screen app, while the look picked isn't the one its icon has, and
 * the viewer hasn't dismissed it. System follows the phone, which no icon does.
 * @param {{ isIosApp: boolean, picked: string, icon: string | null, isDismissed: boolean }} state
 * @returns {{ icon: "light" | "dark", picked: "light" | "dark" } | null}
 */
export function chooseReAddNote({ isIosApp, picked, icon, isDismissed }) {
  if (!isIosApp || isDismissed || !isLook(icon) || !isLook(picked) || picked === icon) return null;
  return { icon, picked };
}

/** The look of the icon this Home Screen app was added with, or null where storage doesn't say. */
export function readHomeScreenIcon() {
  try {
    return localStorage.getItem(HOME_SCREEN_ICON_KEY);
  } catch {
    return null;
  }
}

export function isReAddNoteDismissed() {
  try {
    return isDismissedInMemory || localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return isDismissedInMemory;
  }
}

export function keepReAddNoteDismissed() {
  isDismissedInMemory = true;
  try {
    localStorage.setItem(DISMISSED_KEY, "dismissed");
  } catch {
    /* the note stays away until the page reloads */
  }
}
