import { expect, openApp } from "./harness.mjs";

// Finding the parts of a season's Games view, and opening it on the whole season.

/** @param {import("@playwright/test").Page} page */
export const findList = (page) => page.locator("#seasonGames .day-list");

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
export const findDay = (page, day) => page.locator(`#seasonGames .listed-day[data-day="${day}"]`);

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 */
export const findCell = (page, day) => page.locator(`#seasonGames .day-cell[data-day="${day}"]`);

/**
 * Opens the page on the whole season, once the store's list of every game has arrived, which
 * comes after the season and draws the list again.
 * @param {import("@playwright/test").Page} page
 */
export async function openWholeSeason(page) {
  const app = await openApp(page, { isWholeSeason: true });
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  return app;
}

/**
 * Opens the whole season on the Games tab.
 * @param {import("@playwright/test").Page} page
 */
export async function openSeasonGames(page) {
  const app = await openWholeSeason(page);
  await page.getByRole("tab", { name: "Games" }).click();
  return app;
}
