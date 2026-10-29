import { PHONE_WIDTH_QUERY } from "./device.js";

// A bracket too wide for the screen scrolls sideways, and opens on the earliest round that still
// has a series to finish, so the games still to come are what the reader sees first.

/**
 * The earliest round with a series still to finish, or the last round once every one is decided.
 * @template T
 * @param {T[][]} rounds each round's series, first round first
 * @param {(series: T) => boolean} isDecided
 */
export function findOpeningRound(rounds, isDecided) {
  const index = rounds.findIndex((round) => !round.every(isDecided));
  return index === -1 ? rounds.length - 1 : index;
}

/**
 * Whether the bracket from its start through the target's round shows without scrolling.
 * @param {HTMLElement} scroller @param {HTMLElement} target
 */
function isShownFromStart(scroller, target) {
  const padding = parseFloat(getComputedStyle(scroller).scrollPaddingRight) || 0;
  const targetRight =
    target.getBoundingClientRect().right -
    scroller.getBoundingClientRect().left +
    scroller.scrollLeft;
  return targetRight <= scroller.clientWidth - padding;
}

// Only a phone opens partway along: a wider screen shows the bracket from its start.
const isPhone = () => matchMedia(PHONE_WIDTH_QUERY).matches;

/**
 * Where the bracket opens: at its beginning when it isn't on a phone or that already shows the
 * target's round, so the rounds before it stay in view; otherwise with the target at the left edge,
 * or as near it as the bracket's end lets it scroll.
 * @param {HTMLElement} scroller @param {HTMLElement} target
 */
function findTargetLeft(scroller, target) {
  if (!isPhone() || isShownFromStart(scroller, target)) return 0;
  const padding = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
  const offset = target.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  const endLeft = scroller.scrollWidth - scroller.clientWidth;
  return Math.min(scroller.scrollLeft + offset - padding, endLeft);
}

/**
 * @param {HTMLElement} scroller @param {HTMLElement} target
 * @param {ScrollBehavior} [behavior]
 */
function scrollToTarget(scroller, target, behavior = "instant") {
  scroller.scrollTo({ left: findTargetLeft(scroller, target), behavior });
}

// Where the bracket opens, which a page that loads again after two minutes away opens on
// (show-last-drawn.js).
/** @param {HTMLElement} scroller @param {HTMLElement} target */
function noteStartLeft(scroller, target) {
  scroller.dataset.startLeft = String(Math.round(findTargetLeft(scroller, target)));
}

/**
 * Where the reader left a bracket scrolled, read before a redraw to keep across it. A bracket a
 * reload put back on its opening round after two minutes away (show-last-drawn.js) has no place
 * of the reader's to keep, so its first draw opens it on the round still playing now.
 * @param {HTMLElement | null} scroller
 */
export function takeKeptScroll(scroller) {
  const isOnStart = scroller?.dataset.putBackStart === "true";
  const isRestored = !isOnStart && scroller?.dataset.putBackLeft !== undefined;
  const left = isOnStart ? 0 : (scroller?.scrollLeft ?? 0);
  if (scroller) {
    delete scroller.dataset.putBackStart;
    delete scroller.dataset.putBackLeft;
  }
  return { left, isRestored };
}

/** @type {Set<(behavior: ScrollBehavior) => void>} */
const openingRoundReturns = new Set();

/**
 * Brings the bracket back to its opening round, as it opens, from wherever the reader scrolled it.
 * @param {ScrollBehavior} behavior
 */
export function showOpeningRound(behavior) {
  for (const returnToOpeningRound of openingRoundReturns) returnToOpeningRound(behavior);
}

/**
 * Brings a sideways bracket to its opening round each time it comes into view, since a hidden tab
 * loses its scroll, and whenever that round changes. Any other redraw keeps the reader's place, as
 * does the first draw of a bracket a reload put back scrolled (show-last-drawn.js). Returns what
 * the app calls after each draw, with the scroller, the opening round's first series, that round's
 * index, and the scroll the bracket had before the draw.
 * @param {HTMLElement} wrap holds the bracket, and stays across redraws
 */
export function watchOpeningRound(wrap) {
  /** @type {{ scroller: HTMLElement, target: HTMLElement, round: number } | null} */
  let drawn = null;
  let wasShown = wrap.getClientRects().length > 0;
  new ResizeObserver(() => {
    const isShown = wrap.getClientRects().length > 0;
    if (isShown && !wasShown && drawn) scrollToTarget(drawn.scroller, drawn.target);
    if (isShown && drawn) noteStartLeft(drawn.scroller, drawn.target);
    wasShown = isShown;
  }).observe(wrap);
  openingRoundReturns.add((behavior) => {
    if (drawn) scrollToTarget(drawn.scroller, drawn.target, behavior);
  });

  /** @param {{ scroller: HTMLElement, target: HTMLElement, round: number, keptScroll: ReturnType<typeof takeKeptScroll> }} draw */
  return ({ scroller, target, round, keptScroll }) => {
    const isPutBack = !drawn && keptScroll.isRestored;
    const isNewRound = round !== drawn?.round;
    drawn = { scroller, target, round };
    if (isNewRound && !isPutBack) scrollToTarget(scroller, target);
    else scroller.scrollLeft = keptScroll.left;
    noteStartLeft(scroller, target);
  };
}
