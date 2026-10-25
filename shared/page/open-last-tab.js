// The saved tab or a notification's Games tab is chosen as markup arrives, before modules load.
// The inline call applies it again once the page's views and dialogs are complete.

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
/** @param {string} key */
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/* global isLongAwayFrom, readNotificationIntent -- from long-away.js and notification-intent.js */

// After two minutes away, a part that starts hidden, like a search, is hidden again
// (show-last-drawn.js), and a tab that shows nothing else goes back to the tab before it.

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
  if (!bar) return;
  const buttons = [...bar.querySelectorAll("[role=tab]")];
  const selected = buttons.findIndex((button) => button.classList.contains("active"));
  bar.style.setProperty("--tab-count", String(buttons.length));
  bar.style.setProperty("--tab-index", String(Math.max(selected, 0)));
  bar.classList.toggle("is-unselected", selected < 0);
}

/** @type {MutationObserver | null} */
let tabObserver = null;

function readOpeningTab(isParsing) {
  const intent = readNotificationIntent(location.href);
  const requested = intent.isRequested ? "games" : readLastTab();
  if (requested && (isParsing || document.getElementById(`tab-${requested}`))) return requested;
  return document.querySelector("nav.tabs [data-tab]")?.getAttribute("data-tab");
}

function openLastTab({ isParsing = false } = {}) {
  if (!isParsing) tabObserver?.disconnect();
  const tab = readOpeningTab(isParsing);
  if (tab) {
    markTabSelected(tab);
    showView(tab);
  }
  placeTabPill();
}

function openLastTabBeforePaint() {
  tabObserver = new MutationObserver(() => openLastTab({ isParsing: true }));
  tabObserver.observe(document, { childList: true, subtree: true });
}

openLastTabBeforePaint();
