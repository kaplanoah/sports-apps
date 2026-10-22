import { waitForCatchUp } from "./at-rest.mjs";
import { trackTextChanges } from "./text-changes.mjs";

/**
 * Reloads a page showing a past season, with its store held until its code has drawn what the page
 * last showed, and lists each year the title shows from then until the page has caught up.
 * @param {import("@playwright/test").Page} page
 * @param {{ holdStore: () => Promise<() => void> }} app
 */
export async function reloadOnPastSeason(page, app) {
  const release = await app.holdStore();
  await page.reload();
  // The page noted when it last caught up before the reload, so only a note after it counts.
  await page.evaluate(() => localStorage.removeItem("syncedAt"));
  const readTitleYears = await trackTextChanges(page, "titleYear");
  release();
  await waitForCatchUp(page);
  return readTitleYears();
}
