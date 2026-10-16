import { html, setHtml } from "#shared/html.js";
import { watchOpeningRound } from "#shared/opening-round.js";
import { markScrolledRound } from "#shared/round-dots.js";
import { BRACKET_FEEDERS } from "./series.js";

/** @typedef {{ x: number, y: number }} Point */

// The bracket on the page: its lines, which need the cards' places, and where it scrolls to.

const findWrap = () => /** @type {HTMLElement} */ (document.getElementById("bracketWrap"));
const findTree = () => /** @type {HTMLElement | null} */ (findWrap().querySelector(".bracket"));
const isShown = (/** @type {HTMLElement} */ element) => element.getClientRects().length > 0;

// The cards spread at most this many times their tightest gap.
const MAX_GAP_GROWTH = 1.45;
const GAPS_BETWEEN_CARDS = 3;
const ROUND_DOTS_CLEARANCE = 12;

/** @type {ReturnType<typeof watchOpeningRound> | null} */
let placeOpeningRound = null;
/** @type {ResizeObserver | null} */
let resizes = null;
/** @type {HTMLElement | null} */
let watchedTree = null;

/**
 * Where the line between a card's two teams meets its edge, in the tree's own scrolling
 * coordinates.
 * @param {HTMLElement} tree
 * @param {Element} card
 * @param {"left" | "right"} edge
 * @returns {Point}
 */
function readPoint(tree, card, edge) {
  const treeBox = tree.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const bottomLine = /** @type {HTMLElement} */ (card.querySelectorAll(".team-line")[1]);
  return {
    x: (edge === "right" ? cardBox.right : cardBox.left) - treeBox.left + tree.scrollLeft,
    y: bottomLine.getBoundingClientRect().top + bottomLine.clientTop / 2 - treeBox.top,
  };
}

/**
 * A bracket joining two series to the one they feed, turning halfway between the rounds: the lines
 * from each series to the turn and on into the one they feed, and the turn itself, which reaches
 * half the lines' width past them so its corners are square.
 * @param {Point} upper
 * @param {Point} lower
 * @param {Point} next
 */
function buildBracket(upper, lower, next) {
  const turn = (upper.x + next.x) / 2;
  return {
    lines: `M${upper.x} ${upper.y} H${turn} M${lower.x} ${lower.y} H${turn} M${turn} ${next.y} H${next.x}`,
    turn: `M${turn} ${upper.y - 0.5} V${lower.y + 0.5}`,
  };
}

/**
 * @param {SVGSVGElement} svg
 * @param {HTMLElement} tree
 * @param {{ next: string, shape: string }[]} paths
 */
function drawPaths(svg, tree, paths) {
  svg.setAttribute("width", String(tree.scrollWidth));
  svg.setAttribute("height", String(tree.scrollHeight));
  setHtml(
    svg,
    html`${paths.map(({ next, shape }) => html`<path data-next="${next}" d="${shape}"/>`)}`,
  );
}

/** @param {HTMLElement} tree */
function drawLines(tree) {
  const findCard = (/** @type {string} */ id) =>
    /** @type {Element} */ (tree.querySelector(`[data-series="${id}"]`));
  const brackets = Object.entries(BRACKET_FEEDERS).map(([next, [upper, lower]]) => ({
    next,
    ...buildBracket(
      readPoint(tree, findCard(upper), "right"),
      readPoint(tree, findCard(lower), "right"),
      readPoint(tree, findCard(next), "left"),
    ),
  }));
  const findSvg = (/** @type {string} */ selector) =>
    /** @type {SVGSVGElement} */ (tree.querySelector(selector));
  drawPaths(
    findSvg(".bracket-lines"),
    tree,
    brackets.map(({ next, lines }) => ({ next, shape: lines })),
  );
  drawPaths(
    findSvg(".bracket-turns"),
    tree,
    brackets.map(({ next, turn }) => ({ next, shape: turn })),
  );
}

/**
 * Tells the bracket how far it has scrolled, so a turn in the screen's left margin hides and the
 * lines into the round beside it run off the screen's edge.
 * @param {HTMLElement} tree
 */
const markScrollLeft = (tree) => tree.style.setProperty("--scroll-left", `${tree.scrollLeft}px`);

