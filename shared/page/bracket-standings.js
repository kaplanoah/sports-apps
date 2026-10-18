import { showOpeningRound } from "./opening-round.js";
import { setTabStart } from "./page-tabs.js";
import { showPillName } from "./pill-thumb.js";
import { holdRoundDots } from "./round-dots.js";
import { createSlidePanels, prefersReducedMotion } from "./slide-panels.js";
import { scrollWithSpring } from "./spring-scroll.js";
import { readSelectedTab, wireTabList } from "./tabs.js";

// One tab holds a season's standings and its bracket, side by side under a pill, one shown at a
// time, as slide-panels.js moves them: a tap on a name slides to its part, and a swipe drags the
// shown part with the other beside it, though a swipe on the bracket scrolls it until it reaches
// its end, as a team's Roster does on its sheet. Until the playoff field is set the tab is named
// Standings and opens on them; from then on, through the offseason, it's named Bracket and opens
// on the bracket. The one it opens on comes first in the pill. While the tab shows, the page holds
// still and each part scrolls on its own under the pill (pager.css), as a sheet's sections do, so
// each keeps its place while the other shows and a slide never scrolls the page.

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

// The bracket's round dots stay over the tab bar while the parts slide (round-dots.js), even when
// the screen resizes as they do.
const holdBracketDots = () => holdRoundDots(findPart("bracket"));
const holdBracketDotsWhileSliding = () => {
  if (findParts().hasAttribute("data-sliding")) holdBracketDots();
};

// The pill ends in a line once the part it names has scrolled under it.
const markStuck = () =>
  findPill().classList.toggle("stuck", findPart(readShownPart()).scrollTop > 0);

/**
 * @param {number} index
 * @param {boolean} isSliding
 */
function showOn(index, isSliding) {
  showPillName(findTabList(), readOrder()[index], { isHandoff: isSliding });
  markStuck();
}

/**
 * Brings `element` up just under the pill, as a search's row for a part of the standings asks.
 * @param {Element} element
 */
export function scrollUnderPill(element) {
  const part = /** @type {HTMLElement} */ (element.closest(".season-part"));
  const top =
    element.getBoundingClientRect().top - part.getBoundingClientRect().top + part.scrollTop;
  part.scrollTo({ top, behavior: "instant" });
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
  findPart(part).scrollTo({ top: 0, behavior: "instant" });
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
  panels?.jumpTo(0);
}

// A tap on the tab while it shows scrolls the part shown back to its top, as a tab bar's tap does
// a list, and once it's there, takes the tab back to where it opens: the part it's named for, and a
// bracket on its round in progress, as Games goes back to today. A bracket out of sight moves at
// once, before it slides in.
function returnToStart() {
  if (!panels) return;
  const shownPart = findPart(readShownPart());
  if (shownPart.scrollTop > 0) {
    scrollWithSpring(shownPart, 0);
    return;
  }
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
    onSetOff: holdBracketDots,
    onShow: showOn,
  });
  panels = slidePanels;
  slidePanels.jumpTo(readOrder().indexOf(readShownPart()));
  wireTabList(findPill(), (part) => showSeasonPart(/** @type {SeasonPart} */ (part)));
  setTabStart("bracket-standings", returnToStart);
  for (const part of readOrder().map(findPart))
    part.addEventListener("scroll", markStuck, { passive: true });
  addEventListener("resize", holdBracketDotsWhileSliding);
}
