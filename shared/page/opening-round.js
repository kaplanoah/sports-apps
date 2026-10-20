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
 * Starts at the bracket's beginning when it isn't on a phone or that already shows the target's
 * round, so the rounds before it stay in view; otherwise brings the target to the left edge.
 * @param {HTMLElement} scroller @param {HTMLElement} target
 * @param {ScrollBehavior} [behavior]
 */
function scrollToTarget(scroller, target, behavior = "instant") {
  if (!isPhone() || isShownFromStart(scroller, target)) {
    scroller.scrollTo({ left: 0, behavior });
    return;
  }
  const padding = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0;
  const offset = target.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  scroller.scrollTo({ left: scroller.scrollLeft + offset - padding, behavior });
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
    wasShown = isShown;
  }).observe(wrap);
  openingRoundReturns.add((behavior) => {
    if (drawn) scrollToTarget(drawn.scroller, drawn.target, behavior);
  });

  /** @param {{ scroller: HTMLElement, target: HTMLElement, round: number, keptLeft: number }} draw */
  return ({ scroller, target, round, keptLeft }) => {
    const isPutBack = !drawn && keptLeft > 0;
    const isNewRound = round !== drawn?.round;
    drawn = { scroller, target, round };
    if (isNewRound && !isPutBack) scrollToTarget(scroller, target);
    else scroller.scrollLeft = keptLeft;
  };
}
