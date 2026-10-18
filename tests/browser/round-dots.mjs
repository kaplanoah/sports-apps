// Where a bracket's round dots sit on each frame, beside the bracket's part, as a slide between the
// standings and the bracket moves them.

import { expect } from "@playwright/test";

/**
 * @typedef {object} DotsFrame
 * @property {number} top where the dots sit down the screen
 * @property {number} left where the dots start across the screen
 * @property {number} partLeft where the bracket's part starts across the screen
 * @property {boolean} isShown whether the dots show
 */

/**
 * Where the dots sit down the screen.
 * @param {import("@playwright/test").Page} page
 */
export const readRoundDotsTop = (page) =>
  page
    .locator("#bracketWrap .round-dots")
    .evaluate((dots) => Math.round(dots.getBoundingClientRect().top));

/**
 * How far the dots sit above the tab bar.
 * @param {import("@playwright/test").Page} page
 */
export const readRoundDotsLift = (page) =>
  page.evaluate(() => {
    const dots = /** @type {HTMLElement} */ (document.querySelector("#bracketWrap .round-dots"));
    const tabBar = /** @type {HTMLElement} */ (document.getElementById("tabBar"));
    return Math.round(tabBar.getBoundingClientRect().top - dots.getBoundingClientRect().bottom);
  });

/**
 * Notes where the dots and the bracket's part sit on each frame, until the returned function stops
 * and reads the notes.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<DotsFrame[]>>}
 */
export async function trackRoundDots(page) {
  await page.evaluate(() => {
    const dots = /** @type {HTMLElement} */ (document.querySelector("#bracketWrap .round-dots"));
    const part = /** @type {HTMLElement} */ (
      document.querySelector('#bracketStandingsParts > [data-part="bracket"]')
    );
    const noted = /** @type {DotsFrame[]} */ ([]);
    const note = () => {
      const box = dots.getBoundingClientRect();
      noted.push({
        top: Math.round(box.top),
        left: Math.round(box.left),
        partLeft: Math.round(part.getBoundingClientRect().left),
        isShown: getComputedStyle(dots).visibility === "visible",
      });
      if (!(/** @type {any} */ (window).isTrackingDotsDone)) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
    Object.assign(window, { dotsFrames: noted, isTrackingDotsDone: false });
  });
  return () =>
    page.evaluate(() => {
      Object.assign(window, { isTrackingDotsDone: true });
      return /** @type {DotsFrame[]} */ (/** @type {any} */ (window).dotsFrames);
    });
}

/**
 * Checks that a frame caught the dots shown away from where they rest, as a slide carries them,
 * and that on every frame they showed they sat at `top`, over the tab bar, and started where the
 * bracket's part did, so they moved only sideways, with it.
 * @param {DotsFrame[]} frames
 * @param {number} top
 */
export function expectDotsHeldWithBracket(frames, top) {
  const shown = frames.filter((frame) => frame.isShown);
  expect(shown.some((frame) => frame.left !== 0)).toBe(true);
  expect(shown.filter((frame) => frame.top !== top)).toEqual([]);
  expect(shown.filter((frame) => frame.left !== frame.partLeft)).toEqual([]);
}
