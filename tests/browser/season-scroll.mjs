// Where the page's scroll and the season tab's parts are on each frame, as a slide from far down
// one part brings the other in at its top.

import { expect } from "@playwright/test";

/**
 * @typedef {object} ScrollFrame
 * @property {number} scroll how far the page is scrolled
 * @property {number} height how tall the page is
 * @property {number} comingTop where the part coming in starts down the screen
 * @property {number} leavingTop where the part leaving starts down the screen
 * @property {number} pillBottom where the pill ends down the screen
 * @property {boolean} isPillHeld whether the pill is held at the top of the screen
 * @property {boolean} isPillFilled whether the pill is filled with the page's color
 * @property {boolean} isSliding whether the parts are moving
 */

/**
 * Notes the page's scroll and height, and where the parts sit down the screen, on each frame,
 * until the returned function stops and reads the notes. It returns once it has noted a frame, so
 * the frames start before whatever the test does next.
 * @param {import("@playwright/test").Page} page
 * @param {{ coming: "standings" | "bracket", leaving: "standings" | "bracket" }} parts
 * @returns {Promise<() => Promise<ScrollFrame[]>>}
 */
export async function trackSeasonScroll(page, { coming, leaving }) {
  await page.evaluate(
    ([comingKey, leavingKey]) =>
      new Promise((resolve) => {
        const row = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsParts"));
        const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
        /** @param {string} key */
        const findPart = (key) =>
          /** @type {HTMLElement} */ (row.querySelector(`:scope > [data-part="${key}"]`));
        const noted = /** @type {ScrollFrame[]} */ ([]);
        const note = () => {
          const pillBox = pill.getBoundingClientRect();
          noted.push({
            scroll: Math.round(scrollY),
            height: document.documentElement.scrollHeight,
            comingTop: Math.round(findPart(comingKey).getBoundingClientRect().top),
            leavingTop: Math.round(findPart(leavingKey).getBoundingClientRect().top),
            pillBottom: Math.round(pillBox.bottom),
            isPillHeld: pillBox.top === parseFloat(getComputedStyle(pill).top),
            isPillFilled: pill.classList.contains("stuck"),
            isSliding: row.hasAttribute("data-sliding"),
          });
          resolve(undefined);
          if (!(/** @type {any} */ (window).isTrackingScrollDone)) requestAnimationFrame(note);
        };
        requestAnimationFrame(note);
        Object.assign(window, { scrollFrames: noted, isTrackingScrollDone: false });
      }),
    [coming, leaving],
  );
  return () =>
    page.evaluate(() => {
      Object.assign(window, { isTrackingScrollDone: true });
      return /** @type {ScrollFrame[]} */ (/** @type {any} */ (window).scrollFrames);
    });
}

/**
 * Checks that the frames caught the slide from a frame at rest, and that the page never scrolled
 * on a frame its height changed. Returns where the slide starts in the frames.
 * @param {ScrollFrame[]} frames
 */
export function expectNoScrollAsHeightChanges(frames) {
  const start = frames.findIndex((frame) => frame.isSliding);
  expect(start).toBeGreaterThan(0);
  const scrolledAsHeightChanged = frames.filter(
    (frame, index) =>
      index > 0 &&
      frame.scroll !== frames[index - 1].scroll &&
      frame.height !== frames[index - 1].height,
  );
  expect(scrolledAsHeightChanged).toEqual([]);
  return start;
}

/**
 * Checks that the page never scrolled on a frame its height changed, and that from the first frame
 * of the slide the pill stayed held at the top of the screen, filled while the parts moved, with
 * the part coming in just under it, and the part leaving held still while it moved.
 * @param {ScrollFrame[]} frames
 */
export function expectScrollHeldAsPartsRest(frames) {
  const start = expectNoScrollAsHeightChanges(frames);
  const fromStart = frames.slice(start);
  expect(fromStart.filter((frame) => !frame.isPillHeld)).toEqual([]);
  expect(fromStart.filter((frame) => Math.abs(frame.comingTop - frame.pillBottom) > 1)).toEqual([]);
  const sliding = fromStart.filter((frame) => frame.isSliding);
  expect(sliding.filter((frame) => !frame.isPillFilled)).toEqual([]);
  expect(sliding.filter((frame) => frame.leavingTop !== frames[start - 1].leavingTop)).toEqual([]);
}

/**
 * Keeps the page from hearing that the screen resized, as a Home Screen app that grows as it opens
 * never tells it. Call it before the page loads.
 * @param {import("@playwright/test").Page} page
 */
export const hideResizesFromPage = (page) =>
  page.addInitScript(() =>
    addEventListener("resize", (event) => event.stopImmediatePropagation(), { capture: true }),
  );

/**
 * Whether the pill over the season tab's parts is held at the top of the screen.
 * @param {import("@playwright/test").Page} page
 */
export const isSeasonPillHeld = (page) =>
  page.evaluate(() => {
    const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
    return pill.getBoundingClientRect().top === parseFloat(getComputedStyle(pill).top);
  });
