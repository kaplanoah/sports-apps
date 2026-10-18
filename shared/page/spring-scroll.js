const isReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Like UIKit's scroll to top, a scroll this page makes takes off at once and eases into place on a
// critically damped spring, so the trip takes about the same time from any distance.
const SPRING_RESPONSE_SECONDS = 0.4;
const SPRING_OMEGA = (2 * Math.PI) / SPRING_RESPONSE_SECONDS;
const ARRIVED_WITHIN_PX = 0.5;

// Any touch, click, wheel or key stops the scroll where it is, as a touch does on a phone.
const INTERRUPTING_EVENTS = ["pointerdown", "touchstart", "wheel", "keydown"];

// Each scroller eases on a spring of its own, so the page and a list inside it can move at once.
/** @type {Map<Element, { frame: number, startTop: number, endTop: number, startTime: number }>} */
const springs = new Map();

/** @param {number} seconds */
const readRemainingFraction = (seconds) =>
  (1 + SPRING_OMEGA * seconds) * Math.exp(-SPRING_OMEGA * seconds);

/**
 * @param {Element} scroller
 * @param {number} top
 */
const jumpTo = (scroller, top) => scroller.scrollTo({ top, behavior: "instant" });

/** @param {Element} scroller */
function stopSpring(scroller) {
  const spring = springs.get(scroller);
  if (!spring) return;
  cancelAnimationFrame(spring.frame);
  springs.delete(scroller);
  if (springs.size) return;
  for (const type of INTERRUPTING_EVENTS) removeEventListener(type, stopScrolling, true);
}

function stopScrolling() {
  for (const scroller of [...springs.keys()]) stopSpring(scroller);
}

/**
 * @param {Element} scroller
 * @param {number} time
 */
function stepScroll(scroller, time) {
  const spring = springs.get(scroller);
  if (!spring) return;
  const seconds = Math.max((time - spring.startTime) / 1000, 0);
  const remaining = (spring.startTop - spring.endTop) * readRemainingFraction(seconds);
  if (Math.abs(remaining) < ARRIVED_WITHIN_PX) {
    jumpTo(scroller, spring.endTop);
    stopSpring(scroller);
    return;
  }
  jumpTo(scroller, spring.endTop + remaining);
  spring.frame = requestAnimationFrame((next) => stepScroll(scroller, next));
}

/**
 * Whether `scroller` is far enough from `top` for a scroll to take it there, rather than already
 * there within a fraction of a pixel, as a phone can leave it.
 * @param {Element} scroller
 * @param {number} top
 */
export const isAwayFrom = (scroller, top) =>
  Math.abs(scroller.scrollTop - top) >= ARRIVED_WITHIN_PX;

/**
 * Scrolls `scroller` to `top` on the spring, or at once for someone who asks for less motion.
 * @param {Element} scroller
 * @param {number} top
 */
export function scrollWithSpring(scroller, top) {
  stopSpring(scroller);
  if (!isAwayFrom(scroller, top)) return;
  if (isReducedMotion()) {
    jumpTo(scroller, top);
    return;
  }
  for (const type of INTERRUPTING_EVENTS)
    addEventListener(type, stopScrolling, { capture: true, passive: true });
  springs.set(scroller, {
    startTop: scroller.scrollTop,
    endTop: top,
    startTime: performance.now(),
    frame: requestAnimationFrame((time) => stepScroll(scroller, time)),
  });
}

export const scrollToTop = () =>
  scrollWithSpring(/** @type {Element} */ (document.scrollingElement), 0);
