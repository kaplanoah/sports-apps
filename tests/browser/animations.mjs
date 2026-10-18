// The page's animations that play over time, by the page's own clock. One a scroll drives, like
// the season tab's header riding up with its part or a sheet's as its row moves, moves only as its
// scroller does, so it lasts as long as what it moves and never counts here.

/**
 * Each animation on the page that plays over time, by what it animates and the element it moves,
 * so a page that never comes to rest names what kept moving.
 * @param {import("@playwright/test").Page} page
 */
export const describeTimedAnimations = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.timeline === document.timeline)
      .map((animation) => {
        const effect = /** @type {KeyframeEffect | null} */ (animation.effect);
        const target = effect?.target;
        const element = target ? [target.localName, ...target.classList].join(".") : "nothing";
        const name =
          Reflect.get(animation, "animationName") ||
          Reflect.get(animation, "transitionProperty") ||
          [...new Set(effect?.getKeyframes().flatMap((frame) => Object.keys(frame)))]
            .filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))
            .join(" ");
        return `${name} on ${element}${target?.id ? `#${target.id}` : ""}`;
      }),
  );

/**
 * How many animations on the page play over time.
 * @param {import("@playwright/test").Page} page
 */
export const countTimedAnimations = async (page) => (await describeTimedAnimations(page)).length;

/**
 * Keeps a list of each animation the page plays over time from then on, by the class of the
 * element it moves, with its first and last frames, and returns a way to read the list.
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
      const animation = animate.call(this, frames, options);
      const [first, last] = /** @type {Keyframe[]} */ (frames);
      if (animation.timeline === document.timeline)
        animations.push({ element: this.getAttribute("class") ?? "", first, last });
      return animation;
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (window).animations);
}
