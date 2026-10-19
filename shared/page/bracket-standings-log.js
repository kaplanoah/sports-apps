import { createStepLog } from "./step-log.js";

/** @param {Element} target */
const findPartHolding = (target) =>
  /** @type {HTMLElement | null} */ (target.closest(".season-part"));

/** @param {Element} target */
const isOnParts = (target) => !!findPartHolding(target);

// What a season's standings and bracket do with each touch: each touch and click on them, and as
// the finger lifts, how far it moved, whether the page's own code took the touch from the browser,
// which stops the browser's scroll, and how far the part under it scrolled.
export const bracketStandingsLog = createStepLog({
  key: "diagnosticsBracketStandings",
  title: "Standings and bracket",
  isWatched: isOnParts,
});

/** @typedef {{ x: number, y: number }} Move */

/**
 * A distance in whole pixels and its way, or nothing for one that rounds to none.
 * @param {number} distance
 * @param {[string, string]} ways the way a negative distance goes, then a positive one
 * @param {string} [unit] written after the number, as "px"
 */
function describeDistance(distance, [back, on], unit = "") {
  const pixels = Math.round(distance);
  return pixels ? `${Math.abs(pixels)}${unit} ${pixels < 0 ? back : on}` : "";
}

/**
 * How far a finger moved each way it went, or nothing for a finger that didn't.
 * @param {Move} move
 */
const describeMove = (move) =>
  [describeDistance(move.x, ["left", "right"]), describeDistance(move.y, ["up", "down"])]
    .filter(Boolean)
    .join(" and ");

/**
 * @param {Move} moved
 * @param {boolean} isCancelled
 */
function describeLift(moved, isCancelled) {
  const end = isCancelled ? "cancelled" : "lifted";
  const distance = describeMove(moved);
  return distance ? `${end} after moving ${distance}` : `${end} without moving`;
}

/** @param {Move} takenAt */
function describeTaking(takenAt) {
  const distance = describeMove(takenAt);
  const when = distance ? `once it had moved ${distance}` : "before it moved";
  return `the page's code took the touch ${when}`;
}

/**
 * @param {string} part
 * @param {number} scrolled
 */
function describeScroll(part, scrolled) {
  const distance = describeDistance(scrolled, ["up", "down"], "px");
  return distance ? `the ${part} scrolled ${distance}` : `the ${part} didn't scroll`;
}

/**
 * What became of a touch, as its finger lifts or the browser cancels it.
 * @param {{ isCancelled: boolean, moved: Move, takenAt: Move | null, part: string, scrolled: number }} touch
 *   `takenAt` is how far the finger had moved when the page's code took the touch, or null when
 *   the browser kept it, `part` names the part it started on, and `scrolled` is how far that part
 *   scrolled down, or up when negative
 * @returns {string}
 */
export function describeTouchEnd({ isCancelled, moved, takenAt, part, scrolled }) {
  const taken = takenAt ? describeTaking(takenAt) : "the browser kept the touch";
  return `${describeLift(moved, isCancelled)}; ${taken}; ${describeScroll(part, scrolled)}`;
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
  /** @type {{ origin: { x: number, y: number }, part: HTMLElement, scrollTop: number, moved: Move, takenAt: Move | null } | null} */
  let touch = null;

  /** @param {TouchEvent} event */
  function startTouch(event) {
    touch = null;
    if (!bracketStandingsLog.isLogging() || event.touches.length !== 1) return;
    const part = event.target instanceof Element ? findPartHolding(event.target) : null;
    if (!part) return;
    const { clientX, clientY } = event.touches[0];
    touch = {
      origin: { x: clientX, y: clientY },
      part,
      scrollTop: part.scrollTop,
      moved: { x: 0, y: 0 },
      takenAt: null,
    };
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
    const { moved, takenAt, part } = touch;
    const scrolled = part.scrollTop - touch.scrollTop;
    touch = null;
    bracketStandingsLog.noteStep(
      describeTouchEnd({
        isCancelled: event.type === "touchcancel",
        moved,
        takenAt,
        part: /** @type {string} */ (part.dataset.part),
        scrolled,
      }),
    );
  }

  addEventListener("touchstart", startTouch, { passive: true });
  addEventListener("touchmove", followTouch, { passive: true });
  addEventListener("touchend", endTouch, { passive: true });
  addEventListener("touchcancel", endTouch, { passive: true });
}
