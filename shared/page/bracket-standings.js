import { setTabStart } from "./page-tabs.js";
import { showPillName } from "./pill-thumb.js";
import { createSlidePanels } from "./slide-panels.js";
import { readSelectedTab, wireTabList } from "./tabs.js";

// One tab holds a season's standings and its bracket, side by side under a pill, one shown at a
// time, as slide-panels.js moves them: a tap on a name slides to its part, and a swipe drags the
// shown part with the other beside it, though a swipe on the bracket scrolls it until it reaches
// its end, as a team's Roster does on its sheet. Until the playoff field is set the tab is named
// Standings and opens on them; from then on, through the offseason, it's named Bracket and opens
// on the bracket. The one it opens on comes first in the pill. Both parts share the page's scroll,
// so the one not shown holds itself down by as far as the page has scrolled the shown one up under
// the pill, and a swipe brings it in from its top.

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
// The part the page's scroll belongs to, which a slide leaves only once it comes to rest.
let restingPart = "";

// How far down the screen the pill holds, which is under anything else held to the top.
const readPillTop = () => parseFloat(getComputedStyle(findPill()).top) || 0;

// The page's scroll position that puts the top of the parts just under the pill.
const measurePartsTopScroll = () =>
  findParts().getBoundingClientRect().top + scrollY - readPillTop() - findPill().offsetHeight;

// The pill fills with the page's color once the parts scroll under it, and the part not shown
// moves down by as much as the page has scrolled the shown one up under it. Back at the page's
// top, the parts let go of the room they held, which moves nothing there.
function followPageScroll() {
  if (!findPill().offsetHeight) return;
  const offset = Math.max(0, scrollY - measurePartsTopScroll());
  findPill().classList.toggle("stuck", offset > 0);
  for (const part of readOrder()) {
    findPart(part).style.translate = offset > 0 && part !== restingPart ? `0 ${offset}px` : "";
  }
  if (scrollY < 1) delete findParts().dataset.holdingRoom;
}

// A part a swipe brings in from far down a longer one starts just under the pill, so the parts
// hold the room under it until the page is back at its top, even when the part is shorter, rather
// than let the page jump to its end. The page's height and scroll are whole pixels, so the room
// takes a pixel more, or parts that start a fraction of a pixel down the page would stop just short
// of the pill. A hidden pill has no height to measure, so the room waits until the parts show.
function fitPartsToRoomUnderPill() {
  if (!findPill().offsetHeight) return;
  const bottomPadding = parseFloat(getComputedStyle(document.body).paddingBottom);
  const room = Math.ceil(innerHeight - bottomPadding - readPillTop() - findPill().offsetHeight) + 1;
  const value = `${room}px`;
  if (findParts().style.getPropertyValue("--room-under-pill") !== value)
    findParts().style.setProperty("--room-under-pill", value);
}

// The parts set off for a part, and hold the room under the pill for it once it comes in from far
// down the other, before the other gives up its height.
/**
 * @param {number} index
 * @param {boolean} isSliding
 */
function showOn(index, isSliding) {
  const part = readOrder()[index];
  if (part !== restingPart && scrollY > measurePartsTopScroll())
    findParts().dataset.holdingRoom = "";
  showPillName(findTabList(), part, { isHandoff: isSliding });
}

// A part newly at rest keeps its place on screen: the page scrolls back by as much as it held the
// part down.
/** @param {number} index */
function restOn(index) {
  const part = readOrder()[index];
  if (part !== restingPart) {
    const partsTopScroll = measurePartsTopScroll();
    restingPart = part;
    if (scrollY > partsTopScroll) scrollTo({ top: partsTopScroll, behavior: "instant" });
  }
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
 * row does. A part newly shown starts at its top, just under the pill.
 * @param {SeasonPart} part
 * @param {{ isInstant?: boolean }} [options]
 */
export function showSeasonPart(part, { isInstant = false } = {}) {
  const index = readOrder().indexOf(part);
  if (!panels) return;
  if (isInstant) panels.jumpTo(index);
  else if (index !== panels.readShown()) panels.slideTo(index);
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

// A tap on the tab while it shows, with the page at its top, slides back to the part it's named for.
function returnToFirstPart() {
  if (panels && panels.readShown() !== 0) panels.slideTo(0);
}

// The pill and the tab's two faces, its name and icon for each part, are drawn whole, as they last
// showed (show-last-drawn.js), until the season says where it is.
export function startBracketStandings() {
  const slidePanels = createSlidePanels(findParts(), {
    listPanels: () => readOrder().map(findPart),
    place: (index, position) => index - position,
    canGo: (direction) => Boolean(readOrder()[slidePanels.readShown() + direction]),
    onShow: showOn,
    onSettle: restOn,
  });
  panels = slidePanels;
  slidePanels.jumpTo(readOrder().indexOf(readShownPart()));
  wireTabList(findPill(), (part) => showSeasonPart(/** @type {SeasonPart} */ (part)));
  setTabStart("bracket-standings", returnToFirstPart);
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
