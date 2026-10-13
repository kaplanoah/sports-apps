import { expect, openApp, MATCHUP_STARTERS, buildSnapshotWithStarters } from "./harness.mjs";

// The games of the first day after today, which the Games view lists under today's.
export const NEXT_DAY_GAMES = "#seasonGames .listed-day:has(.is-today) + .listed-day .game-open";

export const ASTROS_AT_ATHLETICS = "Game details: Astros at Athletics, Thu, Sep 24";
export const BLUBAUGH_VS_SPRINGS = "Pitching matchup: Blubaugh vs Springs";

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
export async function showGames(
  page,
  pitchers = MATCHUP_STARTERS,
  snapshot = buildSnapshotWithStarters(),
) {
  await openApp(page, { snapshots: { 2026: snapshot }, pitchers });
  await page.getByRole("tab", { name: "Games" }).click();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
export async function openGame(
  page,
  pitchers = MATCHUP_STARTERS,
  snapshot = buildSnapshotWithStarters(),
) {
  await showGames(page, pitchers, snapshot);
  await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
  return page.locator("#gameSheet");
}

/**
 * @param {import("@playwright/test").Locator} sheet
 * @param {string} name
 */
export async function showSection(sheet, name) {
  await sheet.getByRole("tab", { name }).click();
  await expect(sheet.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<number, object>} [pitchers]
 * @param {object} [snapshot]
 */
export async function openMatchup(
  page,
  pitchers = MATCHUP_STARTERS,
  snapshot = buildSnapshotWithStarters(),
) {
  const sheet = await openGame(page, pitchers, snapshot);
  await showSection(sheet, "Matchup");
  return sheet;
}
