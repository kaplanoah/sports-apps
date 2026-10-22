import { waitForCatchUp } from "./at-rest.mjs";
import { trackTextChanges } from "./text-changes.mjs";

/**
 * Reloads a page whose store is held until its code has drawn what the page last showed, then
 * releases the store with `release`, and lists each year the title shows from then until the page
 * has caught up.
 * @param {import("@playwright/test").Page} page
 * @param {() => void} release
 */
export async function reloadWithStoreHeld(page, release) {
  await page.reload();
  // The page noted when it last caught up before the reload, so only a note after it counts.
  await page.evaluate(() => localStorage.removeItem("syncedAt"));
  const readTitleYears = await trackTextChanges(page, "titleYear");
  release();
  await waitForCatchUp(page);
  return readTitleYears();
}

/**
 * Has each later load find the season the page last showed saved in a version newer than its code
 * reads, as after a release that changes the record.
 * @param {import("@playwright/test").Page} page
 */
export const markLastSeenUnreadable = (page) =>
  page.addInitScript(() => {
    const lastSeen = JSON.parse(localStorage.getItem("lastSeen") ?? "null");
    if (!lastSeen?.season) return;
    lastSeen.season.version = (lastSeen.season.version ?? 0) + 1;
    localStorage.setItem("lastSeen", JSON.stringify(lastSeen));
  });
