import { showPillName } from "./pill-thumb.js";
import { readSelectedTab, wireTabList } from "./tabs.js";

// One tab holds a season's standings and its bracket, under a pill whose tap switches between them
// in place, as pager.css hides the one not chosen. Until the playoff field is set the tab is named
// Standings and opens on them; from then on, through the offseason, it's named Bracket and opens
// on the bracket. The one it opens on comes first in the pill. The bracket scrolls sideways
// between its rounds, so the pill switches only on a tap, never a swipe.

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
const findPillTabs = () =>
  /** @type {HTMLButtonElement[]} */ ([...findPill().querySelectorAll("[role=tab]")]);
const findTabList = () => /** @type {HTMLElement} */ (findPill().querySelector("[role=tablist]"));

const readOrder = () => findPillTabs().map((tab) => tab.dataset.tab);

/** The part the tab shows. */
const readShownPart = () => readSelectedTab(findPillTabs());

// How far down the screen the pill holds, which is under anything else held to the top.
const readPillTop = () => parseFloat(getComputedStyle(findPill()).top) || 0;

// The page's scroll position that puts the top of the parts just under the pill.
const measurePartsTopScroll = () =>
  findParts().getBoundingClientRect().top + scrollY - readPillTop() - findPill().offsetHeight;

// The pill fills with the page's color once the parts scroll under it, as a pager's does.
function markPillHeld() {
  if (!findPill().offsetHeight) return;
  findPill().classList.toggle("stuck", scrollY > measurePartsTopScroll());
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
 * Shows one of the tab's parts. A part newly shown starts at its top, just under the pill, when
 * the page had scrolled the other one up under it.
 * @param {SeasonPart} part
 * @param {{ isHandoff?: boolean }} [options] fades the pill's block over, as a tap does
 */
export function showSeasonPart(part, { isHandoff = false } = {}) {
  if (part === readShownPart()) return;
  const partsTopScroll = measurePartsTopScroll();
  showPillName(findTabList(), part, { isHandoff });
  if (scrollY > partsTopScroll) scrollTo({ top: partsTopScroll, behavior: "instant" });
  markPillHeld();
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
  showPillName(findTabList(), order[0]);
  markPillHeld();
}

// The pill and the tab's two faces, its name and icon for each part, are drawn whole, as they last
// showed (show-last-drawn.js), until the season says where it is.
export function startBracketStandings() {
  wireTabList(findPill(), (part) =>
    showSeasonPart(/** @type {SeasonPart} */ (part), { isHandoff: true }),
  );
  addEventListener("scroll", markPillHeld, { passive: true });
  addEventListener("resize", markPillHeld);
  // The pill takes its size as its tab shows, where the page may be scrolled elsewhere than when
  // it left.
  new ResizeObserver(markPillHeld).observe(findPill());
}
