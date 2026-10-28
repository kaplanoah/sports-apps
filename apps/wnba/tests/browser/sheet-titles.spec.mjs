import { test, expect, openApp } from "./harness.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { readTextsAndRoles } from "../../../../tests/browser/type-roles.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const SCREENS = {
  "a phone": { width: 390, height: 844 },
  "a wide screen": { width: 1280, height: 860 },
};

for (const [screen, size] of Object.entries(SCREENS))
  test(`on ${screen}, each sheet's title reads its role: Heading for settings and a game, Team, large for a team and a player`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openApp(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("#settingsTitle")).toBeVisible();
    const settings = await readTextsAndRoles(page, { settingsTitle: "heading" });
    expect(settings.drawn).toEqual(settings.expected);
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Games" }).click();
    await page
      .locator("#seasonGames")
      .getByRole("button", { name: "Game details: Aces at Fever, First Round Game 2" })
      .click();
    const gameSheet = page.locator("#gameSheet");
    await expect(gameSheet.locator(".line-score")).toBeVisible();
    await gameSheet
      .locator(".faceoff")
      .getByRole("button", { name: /^Fever\b.*team details$/ })
      .click();
    const teamSheet = page.locator("#teamSheet");
    await expectShown(teamSheet);
    await teamSheet.getByRole("tab", { name: "Roster" }).click();
    await page.locator("#rosterSection").getByRole("button", { name: "Aliyah Boston" }).click();
    await expectShown(page.locator("#playerSheet"));

    const sheets = await readTextsAndRoles(page, {
      gameTitle: "heading",
      teamTitle: "team-large",
      playerTitle: "team-large",
    });
    expect(sheets.drawn).toEqual(sheets.expected);
  });
