// Modules run only once all of them have loaded, so a page left to them would first paint the tab
// its markup selects and then jump. This plain script loads in the head, and the page calls
// openLastTab() right after its tabs and views, before anything is painted.

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
/** @param {string} key */
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// After two minutes away, a view goes back to where it starts, as the page's modules do
// (long-away.js): a part that starts hidden, like a search, is hidden again (show-last-drawn.js),
// and a tab that shows nothing else goes back to the tab before it.
const START_AFTER_AWAY_MS = 2 * 60 * 1000;

/** @param {unknown} savedAt */
const isLongAwayFrom = (savedAt) => !(Date.now() - Number(savedAt) < START_AFTER_AWAY_MS);

/**
 * The part a tab's view shows alone, when it starts hidden, as a search's own view does.
 * @param {string} tab
 */
function findOnlyStartHiddenPart(tab) {
  const parts = document.querySelectorAll(`#view-${tab} [data-last-drawn]`);
  return parts.length === 1 && parts[0].hasAttribute("data-start-hidden") ? parts[0] : null;
}

/**
 * Whether a tab shows only a part that starts hidden, which the page will put back hidden.
 * @param {string} tab
 */
function isStartedOver(tab) {
  const part = findOnlyStartHiddenPart(tab);
  if (!part) return false;
  const saved = readSavedPart(part.id);
  return !saved || saved.hidden === true || isLongAwayFrom(saved.savedAt);
}

// What last-seen.js saves the parts the page draws whole under, which show-last-drawn.js puts back.
const LAST_DRAWN_KEY = "lastDrawn";

/**
 * What the page saved of a part it draws whole as it last left the screen, or null.
 * @param {string} id
 */
function readSavedPart(id) {
  try {
    return JSON.parse(readStored(LAST_DRAWN_KEY) ?? "null")?.[id] ?? null;
  } catch {
    return null;
  }
}

function readLastTab() {
  const tab = readStored("lastTab");
  return tab && isStartedOver(tab) ? readStored("tabBeforeLast") : tab;
}

/** @param {string} tab */
function markTabSelected(tab) {
  for (const button of document.querySelectorAll("nav.tabs [role=tab]")) {
    const isActive = /** @type {HTMLElement} */ (button).dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    /** @type {HTMLElement} */ (button).tabIndex = isActive ? 0 : -1;
  }
}

/** @param {string} tab */
function showView(tab) {
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

// The floating tab bar lays its tabs out in equal slots, and its pill rests on the selected one,
// or hides while a tab beside the bar shows.
function placeTabPill() {
  const bar = /** @type {HTMLElement} */ (document.getElementById("tabBar"));
  const buttons = [...bar.querySelectorAll("[role=tab]")];
  const selected = buttons.findIndex((button) => button.classList.contains("active"));
  bar.style.setProperty("--tab-count", String(buttons.length));
  bar.style.setProperty("--tab-index", String(Math.max(selected, 0)));
  bar.classList.toggle("is-unselected", selected < 0);
}

// A tab saved before the page dropped it is left alone, so the page opens on its first tab.
function openLastTab() {
  const tab = readLastTab();
  if (tab && document.getElementById(`view-${tab}`)) {
    markTabSelected(tab);
    showView(tab);
  }
  placeTabPill();
}
