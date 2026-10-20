// What's above a list that scrolls, like the Updates box, can grow or shrink while the list is
// scrolled, and the rows on the screen stay where they are on every frame as it eases
// (shared/page/kept-place.js).

import { expect } from "@playwright/test";

/**
 * @typedef {object} RowFrame
 * @property {number} rowTop where the row starts down the screen
 * @property {number} boxHeight how tall the Updates box is
 * @property {boolean} isPillHeld whether the season tab's pill holds at the top
 */

/**
 * Notes where the last row `selector` finds is on the screen each time the page's size changes,
 * with the Updates box's height and whether the pill holds, until the returned function stops and
 * reads the notes. It notes as the page's own observers have placed what moves, once each frame,
 * before the frame is drawn, so it notes what each frame shows.
 * @param {import("@playwright/test").Page} page
 * @param {string} selector
 * @returns {Promise<() => Promise<RowFrame[]>>}
 */
export async function trackRowFrames(page, selector) {
  await page.evaluate((rowSelector) => {
    const row = /** @type {Element} */ ([...document.querySelectorAll(rowSelector)].at(-1));
    const box = /** @type {HTMLElement} */ (document.getElementById("updates"));
    const pill = document.getElementById("bracketStandingsPill");
    const noted = /** @type {RowFrame[]} */ ([]);
    const watcher = new ResizeObserver(() =>
      noted.push({
        rowTop: row.getBoundingClientRect().top,
        boxHeight: Math.round(box.getBoundingClientRect().height),
        isPillHeld: !!pill?.classList.contains("held"),
      }),
    );
    watcher.observe(box);
    watcher.observe(document.body);
    Object.assign(window, { rowFrames: noted, rowWatcher: watcher });
  }, selector);
  return () =>
    page.evaluate(() => {
      /** @type {any} */ (window).rowWatcher.disconnect();
      return /** @type {RowFrame[]} */ (/** @type {any} */ (window).rowFrames);
    });
}

/**
 * Checks that the frames caught the box partway open, and that the row held still on every frame,
 * but for less than the pixel a page's scroll rounds to, with the pill held throughout when
 * `isPillHeld`.
 * @param {RowFrame[]} frames
 * @param {{ isPillHeld: boolean }} options
 */
export function expectRowHeldStill(frames, { isPillHeld }) {
  const [first] = frames;
  const last = /** @type {RowFrame} */ (frames.at(-1));
  expect(last.boxHeight).toBeGreaterThan(first.boxHeight);
  expect(
    frames.some(({ boxHeight }) => boxHeight > first.boxHeight && boxHeight < last.boxHeight),
  ).toBe(true);
  const moves = frames.map(({ rowTop }) => Math.abs(rowTop - first.rowTop));
  expect(Math.max(...moves)).toBeLessThan(1);
  expect(frames.map((frame) => frame.isPillHeld)).toEqual(frames.map(() => isPillHeld));
}
