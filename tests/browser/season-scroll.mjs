// The season tab's parts, each scrolling on its own under the pill, with the header riding up over
// the part shown: where they, the page, the header, and the pill are on each frame as the parts
// slide, and how to scroll a part and read how far it is.

import { expect } from "@playwright/test";

/**
 * @typedef {object} SeasonPlace
 * @property {number} pageScroll how far the page is scrolled
 * @property {number} pageHeight how tall the page is
 * @property {number} headerTop where the header starts down the screen
 * @property {number} pillTop where the pill starts down the screen
 * @property {number} standingsTop where the standings start down the screen
 * @property {number} bracketTop where the bracket starts down the screen
 */

/**
 * @typedef {object} SeasonScrolls
 * @property {number} standingsScroll how far the standings are scrolled
 * @property {number} bracketScroll how far the bracket is scrolled
 */

/** @typedef {SeasonPlace & SeasonScrolls & { isSliding: boolean }} SeasonFrame */

/**
 * Notes where the page, the header, the pill, and the parts are on each frame, until the returned
 * function stops and reads the notes. It returns once it has noted a frame, so the frames start
 * before whatever the test does next.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<SeasonFrame[]>>}
 */
export async function trackSeasonFrames(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const row = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsParts"));
        const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
        const header = /** @type {HTMLElement} */ (document.querySelector("header.top"));
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
            headerTop: readTop(header),
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
const readPlace = ({
  isSliding: _isSliding,
  standingsScroll: _standingsScroll,
  bracketScroll: _bracketScroll,
  ...place
}) => place;

/** @param {SeasonFrame} frame */
const readScrolls = ({ standingsScroll, bracketScroll }) => ({ standingsScroll, bracketScroll });

/**
 * Checks that the frames caught the parts sliding from a frame at rest, and that on every frame the
 * page held still: it never scrolled or changed height, the header, the pill, and both parts
 * stayed at their height on the screen, and from the slide's first frame each part stayed scrolled
 * as far as it was, the part coming in placed before it showed.
 * @param {SeasonFrame[]} frames
 */
export function expectPageHeldStill(frames) {
  const setOff = frames.findIndex((frame) => frame.isSliding);
  expect(setOff).toBeGreaterThan(0);
  const atRest = readPlace(frames[0]);
  expect(frames.map(readPlace)).toEqual(frames.map(() => atRest));
  const placed = readScrolls(frames[setOff]);
  expect(frames.slice(setOff).map(readScrolls)).toEqual(frames.slice(setOff).map(() => placed));
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
 * Turns the mouse's wheel down past the end of a part of the season tab scrolled there, and reads
 * how far the page scrolled meanwhile, once the wheel was handled: a turn back up comes after it,
 * so the part following that one means the browser had already handled the first.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
export async function wheelPastSeasonPartEnd(page, part) {
  await page.evaluate(() => {
    Object.assign(window, { mostPageScroll: scrollY });
    addEventListener(
      "scroll",
      () =>
        Object.assign(window, {
          mostPageScroll: Math.max(Reflect.get(window, "mostPageScroll"), scrollY),
        }),
      { passive: true },
    );
  });
  const end = await readSeasonPartScroll(page, part);
  await page.mouse.wheel(0, 800);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => readSeasonPartScroll(page, part)).toBeLessThan(end);
  return page.evaluate(() => Reflect.get(window, "mostPageScroll"));
}

/**
 * Scrolls a part of the season tab to `top` at once.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 * @param {number} top
 */
export const scrollSeasonPart = (page, part, top) =>
  page
    .locator(`#bracketStandingsParts > [data-part="${part}"]`)
    .evaluate((element, to) => element.scrollTo({ top: to, behavior: "instant" }), top);

/**
 * Where the header and the pill start down the page, and how far the page is scrolled, which a
 * phone's page, a pixel taller than the screen (chrome.css), can be by a pixel.
 * @param {import("@playwright/test").Page} page
 */
export const readSeasonRide = (page) =>
  page.evaluate(() => {
    /** @param {Element} element */
    const readTop = (element) => Math.round(element.getBoundingClientRect().top + scrollY);
    return {
      headerTop: readTop(document.querySelector("header.top")),
      pillTop: readTop(document.getElementById("bracketStandingsPill")),
      pageScroll: Math.round(scrollY),
    };
  });

/**
 * How far a part of the season tab scrolls before the pill holds at the top, rounded as a part's
 * scroll reads.
 * @param {import("@playwright/test").Page} page
 */
export const readHeaderReach = (page) =>
  page.evaluate(() =>
    Math.round(
      parseFloat(
        document.getElementById("view-bracket-standings").style.getPropertyValue("--header-reach"),
      ),
    ),
  );

/**
 * How far a part of the season tab is scrolled.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
export const readSeasonPartScroll = (page, part) =>
  page
    .locator(`#bracketStandingsParts > [data-part="${part}"]`)
    .evaluate((element) => Math.round(element.scrollTop));
