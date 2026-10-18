import { logPatches } from "./html.js";

// New data that changes what the page shows eases in: a part that grows or shrinks moves to its
// new height, so what's under it slides instead of jumping, and what's new fades in. The page
// stays live under a finger throughout, unlike in a view transition, which takes every touch
// while it runs.

export const EASE_MS = 250;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** @type {WeakMap<Element, Animation>} */
const resizes = new WeakMap();

/** @type {WeakSet<Element>} */
const closings = new WeakSet();

/** @type {Set<Animation> | null} */
let startedInRedraw = null;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const canEase = () => !document.hidden && !prefersReducedMotion();

/** @param {Element} element */
const readHeight = (element) => element.getBoundingClientRect().height;

// A part that appears or goes away grows from or shrinks to nothing with its padding, border, and
// margin, since its height alone can't shrink below them. Clipping, unlike hiding what overflows,
// leaves a sticky header inside the part stuck.
const COLLAPSED = {
  height: "0px",
  paddingTop: "0px",
  paddingBottom: "0px",
  borderTopWidth: "0px",
  borderBottomWidth: "0px",
  marginTop: "0px",
  marginBottom: "0px",
  opacity: 0,
  overflow: "clip",
};

/** @param {Element} element */
function readOpenFrame(element) {
  const style = getComputedStyle(element);
  return {
    height: style.height,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    borderTopWidth: style.borderTopWidth,
    borderBottomWidth: style.borderBottomWidth,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom,
    opacity: style.opacity,
    overflow: "clip",
  };
}

/**
 * @param {Element} element
 * @param {Animation} easing
 */
function keepEasing(element, easing) {
  resizes.set(element, easing);
  startedInRedraw?.add(easing);
}

/**
 * Stops whatever easing a part is under way, leaving it as its markup and styles have it.
 * @param {Element} element
 */
function stopEasing(element) {
  resizes.get(element)?.cancel();
  closings.delete(element);
}

/** @param {Element} element */
function easeOpen(element) {
  const opening = element.animate([COLLAPSED, readOpenFrame(element)], {
    duration: EASE_MS,
    easing: EASING,
  });
  keepEasing(element, opening);
}

/**
 * Whether a part is shrinking away, so that showing it again means easing it back open.
 * @param {Element} element
 */
export const isEasingClosed = (element) => closings.has(element);

/**
 * Shrinks a part to nothing from wherever it is, as its opening played backward, and then calls
 * `hide`, or calls it at once when motion is off. A part already shrinking keeps on, never
 * starting over, and one whose easing stops meanwhile isn't hidden.
 * @param {Element} element
 * @param {() => void} hide
 */
export function easeClosed(element, hide) {
  if (isEasingClosed(element)) return;
  if (!canEase()) {
    hide();
    return;
  }
  const reached = readOpenFrame(element);
  stopEasing(element);
  const closing = element.animate([COLLAPSED, reached], {
    duration: EASE_MS,
    easing: EASING,
    direction: "reverse",
    fill: "forwards",
  });
  keepEasing(element, closing);
  closings.add(element);
  closing.finished.then(
    () => {
      closings.delete(element);
      hide();
      closing.cancel();
    },
    () => {},
  );
}

/**
 * Eases a part that's shrinking away back open from wherever its close has reached, once `redraw`
 * draws what it shows, rather than snapping it back to full first.
 * @param {Element} element
 * @param {() => void} redraw
 */
export function easeBackOpen(element, redraw) {
  const reached = readOpenFrame(element);
  stopEasing(element);
  redraw();
  if (!canEase()) return;
  const reopening = element.animate([reached, readOpenFrame(element)], {
    duration: EASE_MS,
    easing: EASING,
  });
  keepEasing(element, reopening);
}

// A part that scrolls already keeps what overflows it inside, and clipping it would drop where it
// was scrolled to while it eases, which a phone doesn't give back.
/** @param {Element} element */
function isScroller(element) {
  const { overflowX, overflowY } = getComputedStyle(element);
  return [overflowX, overflowY].some((overflow) => overflow === "auto" || overflow === "scroll");
}

/**
 * @param {{ element: Element, from: number, to: number }} size
 */
function easeHeight({ element, from, to }) {
  if (Math.abs(to - from) < 1) return;
  if (from === 0) {
    easeOpen(element);
    return;
  }
  const clip = isScroller(element) ? {} : { overflow: "clip" };
  const resize = element.animate(
    [
      { height: `${from}px`, ...clip },
      { height: `${to}px`, ...clip },
    ],
    { duration: EASE_MS, easing: EASING },
  );
  keepEasing(element, resize);
}

// What a redraw adds out of sight, on a hidden tab or scrolled away, shows without fading in.
/** @param {Element} element */
function isOnScreen(element) {
  const { top, bottom, width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0 && bottom > 0 && top < innerHeight;
}

/** @param {Element} element */
function fadeIn(element) {
  if (element.isConnected && isOnScreen(element))
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: EASE_MS, easing: EASING });
}

// An easing the redraw itself starts, like a box growing back open, runs on, where one from
// before gives way to the part's new height.
/**
 * @param {() => void} redraw
 */
function logRedraw(redraw) {
  startedInRedraw = new Set();
  const { heights, added } = logPatches(redraw);
  const started = startedInRedraw;
  startedInRedraw = null;
  return { heights, added, started };
}

/**
 * @param {Set<Animation>} started
 * @param {Element} element
 */
function isEasingStartedIn(started, element) {
  const easing = resizes.get(element);
  return easing !== undefined && started.has(easing);
}

/**
 * Redraws the page, easing each part whose height the redraw changes from the height it had,
 * and fading in what it adds. A part still easing starts again from wherever it is.
 * @param {() => void} redraw
 */
export function redrawEased(redraw) {
  if (!canEase()) {
    redraw();
    return;
  }
  const { heights, added, started } = logRedraw(redraw);
  const changed = [...heights].filter(
    ([element]) => element.isConnected && !isEasingStartedIn(started, element),
  );
  changed.forEach(([element]) => stopEasing(element));
  const sizes = changed.map(([element, from]) => ({ element, from, to: readHeight(element) }));
  sizes.forEach(easeHeight);
  added.forEach(fadeIn);
}
