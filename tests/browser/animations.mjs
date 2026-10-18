import { EASE_MS } from "../../shared/page/eased-redraw.js";

/** Where a test holds the page's shared easing still, halfway through. */
export const EASE_HALFWAY_MS = EASE_MS / 2;

/**
 * An animation the page started: the classes of the element it moves, its first and last frames,
 * and the way it plays them.
 * @typedef {{ classes: string[], first: Keyframe, last: Keyframe, direction: string }} Animation
 */

/**
 * Keeps a list of each animation the page starts from then on, and returns a way to read the list.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<Animation[]>>}
 */
export async function listAnimations(page) {
  await page.addInitScript(() => {
    /** @type {Animation[]} */
    const animations = [];
    Object.assign(window, { animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const [first, last] = /** @type {Keyframe[]} */ (frames);
      const direction = (typeof options === "object" ? options.direction : undefined) ?? "normal";
      animations.push({ classes: [...this.classList], first, last, direction });
      return animate.call(this, frames, options);
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (window).animations);
}
