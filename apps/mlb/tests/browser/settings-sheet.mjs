import { expect, SEASON_2025 } from "./harness.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

// Settings show the Season picker once the store keeps more than one season.
export const WITH_A_PAST_SEASON = { store: { "seasons/2025": SEASON_2025 } };

/** @param {import("@playwright/test").Page} page */
export const scrollSettingsToEnd = (page) =>
  page.locator(SETTINGS).evaluate((dialog) => {
    const settings = /** @type {HTMLElement} */ (dialog.querySelector(".settings-body"));
    dialog.scrollTop = settings.offsetHeight - dialog.clientHeight;
  });

/** @param {import("@playwright/test").Page} page */
export async function waitForSheetToRise(page) {
  await expect.poll(async () => Math.round((await page.locator(SETTINGS).boundingBox()).y)).toBe(0);
}
