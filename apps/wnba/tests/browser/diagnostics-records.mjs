import { expect } from "./harness.mjs";
import { RECORD_MS } from "../../../../shared/page/diagnostics.js";

// Reloading to record what the WNBA page draws.

export { RECORD_MS };

/**
 * Reloads the page and waits until it shows the season's bracket, while its record is under way.
 * @param {import("@playwright/test").Page} page
 */
export async function reloadToRecord(page) {
  await page.reload();
  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
}

/**
 * Reloads the page and lets its record finish.
 * @param {import("@playwright/test").Page} page
 */
export async function reloadAndRecord(page) {
  await reloadToRecord(page);
  await page.clock.runFor(RECORD_MS + 1000);
}
