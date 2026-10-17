// Picks the theme before the first paint, so a dark look never flashes the light one. It loads as
// a plain script in each page's head; appearance.js keeps the theme, and the icons and bar color
// that go with it, current. A device keeps the choice as JSON, or, if it kept one earlier, as its
// name.

// A Home Screen app keeps its storage apart from the browser's, so its address (its manifest's
// start_url) names the theme picked before it was added, which its first open keeps. Only the app
// takes it, and the address drops it at once, so a link shared from either never hands on a theme.
function keepThemeFromAddress() {
  const address = new URL(location.href);
  const fromAddress = address.searchParams.get("theme");
  if (fromAddress === null) return;
  address.searchParams.delete("theme");
  history.replaceState(history.state, "", address);
  const isOnHomeScreen =
    matchMedia("(display-mode: standalone)").matches ||
    /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;
  if (isOnHomeScreen && localStorage.getItem("appearance") === null)
    localStorage.setItem("appearance", JSON.stringify(fromAddress));
}

try {
  keepThemeFromAddress();
  const stored = localStorage.getItem("appearance") ?? "";
  let choice;
  try {
    choice = JSON.parse(stored);
  } catch {
    choice = stored;
  }
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
