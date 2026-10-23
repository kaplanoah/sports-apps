import { expect } from "@playwright/test";
import { waitForTimedAnimations } from "./animations.mjs";
import { SETTINGS, openSettings } from "./settings.mjs";
import { drag } from "./touch.mjs";

/**
 * Records settings on every frame until the returned function reads and stops the recording.
 * @param {import("@playwright/test").Page} page
 */
async function trackSettingsFrames(page) {
  await page.evaluate((selector) => {
    const dialog = /** @type {HTMLDialogElement} */ (document.querySelector(selector));
    const frames = /** @type {object[]} */ ([]);
    Object.assign(window, { settingsGestureFrames: frames });
    const record = () => {
      if (/** @type {any} */ (window).settingsGestureFrames !== frames) return;
      const box = dialog.getBoundingClientRect();
      frames.push({
        top: box.top,
        left: box.left,
        transform: getComputedStyle(dialog).transform,
        isDragged: dialog.hasAttribute("data-dragged"),
        isOpen: dialog.open,
      });
      requestAnimationFrame(record);
    };
    record();
  }, SETTINGS);
  return () =>
    page.evaluate(() => {
      const frames = /** @type {any} */ (window).settingsGestureFrames;
      Reflect.deleteProperty(window, "settingsGestureFrames");
      return /** @type {{ top: number, left: number, transform: string, isDragged: boolean, isOpen: boolean }[]} */ (
        frames
      );
    });
}

/**
 * A drag starting on the Season picker leaves settings still on every frame and after release,
 * and the picker can still choose another season.
 * @param {import("@playwright/test").Page} page
 * @param {number} distance how far the finger moves down, or up when negative
 * @param {string} [nextYear] another season to choose
 */
export async function checkSeasonPickerDrag(page, distance, nextYear = "2025") {
  await openSettings(page);
  const settings = page.locator(SETTINGS);
  const picker = settings.getByRole("combobox", { name: "Season" });
  await expect(picker).toBeVisible();
  await expect(picker).toBeEnabled();
  await waitForTimedAnimations(page);
  await expect(settings).toHaveJSProperty("scrollTop", 0);
  const box = await picker.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, start)).toBe(
    "seasonPicker",
  );
  const readFrames = await trackSettingsFrames(page);
  const release = await drag(
    page,
    start,
    { y: distance },
    {
      durationMs: 600,
      isFrameByFrame: true,
    },
  );
  await expect(settings).toBeVisible();
  await release();
  await waitForTimedAnimations(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const frames = await readFrames();
  expect(frames.length).toBeGreaterThan(2);
  expect(frames[0].isOpen).toBe(true);
  expect(frames[0].isDragged).toBe(false);
  for (const frame of frames) expect(frame).toEqual(frames[0]);
  await expect(settings).toBeVisible();
  await picker.selectOption(nextYear);
  await expect(page.locator("#titleYear")).toHaveText(nextYear);
  await expect(picker).toHaveValue(nextYear);
}

/**
 * A drag outside the controls still moves settings down, then closes them without stepping back.
 * @param {import("@playwright/test").Page} page
 */
export async function checkSettingsSheetDrag(page) {
  await openSettings(page);
  const settings = page.locator(SETTINGS);
  await waitForTimedAnimations(page);
  const box = await settings.locator(".sheet-top").boundingBox();
  const readDraggedFrames = await trackSettingsFrames(page);
  const release = await drag(
    page,
    { x: box.x + box.width - 24, y: box.y + box.height / 2 },
    { y: 160 },
    { durationMs: 600, isFrameByFrame: true },
  );
  await expect(settings).toHaveAttribute("data-dragged", "");
  const dragged = await readDraggedFrames();
  const readClosingFrames = await trackSettingsFrames(page);
  await release();
  await expect(settings).toBeHidden();
  const closing = await readClosingFrames();
  const tops = [...dragged, ...closing].filter((frame) => frame.isOpen).map((frame) => frame.top);
  expect(tops.some((top) => top > 0 && top < 160)).toBe(true);
  expect(tops.every((top, index) => index === 0 || top >= tops[index - 1])).toBe(true);
}