/**
 * While the round dots are pinned above a phone's tab bar, the gaps between the cards grow alike
 * so the bracket reaches down to them.
 * @param {HTMLElement} tree
 */
function sizeCardGaps(tree) {
  const dots = /** @type {HTMLElement} */ (findWrap().querySelector(".round-dots"));
  if (!isShown(dots) || getComputedStyle(dots).position !== "fixed") {
    tree.style.removeProperty("--card-gap");
    return;
  }
  const style = getComputedStyle(tree);
  const tightestGap = parseFloat(style.getPropertyValue("--tightest-card-gap"));
  const gap = parseFloat(style.getPropertyValue("--card-gap"));
  const tightestHeight = tree.offsetHeight - GAPS_BETWEEN_CARDS * (gap - tightestGap);
  const top = tree.getBoundingClientRect().top + scrollY;
  const room = dots.getBoundingClientRect().top - ROUND_DOTS_CLEARANCE - top;
  const fittingGap = tightestGap + (room - tightestHeight) / GAPS_BETWEEN_CARDS;
  const grownGap = Math.min(tightestGap * MAX_GAP_GROWTH, Math.max(tightestGap, fittingGap));
  // Half pixels still fall on a phone's screen pixels, and leave the cards at most a pixel and a
  // half short of the dots across their three gaps.
  tree.style.setProperty("--card-gap", `${Math.floor(grownGap * 2) / 2}px`);
}

// A hidden tab has no layout to measure, so its spacing and lines wait until it shows.
function layOutBracket() {
  const tree = findTree();
  if (!tree || !isShown(tree)) return;
  sizeCardGaps(tree);
  drawLines(tree);
  markScrollLeft(tree);
}

function markVisibleRound() {
  const tree = findTree();
  if (!tree) return;
  markScrollLeft(tree);
  const names = /** @type {HTMLElement[]} */ ([...tree.querySelectorAll(".round-name")]);
  const dots = /** @type {HTMLElement} */ (findWrap().querySelector(".round-dots"));
  markScrolledRound(tree, names, dots);
}

function layOutAndMarkRound() {
  layOutBracket();
  markVisibleRound();
}

// The cards move when the screen resizes, the tab shows, the header above them changes, or a font
// arrives and changes their rows.
export function startBracket() {
  const wrap = findWrap();
  placeOpeningRound = watchOpeningRound(wrap);
  // Laying the bracket out resizes what this observes, so it waits a frame rather than loop the
  // observer, and only while the bracket shows. The standings sliding in beside it change the
  // page's height but not the bracket, so it holds still until they rest.
  resizes = new ResizeObserver(() => {
    if (isShown(wrap) && !wrap.closest("[data-sliding]")) requestAnimationFrame(layOutAndMarkRound);
  });
  resizes.observe(wrap);
  resizes.observe(document.body);
  addEventListener("resize", layOutBracket);
  wrap.addEventListener("scroll", markVisibleRound, { capture: true, passive: true });
  document.fonts.addEventListener("loadingdone", layOutBracket);
}

// Observing an element reports its size at once, which asks for a frame, so a redraw that keeps
// the tree leaves the page at rest.
/** @param {HTMLElement} tree */
function watchTree(tree) {
  if (!resizes || tree === watchedTree) return;
  if (watchedTree) resizes.unobserve(watchedTree);
  resizes.observe(tree);
  watchedTree = tree;
}

/** Where the reader has scrolled the bracket, to keep across a redraw. */
export const readBracketScroll = () => findTree()?.scrollLeft ?? 0;

/**
 * After each draw: opens the bracket on its opening round or keeps the reader's place, spaces
 * its cards, and draws its lines.
 * @param {number} keptLeft
 */
export function placeBracket(keptLeft) {
  const tree = findTree();
  if (!tree) return;
  const round = Number(tree.dataset.openingRound);
  const target = /** @type {HTMLElement} */ (
    tree.querySelector(`.round-name[data-round="${round}"]`)
  );
  placeOpeningRound?.({ scroller: tree, target, round, keptLeft });
  watchTree(tree);
  layOutBracket();
  markVisibleRound();
}
