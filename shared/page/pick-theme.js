// Picks the theme before the first paint, so a dark look never flashes the light one. It loads as
// a plain script in each page's head, before the other plain scripts, which read the picked look
// and the Home Screen as it does; appearance.js keeps the theme, and the icons and bar color that
// go with it, current.

// The same test of the Home Screen as device.js makes for the page's modules.
const isOnHomeScreen = () =>
  matchMedia("(display-mode: standalone)").matches ||
  /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;

// The app's light look or its dark one, as against System.
/**
 * @param {unknown} value
 * @returns {value is "light" | "dark"}
 */
function isLook(value) {
  return value === "light" || value === "dark";
}

// System, the app's light look, or its dark one. Anything else reads as System.
/** @param {unknown} value */
function isAppearanceChoice(value) {
  return value === "auto" || isLook(value);
}

/** @returns {"light" | "dark"} the look the phone's dark or light setting shows */
function readPhoneLook() {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Checks the Appearance choice that names the look picked, among settings' or the welcome's.
 * @param {Iterable<HTMLInputElement>} choices
 * @param {string} picked
 */
function checkPickedChoice(choices, picked) {
  for (const choice of choices) choice.checked = choice.value === picked;
}

// A device keeps the choice as JSON, or, if it kept one earlier, as its name. Storage can refuse
// access, as in a private window, so the page never depends on it.
function readPickedAppearance() {
  let stored;
  try {
    stored = localStorage.getItem("appearance") ?? "";
  } catch {
    return "auto";
  }
  let choice;
  try {
    choice = JSON.parse(stored);
  } catch {
    choice = stored;
  }
  return isAppearanceChoice(choice) ? choice : "auto";
}

// Only Apple's browsers tell a page whether it runs from the Home Screen this way.
const isAppleBrowser = () => "standalone" in navigator;

/** @param {string} choice */
function buildThemeAddress(choice) {
  const address = new URL(location.href);
  if (isLook(choice)) address.searchParams.set("theme", choice);
  else address.searchParams.delete("theme");
  return address;
}

// A Home Screen app keeps its storage apart from the browser's, and Safari opens it at the page's
// address as it stood when it was added, so the browser's address always names the theme picked
// in it, and the app's first open keeps that. A theme in a shared link is the sender's, which the
// browser swaps for its own.
/** @param {string} choice */
function nameThemeInAddress(choice) {
  if (isOnHomeScreen()) return;
  const address = buildThemeAddress(choice);
  if (address.href !== location.href) history.replaceState(history.state, "", address);
}

// Safari takes the Home Screen app's address, and the color of its own bars, from the page as it
// loaded, so a pick it keeps loads the page again at the address that names it.
/** @param {string} choice */
function openThemeAddress(choice) {
  const address = buildThemeAddress(choice);
  const isKept = readPickedAppearance() === choice;
  if (isOnHomeScreen() || address.href === location.href) return;
  if (isAppleBrowser() && isKept) location.replace(address);
  else nameThemeInAddress(choice);
}

// The Home Screen app's link to add the site again names its theme under this key, which the
// browser keeps as its own pick, unlike a theme a shared link names.
const APP_THEME_KEY = "app-theme";

// Safari opens an address the app hands it under this scheme, which the app would otherwise open
// itself.
/**
 * @param {string} choice
 * @param {string} address
 */
function buildSafariAddress(choice, address) {
  const url = new URL(address);
  url.searchParams.set(APP_THEME_KEY, choice);
  return `x-safari-${url.href}`;
}

// A device keeps the Home Screen welcome closed under this key once the viewer closes it.
const WELCOME_CLOSED_KEY = "homeScreenWelcomeClosed";

// The browser keeps the theme the app's link names as its own and drops it from the address at
// once. It opens the welcome again, even where it was closed before, to show the steps that add
// the site again, on this page or past the gate, whose sign-in reloads the address it leaves.
function takeThemeFromApp() {
  const address = new URL(location.href);
  const fromApp = address.searchParams.get(APP_THEME_KEY);
  if (fromApp === null) return;
  address.searchParams.delete(APP_THEME_KEY);
  history.replaceState(history.state, "", address);
  if (!isAppearanceChoice(fromApp)) return;
  try {
    localStorage.setItem("appearance", JSON.stringify(fromApp));
    localStorage.removeItem(WELCOME_CLOSED_KEY);
  } catch {
    /* without storage, the browser follows the phone, and the welcome opens on every visit */
  }
}

// A Home Screen app keeps the icon the page offered as it was added: the look its address names,
// which it opens at each time, or, added on System, the look the phone's dark or light setting
// showed then, which its first open is the nearest to. A reload, as a new release brings, opens at
// the address the open before it left, which no longer names the look.
const HOME_SCREEN_ICON_KEY = "homeScreenIcon";

const isReload = () =>
  /** @type {PerformanceNavigationTiming[]} */ (performance.getEntriesByType("navigation"))[0]
    ?.type === "reload";

function keepHomeScreenIcon() {
  const named = new URL(location.href).searchParams.get("theme");
  try {
    if (isLook(named)) localStorage.setItem(HOME_SCREEN_ICON_KEY, named);
    else if (!isReload() && localStorage.getItem(HOME_SCREEN_ICON_KEY) === null)
      localStorage.setItem(HOME_SCREEN_ICON_KEY, readPhoneLook());
  } catch {
    /* without storage, settings can't tell the icon, and says nothing of it */
  }
}

/** The look of the icon this Home Screen app was added with, or null where storage doesn't say. */
function readHomeScreenIcon() {
  try {
    return localStorage.getItem(HOME_SCREEN_ICON_KEY);
  } catch {
    return null;
  }
}

// Only the app takes a theme from its address, on its first open, and drops it at once.
function keepThemeFromAddress() {
  const address = new URL(location.href);
  const fromAddress = address.searchParams.get("theme");
  if (fromAddress === null) return;
  address.searchParams.delete("theme");
  history.replaceState(history.state, "", address);
  if (!isAppearanceChoice(fromAddress)) return;
  try {
    if (localStorage.getItem("appearance") === null)
      localStorage.setItem("appearance", JSON.stringify(fromAddress));
  } catch {
    /* without storage, the app follows the phone, as appearance.js will */
  }
}

/** @param {string} choice */
function showTheme(choice) {
  document.documentElement.dataset.theme = isLook(choice) ? choice : readPhoneLook();
}

/** @param {string} choice */
function keepPickedAppearance(choice) {
  try {
    localStorage.setItem("appearance", JSON.stringify(choice));
  } catch {
    /* appearance.js keeps it for as long as the page is open */
  }
  showTheme(choice);
  openThemeAddress(choice);
}

if (!isOnHomeScreen()) takeThemeFromApp();

try {
  if (isOnHomeScreen()) {
    keepHomeScreenIcon();
    keepThemeFromAddress();
  } else nameThemeInAddress(readPickedAppearance());
  showTheme(readPickedAppearance());
} catch {
  document.documentElement.dataset.theme = "light";
}
