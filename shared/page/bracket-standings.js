import { markBarHeld, markBarStuck } from "./held-bar.js";
import { findKeptTop, findShortfall } from "./kept-place.js";
import { showOpeningRound } from "./opening-round.js";
import { setTabStart } from "./page-tabs.js";
import { showPillName } from "./pill-thumb.js";
import { startRiderTaps } from "./rider-taps.js";
import { holdRoundDots } from "./round-dots.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { watchTimeAway } from "./resume.js";
import { findPartHolding } from "./season-part.js";
import { createSlidePanels } from "./slide-panels.js";
import { isAsFarAs, isAwayFrom, scrollWithSpring } from "./spring-scroll.js";
import { readSelectedTab, wireTabList } from "./tabs.js";

/* global followSeasonPart, listAboveSeasonView -- from season-header.js */
/* global isAwayLong -- from long-away.js */

// One tab holds a season's standings and its bracket, side by side under a pill, one shown at a
// time, as slide-panels.js moves them: a tap on a name slides to its part, and a swipe drags the
// shown part with the other beside it, though a swipe on the bracket scrolls it until it reaches
// its end, as a team's Roster does on its sheet. Until the playoff field is set the tab is named
// Standings and opens on them; from then on, through the offseason, it's named Bracket and opens
// on the bracket. The one it opens on comes first in the pill. Each part scrolls on its own
// (pager.css), as a sheet's sections do, so each keeps its place while the other shows and a slide
// never scrolls the page. Where the header rides up over the part until the pill holds at the top
// (season-header.js), the page holds still; where it stays put, the page scrolls only to bring a
// view a tall Updates box squeezes into sight.

/** @typedef {"standings" | "bracket"} SeasonPart */

/**
 * The tab's parts in the pill's order, the one it's named for and opens on first.
 * @param {boolean} isFieldSet whether the season's playoff field is set
 * @returns {SeasonPart[]}
 */
export const orderSeasonParts = (isFieldSet) =>
  isFieldSet ? ["bracket", "standings"] : ["standings", "bracket"];

const findView = () =>
  /** @type {HTMLElement} */ (document.getElementById("view-bracket-standings"));
const findPill = () => /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
const findTabFaces = () =>
  /** @type {HTMLElement[]} */ ([...document.querySelectorAll("#tab-bracket-standings .tab-face")]);
const findParts = () =>
  /** @type {HTMLElement} */ (document.getElementById("bracketStandingsParts"));
/** @param {string} part */
const findPart = (part) =>
  /** @type {HTMLElement} */ (findParts().querySelector(`:scope > [data-part="${part}"]`));
const findPillTabs = () =>
  /** @type {HTMLButtonElement[]} */ ([...findPill().querySelectorAll("[role=tab]")]);
const findTabList = () => /** @type {HTMLElement} */ (findPill().querySelector("[role=tablist]"));

const readOrder = () => findPillTabs().map((tab) => tab.dataset.tab ?? "");

/** The part the pill names as shown. */
const readShownPart = () => readSelectedTab(findPillTabs());

/** @type {ReturnType<typeof createSlidePanels> | null} */
let panels = null;

// The bracket's round dots stay over the tab bar while the parts slide (round-dots.js), even when
// the screen resizes or the bracket's part scrolls as they do.
const holdBracketDots = () => holdRoundDots(findPart("bracket"));
const holdBracketDotsWhileSliding = () => {
  if (findParts().hasAttribute("data-sliding")) holdBracketDots();
};

/**
 * How far a part scrolls before the pill holds at the top, as season-header.js measures it, or 0
 * where the header stays put.
 */
const readHeaderReach = () => parseFloat(findView().style.getPropertyValue("--header-reach")) || 0;

/**
 * Where the parts start, under the pill, where the header rides, or null before season-header.js
 * has measured it.
 */
function readPartsTop() {
  const top = parseFloat(findView().style.getPropertyValue("--parts-top"));
  return Number.isNaN(top) ? null : top;
}

/** Where the parts started as each part's scroll last matched it, by part. */
/** @type {WeakMap<HTMLElement, number>} */
const keptPartsTops = new WeakMap();

