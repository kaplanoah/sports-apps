import { isOnGlide } from "./press.js";
import { findPartHolding } from "./season-part.js";
import { createStepLog } from "./step-log.js";
import {
  describeDistance,
  describeLift,
  describePointer,
  describeTaking,
  measureMove,
} from "./touch-words.js";

/** @param {Element} target */
const isOnParts = (target) => !!findPartHolding(target);

// What a season's standings and bracket do with each touch: each touch and click on them, and as
// the finger lifts, how far it moved, whether it landed on a list still gliding by press.js's
// reading, which shows whether iOS sends a scroll on every frame of a glide as press.js counts on,
// whether the page's own code took the touch from the browser, which stops the browser's scroll,
// whether the browser cancelled its pointer, as it does once it takes the touch for a scroll, and
// how far the part under it scrolled.
export const bracketStandingsLog = createStepLog({
  key: "diagnosticsBracketStandings",
  title: "Standings and bracket",
  isWatched: isOnParts,
});

/** @typedef {import("./touch-words.js").Move} Move */

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
 * @param {{ isCancelled: boolean, moved: Move, isLandingOnGlide: boolean, takenAt: Move | null, isPointerCancelled: boolean, part: string, scrolled: number }} touch
 *   `isLandingOnGlide` is whether it landed on a list still gliding, `takenAt` is how far the
 *   finger had moved when the page's code took the touch, or null when the browser kept it, `part`
 *   names the part it started on, and `scrolled` is how far that part scrolled down, or up when
 *   negative
 * @returns {string}
 */
export function describeTouchEnd({
  isCancelled,
  moved,
  isLandingOnGlide,
  takenAt,
  isPointerCancelled,
  part,
  scrolled,
}) {
  const landing = isLandingOnGlide
    ? "it landed on a list still gliding"
    : "it landed on a list at rest";
  const taken = takenAt ? describeTaking(takenAt) : "the browser kept the touch";
  return `${describeLift(moved, isCancelled)}; ${landing}; ${taken}; ${describePointer(isPointerCancelled)}; ${describeScroll(part, scrolled)}`;
}

/**
 * Logs, while Diagnostics is on, what became of each one-finger touch on the parts. It listens on
 * the window, which a touch reaches last, so a move shows whether any of the page's code stopped
 * the browser's scroll.
 */
export function watchTouches() {
  /** @type {{ origin: { x: number, y: number }, part: HTMLElement, scrollTop: number, moved: Move, isLandingOnGlide: boolean, takenAt: Move | null, isPointerCancelled: boolean } | null} */
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
      isLandingOnGlide: isOnGlide(event.target),
      takenAt: null,
      isPointerCancelled: false,
    };
  }

  /** @param {PointerEvent} event */
  function notePointerCancel(event) {
    if (touch && event.isPrimary) touch.isPointerCancelled = true;
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
    const { moved, isLandingOnGlide, takenAt, isPointerCancelled, part } = touch;
    const scrolled = part.scrollTop - touch.scrollTop;
    touch = null;
    bracketStandingsLog.noteStep(
      describeTouchEnd({
        isCancelled: event.type === "touchcancel",
        moved,
        isLandingOnGlide,
        takenAt,
        isPointerCancelled,
        part: /** @type {string} */ (part.dataset.part),
        scrolled,
      }),
    );
  }

  addEventListener("touchstart", startTouch, { passive: true });
  addEventListener("touchmove", followTouch, { passive: true });
  addEventListener("pointercancel", notePointerCancel, { passive: true });
  addEventListener("touchend", endTouch, { passive: true });
  addEventListener("touchcancel", endTouch, { passive: true });
}
