/**
 * How many animations on the page play over time, leaving out one a scroll drives, which moves
 * only as its scroller does, like the season tab's header riding up with its part.
 * @param {import("@playwright/test").Page} page
 */
export const countTimedAnimations = (page) =>
  page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => !(animation.timeline instanceof ScrollTimeline)).length,
  );

/**
 * Keeps a list of each animation the page plays over time from then on, by the class of the
 * element it moves, with its first and last frames, and returns a way to read the list. One a
 * scroll drives, like the season tab's header riding up with its part, moves only as its scroller
 * does.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<{ element: string, first: Keyframe, last: Keyframe }[]>>}
 */
export async function listAnimations(page) {
  await page.addInitScript(() => {
    /** @type {{ element: string, first: Keyframe, last: Keyframe }[]} */
    const animations = [];
    Object.assign(window, { animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const [first, last] = /** @type {Keyframe[]} */ (frames);
      const isScrollDriven =
        typeof options === "object" && options.timeline instanceof ScrollTimeline;
      if (!isScrollDriven)
        animations.push({ element: this.getAttribute("class") ?? "", first, last });
      return animate.call(this, frames, options);
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (window).animations);
}
