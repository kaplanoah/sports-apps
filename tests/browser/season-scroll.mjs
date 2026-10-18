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
 * Checks that the frames caught the slide, that the page never scrolled on a frame its height
 * changed, and that from the first frame of the slide the pill stayed held at the top of the
 * screen, the part coming in sat just under it, and the part leaving held still while it moved.
 * @param {ScrollFrame[]} frames
 */
export function expectScrollHeldAsPartsRest(frames) {
  const start = frames.findIndex((frame) => frame.isSliding);
  expect(start).toBeGreaterThan(0);
  expect(frames.slice(start).filter((frame) => !frame.isPillHeld)).toEqual([]);
  const scrolledAsHeightChanged = frames.filter(
    (frame, index) =>
      index > 0 &&
      frame.scroll !== frames[index - 1].scroll &&
      frame.height !== frames[index - 1].height,
  );
  expect(scrolledAsHeightChanged).toEqual([]);
  const fromStart = frames.slice(start);
  expect(fromStart.filter((frame) => Math.abs(frame.comingTop - frame.pillBottom) > 1)).toEqual([]);
  const sliding = fromStart.filter((frame) => frame.isSliding);
  expect(sliding.filter((frame) => frame.leavingTop !== frames[start - 1].leavingTop)).toEqual([]);
}
