// The page's animations that play over time, by the page's own clock. One a scroll drives, like
// the season tab's header riding up with its part, moves only as its scroller does, so it lasts as
// long as what it moves and never counts here.

import { expect } from "@playwright/test";
import { EASE_MS } from "../../shared/page/eased-redraw.js";

/** Where a test holds the page's shared easing still, halfway through. */
export const EASE_HALFWAY_MS = EASE_MS / 2;

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
 * Waits until every animation on the page that plays over time has ended.
 * @param {import("@playwright/test").Page} page
 */
export const waitForTimedAnimations = (page) =>
  expect.poll(async () => (await describeTimedAnimations(page)).length).toBe(0);

/**
 * Moves every animation on the page that plays over time to its end at once.
 * @param {import("@playwright/test").Page} page
 */
export const finishTimedAnimations = (page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.timeline === document.timeline)
      .forEach((animation) => animation.finish()),
  );

/**
 * An animation the page played over time: the classes of the element it moves, its first and last
 * frames.
 * @typedef {{ classes: string[], first: Keyframe, last: Keyframe }} PlayedAnimation
 */

/**
 * Keeps a list of each animation the page plays over time from then on, and returns a way to read
 * the list.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<PlayedAnimation[]>>}
 */
export async function listAnimations(page) {
  await page.addInitScript(() => {
    /** @type {PlayedAnimation[]} */
    const animations = [];
    Object.assign(window, { animations });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      const [first, last] = /** @type {Keyframe[]} */ (frames);
      if (animation.timeline === document.timeline)
        animations.push({ classes: [...this.classList], first, last });
      return animation;
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (window).animations);
}
