import { expect } from "@playwright/test";
import { RECORD_MS } from "../../shared/page/diagnostics.js";
import { openSettings } from "./settings.mjs";

// The Diagnostics records in every app's settings.

/** @param {import("@playwright/test").Page} page */
export const findRecords = (page) => page.locator("#diagnostics");

/**
 * Empties a part and fills it again while the page's record is under way, then moves the visual
 * viewport out of line with the layout one, and opens settings on a record flagged as a dip and a
 * Viewport record flagged as off.
 * @param {import("@playwright/test").Page} page
 * @param {string} part the selector of a part the record watches
 */
export async function showDipAndOffViewport(page, part) {
  const markup = await page.locator(part).evaluate((element) => {
    const shown = element.innerHTML;
    element.replaceChildren();
    return shown;
  });
  await page.clock.runFor(300);
  await page.locator(part).evaluate((element, shown) => {
    element.innerHTML = shown;
  }, markup);
  await page.clock.runFor(RECORD_MS);
  await page.evaluate(() =>
    Object.defineProperty(visualViewport, "offsetTop", { configurable: true, get: () => 110 }),
  );
  await page.evaluate(() => visualViewport?.dispatchEvent(new Event("scroll")));
  await page.clock.runFor(100);
  await openSettings(page);

  const records = findRecords(page).locator(".diagnostics-record");
  await expect(records.first().locator("summary")).toContainText("Dip");
  await expect(records.filter({ hasText: "Viewport" }).locator("summary")).toContainText("Off");
}
