// A page that loads again, after a deploy or after the phone dropped it, would show empty views
// until the store answers, so it first draws what it showed when it was last on screen: the
// markup of each part it draws whole and the sheets it showed, which show-last-drawn.js puts back
// before the first paint, with the pictures from other sites in it, which the service worker
// keeps, and the season, which the page draws from once its modules load, before its sheets take
// back what they showed.

import { keepImages } from "./service-worker.js";
import { listOpenSheets, reopenSheets } from "./sheet-reopen.js";

const LAST_SEEN_KEY = "lastSeen";
const LAST_DRAWN_KEY = "lastDrawn";
const OPEN_SHEETS_KEY = "openSheets";
// Another site's picture can count as several megabytes toward the storage the page's copy needs,
// so only the first ones, which a load opens on, are kept.
const KEPT_IMAGE_COUNT = 12;

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

/**
 * @param {string} key
 * @returns {any}
 */
function readItem(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export const readLastSeen = () => readItem(LAST_SEEN_KEY);

/** Has the sheets the page showed when it was last on screen show again what they showed. */
export const reopenLastSheets = () => reopenSheets(readItem(OPEN_SHEETS_KEY));

/**
 * The child indexes that lead from `part` down to `element`.
 * @param {Element} part
 * @param {Element} element
 */
function readPath(part, element) {
  const path = [];
  for (let node = element; node !== part; node = /** @type {Element} */ (node.parentElement))
    path.unshift([.../** @type {Element} */ (node.parentElement).children].indexOf(node));
  return path;
}

// A list or bracket that scrolls shows where it was, rather than its start, and a list that names
// where it starts, as a season's days do, keeps that too, for a page left long enough ago.
/** @param {HTMLElement} element */
const hasScroll = (element) =>
  element.scrollLeft > 0 || element.scrollTop > 0 || "startTop" in element.dataset;

/** @param {Element} part */
const readScrolls = (part) =>
  /** @type {HTMLElement[]} */ ([...part.querySelectorAll("*")])
    .filter(hasScroll)
    .map((element) => ({
      path: readPath(part, element),
      left: element.scrollLeft,
      top: element.scrollTop,
      startTop: Number(element.dataset.startTop ?? element.scrollTop),
    }));

// A part's classes and colors can come from its code rather than its markup, like a pager's
// classes and a game sheet's teams' colors.
/**
 * @param {HTMLElement} part
 * @param {number} savedAt
 */
const readDrawnPart = (part, savedAt) => ({
  markup: part.innerHTML,
  hidden: part.hidden,
  classes: part.className,
  style: part.getAttribute("style"),
  scrolls: readScrolls(part),
  savedAt,
});

/** @param {number} savedAt */
function readDrawnParts(savedAt) {
  const parts = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-last-drawn]")]);
  return Object.fromEntries(parts.map((part) => [part.id, readDrawnPart(part, savedAt)]));
}

/** @param {HTMLImageElement} image */
function isShownOtherSiteImage(image) {
  const url = new URL(image.src);
  const isOtherSite = /^https?:$/.test(url.protocol) && url.origin !== location.origin;
  return isOtherSite && image.complete && image.naturalWidth > 0;
}

// A picture still waiting to be scrolled to was never shown, so it isn't kept.
function listDrawnImages() {
  const images = /** @type {HTMLImageElement[]} */ ([
    ...document.querySelectorAll("[data-last-drawn] img[src]"),
  ]);
  const urls = images.filter(isShownOtherSiteImage).map((image) => image.src);
  return [...new Set(urls)].slice(0, KEPT_IMAGE_COUNT);
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function saveItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    dropItem(key);
  }
}

// A copy the page couldn't replace, as when storage is full, shows what the page showed long ago,
// so it goes, and the next load waits for the store instead.
/** @param {string} key */
function dropItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage that refuses access holds no copy to show */
  }
}

/**
 * @param {() => any} readShown what the page shows, or null before it has anything to show
 * @param {number} savedAt when the page left the screen
 */
function saveLastSeen(readShown, savedAt) {
  const shown = readShown();
  if (!shown) return;
  saveItem(LAST_SEEN_KEY, shown);
  saveItem(LAST_DRAWN_KEY, readDrawnParts(savedAt));
  saveItem(OPEN_SHEETS_KEY, listOpenSheets());
  keepImages(listDrawnImages());
}

// Leaving the screen is the last moment the page is sure to run, whether it then reloads, sleeps,
// or is dropped.
/** @param {() => any} readShown what the page shows, or null before it has anything to show */
export function keepLastSeen(readShown) {
  /** @type {number | null} */
  let hiddenAt = null;
  const readLeftAt = () => hiddenAt ?? Date.now();
  // A page that unloads while hidden says it's hidden once more, but has been away since it was
  // first hidden.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) hiddenAt = null;
    else {
      hiddenAt = readLeftAt();
      saveLastSeen(readShown, hiddenAt);
    }
  });
  addEventListener("pagehide", () => saveLastSeen(readShown, readLeftAt()));
}
