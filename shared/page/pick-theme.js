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

// A Home Screen app keeps its storage apart from the browser's, so its address (its manifest's
// start_url) names the theme picked before it was added, which its first open keeps. Only the app
// takes it, and the address drops it at once, so a link shared from either never hands on a theme.
function keepThemeFromAddress() {
  const address = new URL(location.href);
  const fromAddress = address.searchParams.get("theme");
  if (fromAddress === null) return;
  address.searchParams.delete("theme");
  history.replaceState(history.state, "", address);
  if (isOnHomeScreen() && localStorage.getItem("appearance") === null)
    localStorage.setItem("appearance", JSON.stringify(fromAddress));
}

function showPickedTheme() {
  const choice = readPickedAppearance();
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
  showPickedTheme();
}

try {
  keepThemeFromAddress();
  showPickedTheme();
} catch {
  document.documentElement.dataset.theme = "light";
}
