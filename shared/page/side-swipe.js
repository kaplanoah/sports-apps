// A sideways swipe the page's code follows, as a sheet opened from another and a sheet's sections
// take one: the finger moves what's shown toward the one before or after it, and once the finger
// lifts, what's shown goes on there or springs back. A swipe on something that scrolls sideways on
// its own, like a roster's wide table, stays that thing's until it reaches its edge. Where one
// surface holds another, as a sheet holds its sections, the inner one has the first say.

import { isPastDrift } from "./press.js";

// A swipe goes on once it has moved this share of the surface's width, or is this fast as it lifts.
const GO_SHARE = 0.3;
const GO_SPEED_PX_PER_MS = 0.3;

/**
 * Toward the one before (-1), as a finger moving right drags, or the one after (1).
 * @typedef {-1 | 1} Direction
 */
/**
 * @typedef {object} SideSwipe
 * @property {(direction: Direction) => boolean} canGo whether there's a neighbor that way
 * @property {(direction: Direction, share: number) => void} follow moves what's shown that way, by a
 *   share of the surface's width from 0 to 1
 * @property {(direction: Direction, isGoing: boolean) => void} settle goes on to the neighbor, or
 *   back to what's shown
 */

// The surface following the touch under way, which every other surface leaves alone.
/** @type {HTMLElement | null} */
let claimant = null;

/** @param {Element} element */
const scrollsSideways = (element) =>
  element.scrollWidth > element.clientWidth &&
  ["auto", "scroll"].includes(getComputedStyle(element).overflowX);

/**
 * Whether what the touch started on, or anything it's in up to the surface, can scroll its content
 * along with a finger moving toward `direction`'s neighbor.
 * @param {Element} target
 * @param {HTMLElement} surface
 * @param {Direction} direction
 */
function canScrollAlong(target, surface, direction) {
  for (let element = target; element && element !== surface; element = element.parentElement) {
    if (!scrollsSideways(element)) continue;
    const roomBefore = element.scrollLeft;
    const roomAfter = element.scrollWidth - element.clientWidth - element.scrollLeft;
    if ((direction < 0 ? roomBefore : roomAfter) > 1) return true;
  }
  return false;
}

/**
 * @param {number} across
 * @param {number} down
 */
const isSideways = (across, down) => isPastDrift(across, down) && Math.abs(across) > Math.abs(down);

/**
 * Follows each sideways swipe on `surface` that `swipe` has a neighbor for.
 * @param {HTMLElement} surface
 * @param {SideSwipe} swipe
 */
export function followSideSwipes(surface, { canGo, follow, settle }) {
  /** @type {{ target: Element, originX: number, originY: number, direction: Direction | null, share: number, lastX: number, lastTime: number, speed: number } | null} */
  let touch = null;

  /** @param {TouchEvent} event */
  function startTouch(event) {
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
    const { clientX, clientY } = event.touches[0];
    touch = {
      target: event.target,
      originX: clientX,
      originY: clientY,
      direction: null,
      share: 0,
      lastX: clientX,
      lastTime: event.timeStamp,
      speed: 0,
    };
  }

  /**
   * Takes the touch once it sets off sideways toward a neighbor that nothing under it scrolls to.
   * @param {number} across
   * @param {number} down
   */
  function claimTouch(across, down) {
    if (!touch || !isSideways(across, down)) return;
    /** @type {Direction} */
    const direction = across > 0 ? -1 : 1;
    if (!canGo(direction) || canScrollAlong(touch.target, surface, direction)) {
      touch = null;
      return;
    }
    touch.direction = direction;
    claimant = surface;
  }

  /**
   * @param {number} clientX
   * @param {number} time
   */
  function trackSpeed(clientX, time) {
    if (!touch) return;
    const elapsed = time - touch.lastTime;
    if (elapsed > 0) touch.speed = (clientX - touch.lastX) / elapsed;
    touch.lastX = clientX;
    touch.lastTime = time;
  }

  /** @param {TouchEvent} event */
  function moveTouch(event) {
    if (!touch) return;
    if (claimant && claimant !== surface) {
      touch = null;
      return;
    }
    const { clientX, clientY } = event.touches[0];
    const across = clientX - touch.originX;
    if (touch.direction === null) claimTouch(across, clientY - touch.originY);
    if (!touch || touch.direction === null) return;
    if (event.cancelable) event.preventDefault();
    trackSpeed(clientX, event.timeStamp);
    const width = surface.clientWidth || 1;
    touch.share = Math.min(Math.max((-touch.direction * across) / width, 0), 1);
    follow(touch.direction, touch.share);
  }

  /** @param {TouchEvent} event */
  function endTouch(event) {
    if (event.touches.length > 0) return;
    const ended = touch;
    touch = null;
    if (claimant === surface) claimant = null;
    if (!ended || ended.direction === null) return;
    const speedOn = -ended.direction * ended.speed;
    const isFarOrFast = ended.share > GO_SHARE || speedOn > GO_SPEED_PX_PER_MS;
    settle(ended.direction, event.type === "touchend" && isFarOrFast);
  }

  surface.addEventListener("touchstart", startTouch, { passive: true });
  surface.addEventListener("touchmove", moveTouch, { passive: false });
  surface.addEventListener("touchend", endTouch);
  surface.addEventListener("touchcancel", endTouch);
}
