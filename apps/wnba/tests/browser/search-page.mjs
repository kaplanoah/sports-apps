import { expect, openApp } from "./harness.mjs";

// Search, the round button beside the tab bar, over the whole season and its players, on a phone.
// Today is Wednesday, September 30.

export const ON_A_PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

export const PLAYER_INDEX = {
  season: 2026,
  players: [
    { id: "1627668", team: "NYL", number: "30", firstName: "Breanna", lastName: "Stewart" },
    { id: "1628932", team: "LVA", number: "22", firstName: "A'ja", lastName: "Wilson" },
  ],
};

/** @param {import("@playwright/test").Page} page */
export const findInput = (page) => page.locator("#gameSearch .search-input");
/** @param {import("@playwright/test").Page} page */
export const findRows = (page) => page.locator("#gameSearch .search-suggestion");

/**
 * Opens the whole season, with its list of players, on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
export async function openSeasonGames(page) {
  const app = await openApp(page, { isWholeSeason: true });
  await app.writeDocument("player-index/2026", PLAYER_INDEX);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  return app;
}

/**
 * Taps Search beside the tab bar where a finger would.
 * @param {import("@playwright/test").Page} page
 */
export async function tapSearch(page) {
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await page.locator("#tab-search").boundingBox()
  );
  const found = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.id ?? null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(found).toBe("tab-search");
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Searches for words, as the keyboard's Search key sends them.
 * @param {import("@playwright/test").Page} page
 * @param {string} words
 */
export async function sendSearch(page, words) {
  await findInput(page).fill(words);
  await findInput(page).press("Enter");
}
