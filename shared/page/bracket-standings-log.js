import { createStepLog } from "./step-log.js";

/** @param {Element} target */
const isOnParts = (target) => !!target.closest(".season-parts");

// What a season's standings and bracket do with each touch: each touch and click on them, and as
// the finger lifts, how far it moved, whether the page's own code took the touch from the browser,
// which stops the browser's scroll, and how far the page scrolled.
export const bracketStandingsLog = createStepLog({
  key: "diagnosticsBracketStandings",
  title: "Standings and bracket",
  isWatched: isOnParts,
});

/** @typedef {{ x: number, y: number }} Move */

/**
 * @param {number} distance
 * @param {[string, string]} ways the way a negative distance goes, then a positive one
 */
const describeDistance = (distance, [back, on]) =>
  `${Math.abs(Math.round(distance))} ${distance < 0 ? back : on}`;

/** @param {Move} move */
const describeMove = (move) =>
  `${describeDistance(move.x, ["left", "right"])} and ${describeDistance(move.y, ["up", "down"])}`;

/** @param {number} scrolled */
function describeScroll(scrolled) {
  const pixels = Math.round(scrolled);
  if (!pixels) return "the page didn't scroll";
  return `the page scrolled ${Math.abs(pixels)}px ${pixels < 0 ? "up" : "down"}`;
}

/**
 * What became of a touch, as its finger lifts or the browser cancels it.
 * @param {{ isCancelled: boolean, moved: Move, takenAt: Move | null, scrolled: number }} touch
 *   `takenAt` is how far the finger had moved when the page's code took the touch, or null when
 *   the browser kept it, and `scrolled` is how far the page scrolled down, or up when negative
 * @returns {string}
 */
export function describeTouchEnd({ isCancelled, moved, takenAt, scrolled }) {
  const end = `${isCancelled ? "cancelled" : "lifted"} after moving ${describeMove(moved)}`;
  const taken = takenAt
    ? `the page's code took the touch once it had moved ${describeMove(takenAt)}`
    : "the browser kept the touch";
  return `${end}; ${taken}; ${describeScroll(scrolled)}`;
}

/**
 * @param {Touch} point
 * @param {{ x: number, y: number }} origin
 * @returns {Move}
 */
const measureMove = (point, origin) => ({
  x: point.clientX - origin.x,
  y: point.clientY - origin.y,
});

/**
 * Logs, while Diagnostics is on, what became of each one-finger touch on the parts. It listens on
 * the window, which a touch reaches last, so a move shows whether any of the page's code stopped
 * the browser's scroll.
 */
export function watchTouches() {
  /** @type {{ origin: { x: number, y: number }, scrollY: number, moved: Move, takenAt: Move | null } | null} */
  let touch = null;

  /** @param {TouchEvent} event */
  function startTouch(event) {
    touch = null;
    if (!bracketStandingsLog.isLogging() || event.touches.length !== 1) return;
    if (!(event.target instanceof Element) || !isOnParts(event.target)) return;
    const { clientX, clientY } = event.touches[0];
    touch = { origin: { x: clientX, y: clientY }, scrollY, moved: { x: 0, y: 0 }, takenAt: null };
  }

  /** @param {TouchEvent} event */
  function followTouch(event) {
    if (!touch) return;
    if (event.touches.length !== 1) {
      touch = null;
      return;
    }
    touch.moved = measureMove(event.touches[0], touch.origin);
    if (event.defaultPrevented && !touch.takenAt) touch.takenAt = touch.moved;
  }

  /** @param {TouchEvent} event */
  function endTouch(event) {
    if (!touch) return;
    const { moved, takenAt } = touch;
    const scrolled = scrollY - touch.scrollY;
    touch = null;
    bracketStandingsLog.noteStep(
      describeTouchEnd({ isCancelled: event.type === "touchcancel", moved, takenAt, scrolled }),
    );
  }

  addEventListener("touchstart", startTouch, { passive: true });
  addEventListener("touchmove", followTouch, { passive: true });
  addEventListener("touchend", endTouch, { passive: true });
  addEventListener("touchcancel", endTouch, { passive: true });
}
