// The season tab's parts, each scrolling on its own under the pill: where they, the page, and the
// pill are on each frame as the parts slide, and how to scroll a part and read how far it is.

import { expect } from "@playwright/test";

/**
 * @typedef {object} SeasonPlace
 * @property {number} pageScroll how far the page is scrolled
 * @property {number} pageHeight how tall the page is
 * @property {number} pillTop where the pill starts down the screen
 * @property {number} standingsTop where the standings start down the screen
 * @property {number} bracketTop where the bracket starts down the screen
 * @property {number} standingsScroll how far the standings are scrolled
 * @property {number} bracketScroll how far the bracket is scrolled
 */

/** @typedef {SeasonPlace & { isSliding: boolean }} SeasonFrame */

/**
 * Notes where the page, the pill, and the parts are on each frame, until the returned function
 * stops and reads the notes. It returns once it has noted a frame, so the frames start before
 * whatever the test does next.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<SeasonFrame[]>>}
 */
export async function trackSeasonFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const row = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsParts"));
        const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
        /** @param {string} key */
        const findPart = (key) =>
          /** @type {HTMLElement} */ (row.querySelector(`:scope > [data-part="${key}"]`));
        /** @param {Element} element */
        const readTop = (element) => Math.round(element.getBoundingClientRect().top);
        const noted = /** @type {SeasonFrame[]} */ ([]);
        const note = () => {
          noted.push({
            pageScroll: Math.round(scrollY),
            pageHeight: document.documentElement.scrollHeight,
            pillTop: readTop(pill),
            standingsTop: readTop(findPart("standings")),
            bracketTop: readTop(findPart("bracket")),
            standingsScroll: Math.round(findPart("standings").scrollTop),
            bracketScroll: Math.round(findPart("bracket").scrollTop),
            isSliding: row.hasAttribute("data-sliding"),
          });
          resolve(undefined);
          if (!(/** @type {any} */ (window).isTrackingSeasonDone)) requestAnimationFrame(note);
        };
        requestAnimationFrame(note);
        Object.assign(window, { seasonFrames: noted, isTrackingSeasonDone: false });
      }),
  );
  return () =>
    page.evaluate(() => {
      Object.assign(window, { isTrackingSeasonDone: true });
      return /** @type {SeasonFrame[]} */ (/** @type {any} */ (window).seasonFrames);
    });
}

/** @param {SeasonFrame} frame */
const readPlace = ({ isSliding: _isSliding, ...place }) => place;

/**
 * Checks that the frames caught the parts sliding from a frame at rest, and that on every frame the
 * page held still: it never scrolled or changed height, the pill and both parts stayed at their
 * height on the screen, and each part stayed scrolled as far as it was.
 * @param {SeasonFrame[]} frames
 */
export function expectPageHeldStill(frames) {
  expect(frames.findIndex((frame) => frame.isSliding)).toBeGreaterThan(0);
  const atRest = readPlace(frames[0]);
  expect(frames.map(readPlace)).toEqual(frames.map(() => atRest));
}

/**
 * Jumps a part of the season tab to its end, and waits for the pill to end in its line, which the
 * part's scroll event draws, so nothing the scroll changes lands later.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
export async function scrollSeasonPartToEnd(page, part) {
  await page
    .locator(`#bracketStandingsParts > [data-part="${part}"]`)
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: "instant" }));
  await expect(page.locator("#bracketStandingsPill")).toHaveClass(/\bstuck\b/);
}

/**
 * How far a part of the season tab is scrolled.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
export const readSeasonPartScroll = (page, part) =>
  page
    .locator(`#bracketStandingsParts > [data-part="${part}"]`)
    .evaluate((element) => Math.round(element.scrollTop));
