// A page that loads again, after a deploy or after the phone dropped it, would show empty views
// until the store answers, so it first draws what it showed when it was last on screen: the
// markup of each part it draws whole, the sheets it showed, and its settings' switches,
// which show-last-drawn.js puts back before the first paint, with the pictures from other sites in
// it, which the service worker keeps, and the season, which the page draws from once its modules
// load, before its sheets take back what they showed. A sheet left open too long is gone by the
// time the page shows again (sheet-memory.js).

/* global LAST_DRAWN_KEY -- from open-last-tab.js */
/* global KEPT_SWITCHES, LAST_SWITCHED_KEY, OPEN_SHEETS_KEY -- from show-last-drawn.js */

import { readPath } from "./element-path.js";
import { forgetStored, readStoredJson, storeJson } from "./local-storage.js";
import { watchTimeAway } from "./resume.js";
import { isSeasonPart } from "./season-part.js";
import { keepImages } from "./service-worker.js";
import { closeForgottenDialogs, noteShownEndsSeen } from "./sheet-memory.js";
import { listOpenSheets, reopenSheets } from "./sheet-reopen.js";

/* global isAwayLong -- from long-away.js */

const LAST_SEEN_KEY = "lastSeen";
// Another site's picture can count as several megabytes toward the storage the page's copy needs,
// so only the first ones, which a load opens on, are kept.
const KEPT_IMAGE_COUNT = 12;

export const readLastSeen = () => readStoredJson(LAST_SEEN_KEY);

/** Has the sheets the page showed when it was last on screen show again what they showed. */
export const reopenLastSheets = () => reopenSheets(readStoredJson(OPEN_SHEETS_KEY));

// A list or bracket that scrolls shows where it was, rather than its start, and one that names
// where it starts, as a season's days and a sideways bracket do, keeps that too, for a page left
// long enough ago.
/** @param {HTMLElement} element */
const hasScroll = (element) =>
  element.scrollLeft > 0 ||
  element.scrollTop > 0 ||
  "startLeft" in element.dataset ||
  "startTop" in element.dataset;

/** @param {string | undefined} start */
const readStart = (start) => (start === undefined ? undefined : Number(start));

/** @param {Element} part */
const readScrolls = (part) =>
  /** @type {HTMLElement[]} */ ([...part.querySelectorAll("*")])
    .filter(hasScroll)
    .map((element) => ({
      path: readPath(part, element),
      left: element.scrollLeft,
      top: element.scrollTop,
      startLeft: readStart(element.dataset.startLeft),
      startTop: readStart(element.dataset.startTop),
    }));

// A part drawn inside the season's standings or bracket, which each scroll on their own (pager.css),
// keeps that holder's place too. A holder on a tab not shown reads as unscrolled, so it keeps the
// place it last scrolled to, or the one a load put back that it hasn't shown yet, until the page
// starts over after two minutes away (long-away.js).
/** @type {WeakMap<Element, number>} */
let holderTops = new WeakMap();

/** @param {Event} event */
function noteHolderTop({ target }) {
  if (isSeasonPart(target)) holderTops.set(target, target.scrollTop);
}

/** @param {HTMLElement} part */
function readHolderTop(part) {
  const holder = part.parentElement;
  if (!isSeasonPart(holder)) return undefined;
  if (holder.getClientRects().length) return holder.scrollTop;
  return Number(holder.dataset.putBackTop ?? holderTops.get(holder) ?? 0);
}

// A part on the tab shown keeps where the page was scrolled, as on the News tab.
/** @param {HTMLElement} part */
const readPageTop = (part) => (part.closest("section.view.active") ? scrollY : undefined);

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
  holderTop: readHolderTop(part),
  pageTop: readPageTop(part),
  savedAt,
});

/** @param {number} savedAt */
function readDrawnParts(savedAt) {
  const parts = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-last-drawn]")]);
  return Object.fromEntries(parts.map((part) => [part.id, readDrawnPart(part, savedAt)]));
}

const readSwitches = () =>
  Object.fromEntries(
    [...document.querySelectorAll(KEPT_SWITCHES)].map((each) => [
      each.id,
      each.getAttribute("aria-checked"),
    ]),
  );

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

// A copy the page couldn't replace, as when storage is full, shows what the page showed long ago,
// so it goes, and the next load waits for the store instead.
/**
 * @param {string} key
 * @param {unknown} value
 */
function saveItem(key, value) {
  if (!storeJson(key, value)) forgetStored(key);
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
  saveItem(OPEN_SHEETS_KEY, listOpenSheets(savedAt));
  saveItem(LAST_SWITCHED_KEY, readSwitches());
  keepImages(listDrawnImages());
}

// Leaving the screen is the last moment the page is sure to run, whether it then reloads, sleeps,
// or is dropped. Coming back, the page closes what it kept open too long before it draws.
/** @param {() => any} readShown what the page shows, or null before it has anything to show */
export function keepLastSeen(readShown) {
  /** @type {number | null} */
  let hiddenAt = null;
  const readLeftAt = () => hiddenAt ?? Date.now();
  document.addEventListener("scroll", noteHolderTop, { capture: true, passive: true });
  watchTimeAway((awayMs) => {
    if (isAwayLong(awayMs)) holderTops = new WeakMap();
  });
  // Only what the page drew before it first left the screen was seen.
  const noteEndsSeenUntilLeft = () => {
    if (hiddenAt === null) noteShownEndsSeen(Date.now());
  };
  // A page that unloads while hidden says it's hidden once more, but has been away since it was
  // first hidden.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (hiddenAt !== null) closeForgottenDialogs(hiddenAt);
      noteShownEndsSeen(Date.now());
      hiddenAt = null;
    } else {
      noteEndsSeenUntilLeft();
      hiddenAt = readLeftAt();
      saveLastSeen(readShown, hiddenAt);
    }
  });
  addEventListener("pagehide", () => {
    noteEndsSeenUntilLeft();
    saveLastSeen(readShown, readLeftAt());
  });
}
