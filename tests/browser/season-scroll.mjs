// The season tab's parts, each scrolling on its own under the pill, with the header riding up over
// the part shown: where they, the page, the header, and the pill are on each frame as the parts
// slide, and how to scroll a part and read how far it is.

import { expect } from "@playwright/test";

/** @typedef {import("#shared/bracket-standings.js").SeasonPart} SeasonPart */

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

/**
 * @typedef {SeasonPlace & SeasonScrolls & { isSliding: boolean, shownPart: SeasonPart }} SeasonFrame
 */

/**
 * One of the season tab's parts.
 * @param {import("@playwright/test").Page} page
 * @param {SeasonPart} part
 */
export const findSeasonPart = (page, part) =>
  page.locator(`#bracketStandingsParts > [data-part="${part}"]`);

/**
 * What a touch at each point lands on: the season's part under it, by name, or else the button, by
 * its id.
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, { x: number, y: number }>} points
 */
export const findTouchTargets = (page, points) =>
  page.evaluate(
    (spots) =>
      Object.fromEntries(
        Object.entries(spots).map(([name, { x, y }]) => {
          const target = document.elementFromPoint(x, y);
          const part = target?.closest(".season-part")?.getAttribute("data-part");
          return [name, part ?? target?.closest("button")?.id];
        }),
      ),
    points,
  );

/**
 * The middle of a box, where a thumb taps it.
 * @param {{ x: number, y: number, width: number, height: number }} box
 */
export const findCenter = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * Notes where the page, the header, the pill, and the parts are on each frame, and which part the
 * pill names, until the returned function stops and reads the notes. It returns once it has noted
 * a frame, so the frames start before whatever the test does next.
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
            shownPart: /** @type {SeasonPart} */ (
              /** @type {HTMLElement} */ (pill.querySelector("[aria-selected=true]")).dataset.tab
            ),
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
  shownPart: _shownPart,
  standingsScroll: _standingsScroll,
  bracketScroll: _bracketScroll,
  ...place
}) => place;

/**
 * Checks that the frames caught the parts sliding from a frame at rest, and that on every frame the
 * page held still: it never scrolled or changed height, the header, the pill, and both parts
 * stayed at their height on the screen, the part shown at rest stayed scrolled as far as it was,
 * and the part coming in, placed before it showed, stayed where it was placed.
 * @param {SeasonFrame[]} frames
 */
export function expectPageHeldStill(frames) {
  const setOff = frames.findIndex((frame) => frame.isSliding);
  expect(setOff).toBeGreaterThan(0);
  const atRest = readPlace(frames[0]);
  expect(frames.map(readPlace)).toEqual(frames.map(() => atRest));
  const shownScroll = /** @type {const} */ (`${frames[0].shownPart}Scroll`);
  const comingScroll = shownScroll === "standingsScroll" ? "bracketScroll" : "standingsScroll";
  expect(frames.map((frame) => frame[shownScroll])).toEqual(
    frames.map(() => frames[0][shownScroll]),
  );
  const sliding = frames.slice(setOff);
  expect(sliding.map((frame) => frame[comingScroll])).toEqual(
    sliding.map(() => frames[setOff][comingScroll]),
  );
}

/**
 * Jumps a part of the season tab to its end, and waits for the pill to end in its line, which the
 * part's scroll event draws, so nothing the scroll changes lands later.
 * @param {import("@playwright/test").Page} page
 * @param {SeasonPart} part
 */
export async function scrollSeasonPartToEnd(page, part) {
  await findSeasonPart(page, part).evaluate((element) =>
    element.scrollTo({ top: element.scrollHeight, behavior: "instant" }),
  );
  await expect(page.locator("#bracketStandingsPill")).toHaveClass(/\bstuck\b/);
}

/**
 * Turns the mouse's wheel down past the end of a part of the season tab scrolled there, and reads
 * how far the page scrolled meanwhile, once the wheel was handled: a turn back up comes after it,
 * so the part following that one means the browser had already handled the first.
 * @param {import("@playwright/test").Page} page
 * @param {SeasonPart} part
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
 * Scrolls a part of the season tab to `top` at once, and waits for the frame after its scroll
 * event, so what the page draws from the scroll has landed.
 * @param {import("@playwright/test").Page} page
 * @param {SeasonPart} part
 * @param {number} top
 */
export const scrollSeasonPart = (page, part, top) =>
  findSeasonPart(page, part).evaluate(
    (element, to) =>
      new Promise((resolve) => {
        const from = element.scrollTop;
        element.addEventListener("scroll", () => requestAnimationFrame(resolve), { once: true });
        element.scrollTo({ top: to, behavior: "instant" });
        if (element.scrollTop === from) resolve(undefined);
      }),
    top,
  );

/**
 * Where the header and the pill start down the page, and how far the page is scrolled, which a
 * phone's page, a pixel taller than the screen (chrome.css), can be by a pixel. The pill's top is
 * rounded up, as the page rounds the header's ride, which holds the pill up to a pixel above where
 * its band reaches.
 * @param {import("@playwright/test").Page} page
 */
export const readSeasonRide = (page) =>
  page.evaluate(() => {
    /** @param {Element} element */
    const readTop = (element) => element.getBoundingClientRect().top + scrollY;
    return {
      headerTop: Math.round(readTop(document.querySelector("header.top"))),
      pillTop: Math.ceil(readTop(document.getElementById("bracketStandingsPill"))),
      pageScroll: Math.round(scrollY),
    };
  });

/**
 * How far down the page the pill holds once the header is gone: as far as its band above it
 * reaches, under the status bar.
 * @param {import("@playwright/test").Page} page
 */
export const readPillHoldTop = (page) =>
  page.evaluate(() =>
    Math.round(
      parseFloat(
        getComputedStyle(document.getElementById("bracketStandingsPill"), "::before").height,
      ),
    ),
  );

/**
 * Whether the band above the pill shows, which covers what rides up under the status bar once the
 * pill holds.
 * @param {import("@playwright/test").Page} page
 */
export const isPillBandShown = (page) =>
  page
    .locator("#bracketStandingsPill")
    .evaluate((pill) => getComputedStyle(pill, "::before").visibility === "visible");

/**
 * How far a part of the season tab scrolls before the pill holds at the top.
 * @param {import("@playwright/test").Page} page
 */
export const readHeaderReach = (page) =>
  page.evaluate(() =>
    parseFloat(
      document.getElementById("view-bracket-standings").style.getPropertyValue("--header-reach"),
    ),
  );

/**
 * How far a part of the season tab is scrolled.
 * @param {import("@playwright/test").Page} page
 * @param {SeasonPart} part
 */
export const readSeasonPartScroll = (page, part) =>
  findSeasonPart(page, part).evaluate((element) => Math.round(element.scrollTop));

/**
 * Has the page open as in a browser without scroll-driven animations, where the header stays put.
 * Call it before the page loads.
 * @param {import("@playwright/test").Page} page
 */
export const holdHeaderStill = (page) =>
  page.addInitScript(() => Reflect.deleteProperty(window, "ScrollTimeline"));