// Where the header rides, what's above the pill, like the Updates box or the header's lines, pads
// the parts down as it grows, so each part scrolled keeps its rows where they are on the screen,
// and a pill held stays held (kept-place.js). The ride is measured whenever what's above changes
// size, frame by frame as it eases, and again as the tab shows after a change while it didn't.
function keepPartsPlace() {
  const partsTop = readPartsTop();
  if (partsTop === null) return;
  for (const part of readOrder().map(findPart)) {
    const kept = keptPartsTops.get(part) ?? partsTop;
    const wanted = findKeptTop(part.scrollTop, partsTop - kept);
    if (partsTop !== kept) part.scrollTop = wanted;
    keptPartsTops.set(part, partsTop - findShortfall(wanted, part.scrollTop));
  }
}

// The pill holds once the part shown has scrolled as far as the header rides, and ends in its line
// once the part scrolls on under it.
function markPillHeld() {
  const part = findPart(readShownPart());
  const reach = readHeaderReach();
  markBarHeld(findPill(), part, reach);
  markBarStuck(findPill(), part, reach);
}

/**
 * Where a part a switch brings in starts, so the header rides over it as it does over the part
 * shown: once the header has gone, the part stays where it was left, but never so high that the
 * header comes back, and while the header still shows, the parts are scrolled alike.
 * @param {number} shownTop how far the part shown is scrolled
 * @param {number} comingTop how far the part coming in was left scrolled
 * @param {number} reach how far a part scrolls before the pill holds at the top
 */
export const findTopToShow = (shownTop, comingTop, reach) =>
  isAsFarAs(shownTop, reach) ? Math.max(comingTop, reach) : shownTop;

/**
 * Scrolls a part a switch brings in to where the header rides as it does over the part the pill
 * still names, before it shows.
 * @param {HTMLElement} part
 */
function placeComingPart(part) {
  const shownPart = findPart(readShownPart());
  if (part === shownPart) return;
  part.scrollTop = findTopToShow(shownPart.scrollTop, part.scrollTop, readHeaderReach());
}

// A swipe brings in the part beside the one shown, which shows as soon as the finger moves it. The
// round dots hold from where the bracket ends up, so they follow its placing.
function placePartsBeside() {
  if (findParts().dataset.sliding === "finger") {
    for (const part of readOrder().map(findPart)) placeComingPart(part);
  }
  holdBracketDots();
}

// The header rides with the part the parts set off for from the start of a slide, which a switch
// placed to hold it where it was, so it holds still while the parts slide, whatever the part
// leaving still scrolls. A slide that turns back before it rests finds the part it brings back
// already on screen, where it stays as it is.
/**
 * @param {number} index
 * @param {boolean} isSliding
 */
function showOn(index, isSliding) {
  const part = findPart(readOrder()[index]);
  if (isSliding && !findParts().hasAttribute("data-sliding")) placeComingPart(part);
  followSeasonPart(part);
  showPillName(findTabList(), readOrder()[index], { isHandoff: isSliding });
  markPillHeld();
}

/**
 * Brings `element` up just under the pill, held at the top with the header gone, as a search's row
 * for a part of the standings asks.
 * @param {Element} element
 */
export function scrollUnderPill(element) {
  const part = /** @type {HTMLElement} */ (findPartHolding(element));
  const top =
    element.getBoundingClientRect().top -
    part.getBoundingClientRect().top +
    part.scrollTop -
    parseFloat(getComputedStyle(part).paddingTop) +
    readHeaderReach();
  part.scrollTo({ top, behavior: "instant" });
}

/**
 * Where `element`, in a part of the tab, starts down the screen with its part and the page at their
 * tops, so what a bracket sizes from it holds however far either is scrolled.
 * @param {Element} element
 */
export const measureTopAtRest = (element) =>
  element.getBoundingClientRect().top +
  /** @type {HTMLElement} */ (findPartHolding(element)).scrollTop +
  scrollY;

/**
 * Has `observer` watch what sets the room for `element`'s part: the part itself, and what stands
 * above the tab's view, which moves the part's top where a tall Updates box holds the view at its
 * least height (chrome.css), or its padding where the header rides (season-header.js).
 * @param {ResizeObserver} observer
 * @param {Element} element
 */
export function observeRoomForPart(observer, element) {
  observer.observe(/** @type {HTMLElement} */ (findPartHolding(element)));
  for (const above of listAboveSeasonView()) observer.observe(above);
}

