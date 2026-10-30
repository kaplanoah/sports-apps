// Following each one-finger touch from where it lands to where it lifts, for the Diagnostics logs
// that say what became of a touch. It listens on the window, which a touch reaches last, so each
// move shows whether any of the page's code took the touch.

import { measureMove } from "./touch-words.js";

/** @typedef {import("./touch-words.js").Move} Move */

/**
 * @typedef {{ origin: Move, moved: Move, takenAt: Move | null, isPointerCancelled: boolean }} FollowedTouch
 *   `moved` is how far the finger has moved, `takenAt` how far it had moved when the page's code
 *   took the touch, or null while it hasn't, and `isPointerCancelled` whether the browser cancelled
 *   its pointer, as it does once it takes the touch for a scroll
 */

/**
 * Follows each touch `startFollowing` keeps, until a second finger joins it or it ends, when it
 * hands the touch to `noteEnd`.
 * @template {object} Kept
 * @param {{ startFollowing: (event: TouchEvent) => Kept | null, noteEnd: (touch: FollowedTouch & Kept, event: TouchEvent) => void }} follower
 *   `startFollowing` says what to keep of a touch as it lands, or null for one not to follow
 * @returns {() => (FollowedTouch & Kept) | null} the touch being followed, if any
 */
export function followOneFingerTouches({ startFollowing, noteEnd }) {
  /** @type {(FollowedTouch & Kept) | null} */
  let touch = null;

  /** @param {TouchEvent} event */
  function startTouch(event) {
    touch = null;
    if (event.touches.length !== 1) return;
    const kept = startFollowing(event);
    if (!kept) return;
    const { clientX, clientY } = event.touches[0];
    touch = {
      ...kept,
      origin: { x: clientX, y: clientY },
      moved: { x: 0, y: 0 },
      takenAt: event.defaultPrevented ? { x: 0, y: 0 } : null,
      isPointerCancelled: false,
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

  /** @param {PointerEvent} event */
  function notePointerCancel(event) {
    if (touch && event.isPrimary) touch.isPointerCancelled = true;
  }

  /** @param {TouchEvent} event */
  function endTouch(event) {
    if (!touch) return;
    const ended = touch;
    touch = null;
    noteEnd(ended, event);
  }

  addEventListener("touchstart", startTouch, { passive: true });
  addEventListener("touchmove", followTouch, { passive: true });
  addEventListener("pointercancel", notePointerCancel, { passive: true });
  addEventListener("touchend", endTouch, { passive: true });
  addEventListener("touchcancel", endTouch, { passive: true });
  return () => touch;
}
