// Picks the theme before the first paint, so a dark look never flashes the light one. It loads as
// a plain script in each page's head; appearance.js keeps the theme, and the icons and bar color
// that go with it, current. A device keeps the choice as JSON, or, if it kept one earlier, as its
// name. A Home Screen app keeps its storage apart from the browser's, so on its first open it keeps
// the theme picked before it was added, which its address names (its manifest's start_url).
try {
  const fromAddress = new URLSearchParams(location.search).get("theme");
  if (fromAddress && localStorage.getItem("appearance") === null)
    localStorage.setItem("appearance", JSON.stringify(fromAddress));
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
