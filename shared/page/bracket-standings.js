import { showOpeningRound } from "./opening-round.js";
import { setTabStart } from "./page-tabs.js";
import { showPillName } from "./pill-thumb.js";
import { holdRoundDots } from "./round-dots.js";
import { createSlidePanels, prefersReducedMotion } from "./slide-panels.js";
import { readSelectedTab, wireTabList } from "./tabs.js";

// One tab holds a season's standings and its bracket, side by side under a pill, one shown at a
// time, as slide-panels.js moves them: a tap on a name slides to its part, and a swipe drags the
// shown part with the other beside it, though a swipe on the bracket scrolls it until it reaches
// its end, as a team's Roster does on its sheet. Until the playoff field is set the tab is named
// Standings and opens on them; from then on, through the offseason, it's named Bracket and opens
// on the bracket. The one it opens on comes first in the pill. Both parts share the page's scroll,
// so the one not shown holds itself down by as far as the page has scrolled the shown one up under
// the pill, and a swipe brings it in from its top. As the parts set off, the page's scroll goes to
// the part coming in, at its top, and the part leaving holds itself up by as much instead, so the
// scroll holds still as they come to rest and the part leaving gives up its height: an iPhone that
// scrolls the page in the same frame as it shrinks flashes everything that scrolls.

/** @typedef {"standings" | "bracket"} SeasonPart */

/**
 * The tab's parts in the pill's order, the one it's named for and opens on first.
 * @param {boolean} isFieldSet whether the season's playoff field is set
 * @returns {SeasonPart[]}
 */
export const orderSeasonParts = (isFieldSet) =>
  isFieldSet ? ["bracket", "standings"] : ["standings", "bracket"];

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
// The part the page's scroll belongs to, which a slide hands to the part coming in as it sets off.
let scrollPart = "";
// The part that gave up the page's scroll as the parts set off, held up by as far as the page had
// scrolled it under the pill, until they rest.
let leavingPart = "";
let heldUp = 0;

// How far down the screen the pill holds, which is under anything else held to the top.
const readPillTop = () => parseFloat(getComputedStyle(findPill()).top) || 0;

// The page's scroll position that puts the top of the parts just under the pill.
const measurePartsTopScroll = () =>
  findParts().getBoundingClientRect().top + scrollY - readPillTop() - findPill().offsetHeight;

// The bracket's round dots stay over the tab bar while the parts slide (round-dots.js).
const holdBracketDots = () => holdRoundDots(findPart("bracket"));

// The pill fills with the page's color once the parts scroll under it, or while a part leaving
// holds itself up under it. The part not shown moves down by as much as the page has scrolled the
// shown one up under it, but while the parts slide, the part leaving holds itself up instead, by as
// far as the page had scrolled it under the pill. Back at the page's top, the parts let go of the
// room they held, which moves nothing there. Parts that slide while the page scrolls or the screen
// resizes hold the bracket's dots again where they now are.
function followPageScroll() {
  if (!findPill().offsetHeight) return;
  const offset = Math.max(0, scrollY - measurePartsTopScroll());
  findPill().classList.toggle("stuck", offset > 0 || heldUp > 0);
  for (const part of readOrder()) {
    const shift = part === scrollPart ? 0 : offset - (part === leavingPart ? heldUp : 0);
    findPart(part).style.translate = shift ? `0 ${shift}px` : "";
  }
  if (scrollY < 1) delete findParts().dataset.holdingRoom;
  if (findParts().hasAttribute("data-sliding")) holdBracketDots();
}

// A part a swipe brings in from far down a longer one starts just under the pill, so the parts
// hold the room under it until the page is back at its top, even when the part is shorter, rather
// than let the page jump to its end. The page's height and scroll are whole pixels, so the room
// takes a pixel more, or parts that start a fraction of a pixel down the page would stop just short
// of the pill. A hidden pill has no height to measure, so the room waits until the parts show. The
// room is measured again as the parts start to hold it, since a Home Screen app can grow as it
// opens without a resize to say so.
function fitPartsToRoomUnderPill() {
  if (!findPill().offsetHeight) return;
  const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
  const room = Math.ceil(innerHeight - bottomPadding - readPillTop() - findPill().offsetHeight) + 1;
  const value = `${room}px`;
  if (findParts().style.getPropertyValue("--room-under-pill") !== value)
    findParts().style.setProperty("--room-under-pill", value);
}

function holdRoomUnderPill() {
  fitPartsToRoomUnderPill();
  findParts().dataset.holdingRoom = "";
}

