/**
 * Keeps a list of each animation the page starts from then on, by the class of the element it
 * moves, with its first and last frames and the way it plays them, and returns a way to read the
 * list.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<{ element: string, first: Keyframe, last: Keyframe, direction: string }[]>>}
 */
export async function listAnimations(page) {
  await page.addInitScript(() => {
    /** @type {{ element: string, first: Keyframe, last: Keyframe, direction: string }[]} */
    const animations = [];
    Object.assign(window, { animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const [first, last] = /** @type {Keyframe[]} */ (frames);
      const direction = (typeof options === "object" ? options.direction : undefined) ?? "normal";
      animations.push({ element: this.getAttribute("class") ?? "", first, last, direction });
      return animate.call(this, frames, options);
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (window).animations);
}
