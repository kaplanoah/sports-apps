// Panels side by side in a row, one shown at a time, like a dialog's stack of sheets or a sheet's
// sections. A finger drags the shown one toward a neighbor, and once it lifts, or a tap asks, the
// panels slide to rest on one. Where the panels are is one number, the position, which runs from
// 0 at the first panel to the last's index; each caller says where a panel sits for a position.
// Panels a whole width apart sit the row's --panel-gap apart too, so the row's own color shows
// between them while they move, and the row carries data-sliding until they rest: "finger" while
// a finger drags them and as they settle from its swipe, and "tap" for a slide a tap asked for.
// A slide is an animation with no fill, so the end state goes into the panels' style as it starts,
// and once it ends, or is cancelled, the panels settle: all but the shown one hidden and inert,
// with nothing left animating.

import { prefersReducedMotion } from "./device.js";
import { followSideSwipes } from "./side-swipe.js";

// The phone's own sheets' pace and easing, as chrome.css's --sheet-motion has them.
export const SHEET_MOTION_MS = 500;
export const SHEET_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * Runs `settle` once the animation ends, whether it finished or was cancelled.
 * @param {Animation} animation
 * @param {() => void} settle
 */
export const settleAfter = (animation, settle) => animation.finished.then(settle, settle);

/**
 * @param {number} share of the row's width, right of where the shown panel rests
 * @param {number} gap in pixels, between panels a whole width apart
 */
function writeTransform(share, gap) {
  if (!share) return "";
  if (!gap) return `translateX(${share * 100}%)`;
  const offset = share * gap;
  return `translateX(calc(${share * 100}% ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}px))`;
}

/** @param {HTMLElement} row */
const readGap = (row) => parseFloat(getComputedStyle(row).getPropertyValue("--panel-gap")) || 0;

/**
 * @typedef {object} PanelRow
 * @property {() => HTMLElement[]} listPanels the panels in the row, in order
 * @property {(index: number, position: number) => number} place where the panel at `index` sits
 *   for a position, as a share of the row's width right of where the shown panel rests
 * @property {(direction: -1 | 1) => boolean} canGo whether a swipe can bring in the panel before
 *   (-1) or after (1) the shown one
 * @property {(index: number) => void} [onSettle] runs once the panels rest on the one at `index`
 * @property {(index: number, isSliding: boolean) => void} [onShow] runs as the panels set off
 *   for the one at `index`, or jump to it
 * @property {(position: number) => void} [onDrag] runs as a finger moves the panels
 */

/**
 * @param {HTMLElement} row
 * @param {PanelRow} options
 */
export function createSlidePanels(row, { listPanels, place, canGo, onSettle, onShow, onDrag }) {
  let shown = 0;
  let position = 0;
  /** @type {{ from: number, animations: Animation[] } | null} */
  let slide = null;

  /** @param {number} at */
  function placePanels(at) {
    const gap = readGap(row);
    listPanels().forEach((panel, index) => {
      panel.style.transform = writeTransform(place(index, at), gap);
    });
  }

  // How far a slide under way got, by its eased progress.
  function readPosition() {
    const progress = slide?.animations[0]?.effect?.getComputedTiming().progress;
    if (!slide || typeof progress !== "number") return position;
    return slide.from + (position - slide.from) * progress;
  }

  /** Stops a slide under way where it got to. */
  function hold() {
    if (!slide) return;
    const at = readPosition();
    const stopped = slide;
    slide = null;
    for (const animation of stopped.animations) animation.cancel();
    position = at;
    placePanels(at);
  }

  /** @param {"finger" | "tap" | null} cause what moves the panels, or null once they rest */
  function revealPanels(cause) {
    if (cause) row.setAttribute("data-sliding", cause);
    else row.removeAttribute("data-sliding");
    for (const panel of listPanels()) panel.style.visibility = cause ? "visible" : "";
  }

  function rest() {
    position = shown;
    placePanels(shown);
    revealPanels(null);
    listPanels().forEach((panel, index) => {
      panel.inert = index !== shown;
    });
    onSettle?.(shown);
  }

  /**
   * Shows the panel at `index` at once.
   * @param {number} index
   */
  function jumpTo(index) {
    hold();
    shown = index;
    onShow?.(index, false);
    rest();
  }

  /**
   * Slides the panels from wherever they are to rest on the one at `index`, which counts as shown
   * from the start.
   * @param {number} index
   * @param {"finger" | "tap"} [cause] a finger's swipe the slide finishes, or a tap
   */
  function slideTo(index, cause = "tap") {
    hold();
    const from = position;
    shown = index;
    onShow?.(index, true);
    if (from === index || prefersReducedMotion()) return rest();
    revealPanels(cause);
    position = index;
    const gap = readGap(row);
    const animations = listPanels().map((panel, panelIndex) => {
      const to = writeTransform(place(panelIndex, index), gap);
      panel.style.transform = to;
      return panel.animate(
        [
          { transform: writeTransform(place(panelIndex, from), gap) || "none" },
          { transform: to || "none" },
        ],
        { duration: SHEET_MOTION_MS, easing: SHEET_EASING },
      );
    });
    const started = { from, animations };
    slide = started;
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (slide !== started) return;
      slide = null;
      rest();
    });
  }

  /**
   * Moves the panels with a finger, a share of the row's width toward a neighbor. Neighbors sit a
   * width and a gap apart, so the panel under the finger moves exactly as far as the finger does.
   * @param {-1 | 1} direction
   * @param {number} share
   */
  function drag(direction, share) {
    hold();
    const width = row.clientWidth || 1;
    position = shown + direction * share * (width / (width + readGap(row)));
    revealPanels("finger");
    placePanels(position);
    onDrag?.(position);
  }

  followSideSwipes(row, {
    canGo,
    follow: drag,
    settle: (direction, isGoing) => slideTo(isGoing ? shown + direction : shown, "finger"),
  });

  return { hold, jumpTo, slideTo, readShown: () => shown };
}