// The parts set off for a part, and hold the room under the pill for it once it comes in from far
// down the other, before the other gives up its height.
/**
 * @param {number} index
 * @param {boolean} isSliding
 */
function showOn(index, isSliding) {
  const part = readOrder()[index];
  if (part !== scrollPart && scrollY > measurePartsTopScroll()) holdRoomUnderPill();
  showPillName(findTabList(), part, { isHandoff: isSliding });
}

// Brings the page up so the parts start just under the pill, when it's further down.
function scrollUpToPartsTop() {
  const partsTopScroll = measurePartsTopScroll();
  if (scrollY > partsTopScroll) scrollTo({ top: partsTopScroll, behavior: "instant" });
}

// As the parts set off, the page's scroll goes to the part not shown, which starts at its top just
// under the pill, while both parts still take their room: the page scrolls up to the parts' top,
// and the part leaving holds its place on screen by as much.
function handOverScroll() {
  const offset = Math.max(0, scrollY - measurePartsTopScroll());
  if (offset > 0) {
    holdRoomUnderPill();
    leavingPart = scrollPart;
    heldUp = offset;
    scrollTo({ top: scrollY - offset, behavior: "instant" });
  }
  scrollPart = readOrder().find((part) => part !== scrollPart) ?? scrollPart;
  followPageScroll();
}

// Parts that come to rest on the part that left, as a swipe that falls short does, give it back the
// page's scroll where it was. A part shown at once, with no slide to hand it the scroll, starts at
// its top just under the pill.
/** @param {number} index */
function restOn(index) {
  const part = readOrder()[index];
  if (part === leavingPart) scrollTo({ top: scrollY + heldUp, behavior: "instant" });
  else if (part !== scrollPart) scrollUpToPartsTop();
  scrollPart = part;
  leavingPart = "";
  heldUp = 0;
  followPageScroll();
}

/**
 * Brings `element` up just under the pill, as a search's row for a part of the standings asks.
 * @param {Element} element
 */
export function scrollUnderPill(element) {
  const top = element.getBoundingClientRect().top + scrollY;
  scrollTo({ top: top - readPillTop() - findPill().offsetHeight, behavior: "instant" });
}

/**
 * Slides to one of the tab's parts, as a tap on its name does, or shows it at once, as a search's
 * row does. A part newly shown starts at its top, just under the pill, and so does one a search's
 * row shows, even when it was showing further down.
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
  panels.jumpTo(index);
  scrollUpToPartsTop();
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
  panels?.jumpTo(0);
}

// A tap on the tab while it shows, with the page at its top, takes it back to where it opens: the
// part it's named for, and a bracket on its round in progress, as Games goes back to today. A
// bracket out of sight moves at once, before it slides in.
function returnToStart() {
  if (!panels) return;
  const isBracketShown = readOrder()[panels.readShown()] === "bracket";
  if (readOrder()[0] === "bracket")
    showOpeningRound(isBracketShown && !prefersReducedMotion() ? "smooth" : "instant");
  if (panels.readShown() !== 0) panels.slideTo(0);
}

// The pill and the tab's two faces, its name and icon for each part, are drawn whole, as they last
// showed (show-last-drawn.js), until the season says where it is.
export function startBracketStandings() {
  const slidePanels = createSlidePanels(findParts(), {
    listPanels: () => readOrder().map(findPart),
    place: (index, position) => index - position,
    canGo: (direction) => Boolean(readOrder()[slidePanels.readShown() + direction]),
    onSetOff: handOverScroll,
    onShow: showOn,
    onSettle: restOn,
  });
  panels = slidePanels;
  slidePanels.jumpTo(readOrder().indexOf(readShownPart()));
  wireTabList(findPill(), (part) => showSeasonPart(/** @type {SeasonPart} */ (part)));
  setTabStart("bracket-standings", returnToStart, { isAfterTop: true });
  addEventListener("scroll", followPageScroll, { passive: true });
  addEventListener("resize", () => {
    fitPartsToRoomUnderPill();
    followPageScroll();
  });
  // The pill takes its size as its tab shows, where the page may be scrolled elsewhere than when
  // it left. Following the scroll then moves only what takes no room, so the observer can't loop.
  new ResizeObserver(followPageScroll).observe(findPill());
  // Unlike a ResizeObserver's, an IntersectionObserver's callback may resize the page.
  new IntersectionObserver(fitPartsToRoomUnderPill).observe(findPill());
}
