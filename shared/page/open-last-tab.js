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

// What last-seen.js saves the parts the page draws whole under, which show-last-drawn.js puts back.
const LAST_DRAWN_KEY = "lastDrawn";

function readSavedParts() {
  try {
    const saved = JSON.parse(readStored(LAST_DRAWN_KEY) ?? "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function readOpeningState() {
  const intent = readNotificationIntent(location.href);
  return {
    requested: intent.isRequested ? "games" : readStored("lastTab"),
    previous: readStored("tabBeforeLast"),
    parts: intent.isRequested ? {} : readSavedParts(),
  };
}

const openingState = readOpeningState();
let openingTab = null;

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

function readOpeningTab() {
  if (openingTab) return openingTab;
  const { requested, previous, parts } = openingState;
  const button = document.getElementById(`tab-${requested}`);
  const bar = document.querySelector("nav.tabs");
  // A sibling arrives only after the tab bar closes, when a missing saved tab is known to be gone.
  if (!button && !bar?.nextSibling) return requested;
  const partId = button?.getAttribute("data-start-hidden-part");
  const saved = partId ? parts[partId] : null;
  const isStartedOver =
    partId && (!saved || saved.hidden === true || isLongAwayFrom(saved.savedAt));
  const tab = isStartedOver ? previous : requested;
  openingTab = document.getElementById(`tab-${tab}`)
    ? tab
    : bar?.querySelector("[data-tab]")?.getAttribute("data-tab");
  return openingTab;
}

function applyOpeningTab() {
  const tab = readOpeningTab();
  if (tab) {
    markTabSelected(tab);
    showView(tab);
  }
  placeTabPill();
}

function openLastTab() {
  tabObserver?.disconnect();
  applyOpeningTab();
}

function openLastTabBeforePaint() {
  tabObserver = new MutationObserver(applyOpeningTab);
  tabObserver.observe(document, { childList: true, subtree: true });
}

openLastTabBeforePaint();
