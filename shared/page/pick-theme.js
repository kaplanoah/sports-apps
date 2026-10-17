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

// A Home Screen app keeps its storage apart from the browser's, and Safari opens it at the page's
// address as it stood when it was added, so the browser's address always names the theme picked
// in it, and the app's first open keeps that. A theme in a shared link is the sender's, which the
// browser swaps for its own.
/** @param {string} choice */
function nameThemeInAddress(choice) {
  if (isOnHomeScreen()) return;
  const address = new URL(location.href);
  if (choice === "light" || choice === "dark") address.searchParams.set("theme", choice);
  else address.searchParams.delete("theme");
  if (address.href !== location.href) history.replaceState(history.state, "", address);
}

// Only the app takes a theme from its address, on its first open, and drops it at once.
function keepThemeFromAddress() {
  const address = new URL(location.href);
  const fromAddress = address.searchParams.get("theme");
  if (fromAddress === null) return;
  address.searchParams.delete("theme");
  history.replaceState(history.state, "", address);
  if (localStorage.getItem("appearance") === null)
    localStorage.setItem("appearance", JSON.stringify(fromAddress));
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
  nameThemeInAddress(choice);
}

try {
  if (isOnHomeScreen()) keepThemeFromAddress();
  else nameThemeInAddress(readPickedAppearance());
  showTheme(readPickedAppearance());
} catch {
  document.documentElement.dataset.theme = "light";
}
