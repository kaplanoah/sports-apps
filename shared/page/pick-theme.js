// Picks the theme before the first paint, so a dark look never flashes the light one. It loads as
// a plain script in each page's head, before the other plain scripts, which read the picked look
// and the Home Screen as it does; appearance.js keeps the theme, and the icons and bar color that
// go with it, current.

// The same test of the Home Screen as device.js makes for the page's modules.
const isOnHomeScreen = () =>
  matchMedia("(display-mode: standalone)").matches ||
  /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;

// A device keeps the choice as JSON, or, if it kept one earlier, as its name. Storage can refuse
// access, as in a private window, so the page never depends on it.
function readPickedAppearance() {
  let stored;
  try {
    stored = localStorage.getItem("appearance") ?? "";
  } catch {
    return "auto";
  }
  try {
    const choice = JSON.parse(stored);
    return typeof choice === "string" ? choice : "auto";
  } catch {
    return stored || "auto";
  }
}

// Only Apple's browsers tell a page whether it runs from the Home Screen this way.
const isAppleBrowser = () => "standalone" in navigator;

/** @param {string} choice */
function buildThemeAddress(choice) {
  const address = new URL(location.href);
  if (choice === "light" || choice === "dark") address.searchParams.set("theme", choice);
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

// Only the app takes a theme from its address, on its first open, and drops it at once.
function keepThemeFromAddress() {
  const address = new URL(location.href);
  const fromAddress = address.searchParams.get("theme");
  if (fromAddress === null) return;
  address.searchParams.delete("theme");
  history.replaceState(history.state, "", address);
  try {
    if (localStorage.getItem("appearance") === null)
      localStorage.setItem("appearance", JSON.stringify(fromAddress));
  } catch {
    /* without storage, the app follows the phone, as appearance.js will */
  }
}

/** @param {string} choice */
function showTheme(choice) {
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
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

try {
  if (isOnHomeScreen()) keepThemeFromAddress();
  else nameThemeInAddress(readPickedAppearance());
  showTheme(readPickedAppearance());
} catch {
  document.documentElement.dataset.theme = "light";
}