/**
 * Slides to one of the tab's parts, as a tap on its name does, showing it where it was left, or
 * shows it at once from its top, as a search's row does.
 * @param {SeasonPart} part
 * @param {{ isInstant?: boolean }} [options]
 */
export function showSeasonPart(part, { isInstant = false } = {}) {
  const index = readOrder().indexOf(part);
  if (!panels) return;
  if (!isInstant) {
    if (index !== panels.readShown()) panels.slideTo(index);
    return;
  }
  // The top asked for wins over a place a reload put back for a part not shown since.
  const element = findPart(part);
  delete element.dataset.putBackTop;
  element.scrollTo({ top: 0, behavior: "instant" });
  panels.jumpTo(index);
}

/**
 * Names the tab and orders the pill for where the season is. Once the playoff field is set, or
 * once it no longer is, as when another season shows, the tab opens on its new first part. Both
 * change at once, as a tab bar's names do, rather than easing in with the season's new data.
 * @param {boolean} isFieldSet
 */
export function showSeasonPhase(isFieldSet) {
  const order = orderSeasonParts(isFieldSet);
  for (const face of findTabFaces()) face.hidden = face.dataset.part !== order[0];
  if (order.join() === readOrder().join()) return;
  const tabs = new Map(findPillTabs().map((tab) => [tab.dataset.tab, tab]));
  findTabList().append(...order.map((part) => /** @type {HTMLButtonElement} */ (tabs.get(part))));
  placeComingPart(findPart(order[0]));
  panels?.jumpTo(0);
}

// A tap on the tab while it shows scrolls the part shown back to its top, as a tab bar's tap does
// a list, and once it's there, takes the tab back to where it opens: the part it's named for, and a
// bracket on its round in progress, as Games goes back to today. A bracket out of sight moves at
// once, before it slides in.
function returnToStart() {
  if (!panels) return;
  const shownPart = findPart(readShownPart());
  if (isAwayFrom(shownPart, 0)) {
    scrollWithSpring(shownPart, 0);
    return;
  }
  const isBracketShown = readOrder()[panels.readShown()] === "bracket";
  if (readOrder()[0] === "bracket")
    showOpeningRound(isBracketShown && !prefersReducedMotion() ? "smooth" : "instant");
  if (panels.readShown() !== 0) panels.slideTo(0);
}

// After two minutes away, the tab starts over, as the page does (long-away.js): each part at its
// top, with the header back, the pill on the part the tab is named for, and the bracket on its
// opening round. A part on a tab not shown takes its top once it shows (season-header.js). Safari
// loses a scroll made as the page comes back, before it draws again, so the parts move in the
// first frame it draws.
function startOver() {
  for (const part of readOrder().map(findPart)) {
    part.scrollTop = 0;
    if (part.getClientRects().length) delete part.dataset.putBackTop;
    else part.dataset.putBackTop = "0";
  }
  panels?.jumpTo(0);
  showOpeningRound("instant");
}

/** @param {number} awayMs */
function startOverAfterLongAway(awayMs) {
  if (isAwayLong(awayMs)) requestAnimationFrame(startOver);
}

// The pill and the tab's two faces, its name and icon for each part, are drawn whole, as they last
// showed (show-last-drawn.js), until the season says where it is.
export function startBracketStandings() {
  const slidePanels = createSlidePanels(findParts(), {
    listPanels: () => readOrder().map(findPart),
    place: (index, position) => index - position,
    canGo: (direction) => Boolean(readOrder()[slidePanels.readShown() + direction]),
    onSetOff: placePartsBeside,
    onShow: showOn,
  });
  panels = slidePanels;
  keepPartsPlace();
  slidePanels.jumpTo(readOrder().indexOf(readShownPart()));
  wireTabList(findPill(), (part) => showSeasonPart(/** @type {SeasonPart} */ (part)));
  setTabStart("bracket-standings", returnToStart);
  for (const part of readOrder().map(findPart))
    part.addEventListener("scroll", markPillHeld, { passive: true });
  findView().addEventListener("headerride", () => {
    keepPartsPlace();
    markPillHeld();
  });
  startRiderTaps(findView(), findPill(), readOrder().map(findPart));
  findPart("bracket").addEventListener("scroll", holdBracketDotsWhileSliding, { passive: true });
  addEventListener("resize", holdBracketDotsWhileSliding);
  watchTimeAway(startOverAfterLongAway);
}
