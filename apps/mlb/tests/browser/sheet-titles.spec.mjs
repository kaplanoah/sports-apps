import {
  test,
  expect,
  openApp,
  openSettings,
  buildSnapshotWithStarters,
  MATCHUP_STARTERS,
  PITCHER_SIDES,
  PLAYER_DOCS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { ASTROS_AT_ATHLETICS, showSection } from "./open-game-sheet.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { readTextsAndRoles } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const SCREENS = {
  "a phone": { width: 390, height: 844 },
  "a wide screen": { width: 1280, height: 860 },
};

for (const [screen, size] of Object.entries(SCREENS))
  test(`on ${screen}, each sheet's title reads its role: Heading for settings, a game, and its matchup, Team, large for a club and a player`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openApp(page, {
      store: { ...ROSTER_DOCS, ...PLAYER_DOCS },
      pitchers: { ...PITCHER_SIDES, ...MATCHUP_STARTERS },
      snapshots: { 2026: buildSnapshotWithStarters() },
    });

    await openSettings(page);
    await expect(page.locator("#settingsTitle")).toBeVisible();
    const settings = await readTextsAndRoles(page, { settingsTitle: "heading" });
    expect(settings.drawn).toEqual(settings.expected);
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Games" }).click();
    await page.getByRole("button", { name: ASTROS_AT_ATHLETICS }).click();
    const gameSheet = page.locator("#gameSheet");
    await showSection(gameSheet, "Matchup");
    await expect(gameSheet.locator(".pitch-mix")).toHaveCount(2);
    const matchup = await readTextsAndRoles(page, { gameTitle: "heading" });
    expect(matchup.drawn).toEqual(matchup.expected);
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Standings" }).click();
    await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
    const teamSheet = page.locator("#teamSheet");
    await expectShown(teamSheet);
    await teamSheet.getByRole("tab", { name: "Roster" }).click();
    await teamSheet
      .locator("#rosterBody tr")
      .filter({ hasText: "Steven Kwan" })
      .getByRole("button")
      .first()
      .click();
    const playerSheet = page.locator("#playerSheet");
    await expect(playerSheet.locator("#playerTitle")).toHaveText("Steven Kwan");
    await expectShown(playerSheet);

    const sheets = await readTextsAndRoles(page, {
      teamTitle: "team-large",
      playerTitle: "team-large",
    });
    expect(sheets.drawn).toEqual(sheets.expected);
  });
