import { readTabBeforeLast, saveLastTab } from "./last-tab.js";
import { scrollToTop } from "./spring-scroll.js";
import { moveTabSelection } from "./tab-bar.js";
import { readSelectedTab, selectTab, wireTabs } from "./tabs.js";

// The page's own tabs, in the tab bar and beside it, each showing the section whose id is
// `view-<tab>`.

const findTabButtons = () =>
  /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav.tabs [role=tab]")]);

/** @param {string} tab */
function showTab(tab) {
  selectTab(findTabButtons(), tab);
  for (const view of document.querySelectorAll("section.view")) {
    view.classList.toggle("active", view.id === `view-${tab}`);
  }
}

// The tab shown before the one showing, for a tab that goes back to it, like search on Cancel.
/** @type {string | null} */
let tabBefore = null;

/** @param {string} tab */
function switchTab(tab) {
  const before = readSelectedTab(findTabButtons());
  if (before && before !== tab) tabBefore = before;
  showTab(tab);
  moveTabSelection(tab);
  saveLastTab(tab, before);
}

/** The tab the page shows. */
export const readShownTab = () => readSelectedTab(findTabButtons());

/** The tab shown before the one showing, as kept across a reload, or null before any other. */
export const readTabBefore = () => tabBefore ?? readTabBeforeLast();

/**
 * Shows a tab, as choosing it does, but for what entering it does.
 * @param {string} tab
 */
export const openPageTab = (tab) => switchTab(tab);

// What choosing a tab that's already showing does instead of scrolling to the top, for a tab whose
// start isn't its top, like a Games view's today.
/** @type {Map<string, () => boolean>} */
const startReturns = new Map();

/**
 * Has choosing `tab` while it's showing call `returnToStart`, which says whether it moved the tab,
 * as when the tab wasn't already at its start.
 * @param {string} tab
 * @param {() => boolean} returnToStart
 */
export function setTabStart(tab, returnToStart) {
  startReturns.set(tab, returnToStart);
}

// As on iPhone, choosing the tab that's already showing takes it back to where it starts, and then
// to the top.
/** @param {string} tab */
function returnToStart(tab) {
  if (!startReturns.get(tab)?.()) scrollToTop();
}

// What choosing a tab does as it opens, from the tap, like bringing up the keyboard in a search.
/** @type {Map<string, () => void>} */
const entries = new Map();

/**
 * Has choosing `tab` call `enter` once it shows.
 * @param {string} tab
 * @param {() => void} enter
 */
export function setTabEnter(tab, enter) {
  entries.set(tab, enter);
}

/** @param {string} tab */
function chooseTab(tab) {
  if (tab === readSelectedTab(findTabButtons())) {
    returnToStart(tab);
    return;
  }
  switchTab(tab);
  entries.get(tab)?.();
}

// The page has already reopened its last tab (open-last-tab.js), with the pill on it.
export function startPageTabs() {
  wireTabs(findTabButtons(), chooseTab);
}
