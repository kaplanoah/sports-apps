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

// As on iPhone, each tab keeps the page where it was left, and a tab not shown yet opens at its top.
/** @type {Map<string, number>} */
const tabScrolls = new Map();

/** @param {string} tab */
function switchTab(tab) {
  const before = readSelectedTab(findTabButtons());
  if (before && before !== tab) {
    tabBefore = before;
    tabScrolls.set(before, scrollY);
  }
  showTab(tab);
  if (before !== tab) scrollTo({ top: tabScrolls.get(tab) ?? 0, behavior: "instant" });
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

// What choosing a tab that's already showing does besides scrolling the page to its top, for a view
// that scrolls in itself, like a Games view going back to today or the bracket and standings
// going back to their top and then to the part the tab is named for.
/** @type {Map<string, () => void>} */
const startReturns = new Map();

/**
 * Has choosing `tab` while it's showing call `returnToStart`, in the same tap that scrolls the
 * page to its top, since a view that scrolls in itself can still leave the page a pixel or two from
 * it, or on the next tap where the page scrolls the view.
 * @param {string} tab
 * @param {() => void} returnToStart
 */
export function setTabStart(tab, returnToStart) {
  startReturns.set(tab, returnToStart);
}

/**
 * Whether the page scrolls `tab`'s view, as it does a view that scrolls in itself once a tall
 * Updates box over it holds it at its least height (chrome.css).
 * @param {string} tab
 */
function isViewScrolledByPage(tab) {
  const view = document.getElementById(`view-${tab}`);
  if (!view) return false;
  const leastHeight = parseFloat(getComputedStyle(view).minHeight);
  return leastHeight > 0 && view.offsetHeight <= Math.ceil(leastHeight);
}

// Choosing the tab that's already showing scrolls the page to its top and takes the tab back to
// where it starts, the start waiting for a second tap where the page scrolls the view.
/** @param {string} tab */
function returnToStart(tab) {
  const isScrolled = scrollY > 0;
  const isWaitingForTop = isScrolled && isViewScrolledByPage(tab);
  if (isScrolled) scrollToTop();
  if (!isWaitingForTop) startReturns.get(tab)?.();
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
