import { test, expect, expectDayAtTop, openApp, matchPath } from "./harness.mjs";
import { SNAPSHOT_VERSION } from "../../page/js/snapshot.js";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { readYearTracking } from "../../../../tests/browser/title-row.mjs";
import { SETTINGS, openSettings } from "../../../../tests/browser/settings.mjs";
import { ONE_PAST_SEASON } from "./past-season.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * @param {import("@playwright/test").Page} page
 * @param {number} year
 */
async function chooseSeason(page, year) {
  await openSettings(page);
  await page.getByRole("combobox", { name: "Season" }).selectOption(String(year));
  await page.keyboard.press("Escape");
  await expect(page.locator(SETTINGS)).toBeHidden();
}

test("with only the current season kept, settings show no Season picker", async ({ page }) => {
  await openApp(page);
  await openSettings(page);

  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Season" })).toHaveCount(0);
});

test("a new season the store moves on to joins the list, and the page shows it", async ({
  page,
}) => {
  const app = await openApp(page, ONE_PAST_SEASON);
  const emptySeason = { games: [], series: [], standings: [], leaders: [], missing: [] };
  await app.writeDocument("seasons/2027", {
    ...emptySeason,
    version: SNAPSHOT_VERSION,
    season: 2027,
  });
  await app.writeDocument("live/current", { season: 2027 });
  await expect(page.locator(".series")).toHaveCount(0);

  await openSettings(page);
  const picker = page.getByRole("combobox", { name: "Season" });
  await expect(picker.locator("option")).toHaveText(["2027", "2026", "2025"]);
  await expect(picker).toHaveValue("2027");
});

test("a past season's Games tab opens on its last day, and the current season's on today", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await page.getByRole("tab", { name: "Games" }).click();
  await expectDayAtTop(page, "2026-09-30");
  await chooseSeason(page, 2025);

  const days = page.locator("#seasonGames .listed-day");
  await expect(days.last()).toHaveAttribute("data-day", /^2025-09/);
  const lastDay = await days.last().getAttribute("data-day");
  await expect(page.locator("#seasonGames .day-list")).toContainText("Final");
  await expect(page.locator("#seasonGames .no-games")).toHaveCount(0);
  expect((await days.first().getAttribute("data-day")).startsWith("2025-")).toBe(true);
  await expect(days.last()).toBeInViewport();
  await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
    "data-day",
    lastDay,
  );
  await page.locator("#seasonGames .day-list").evaluate((list) => list.scrollTo({ top: 0 }));
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(days.last()).toBeInViewport();

  await chooseSeason(page, 2026);
  await expectDayAtTop(page, "2026-09-30");
  await expect(page.locator("#seasonGames .game-day.is-today")).toContainText("Dream");
});

test("a past season's final opens its sheet with its box score", async ({ page }) => {
  await openApp(page, ONE_PAST_SEASON);
  await chooseSeason(page, 2025);
  await page.getByRole("tab", { name: "Games" }).click();

  await page
    .locator("#seasonGames")
    .getByRole("button", { name: "Game details: Aces at Fever, First Round Game 2" })
    .click();

  const sheet = page.locator("#gameSheet");
  await expect(sheet.locator(".faceoff .score")).toHaveText(/89\s*99/);
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces, team details\s*26\s*17\s*17\s*29\s*89/,
  );
});

test("a past season's header names its last game, and leaves out the current season's problems", async ({
  page,
}) => {
  const app = await openApp(page, ONE_PAST_SEASON);
  await app.writeDocument("live/status", { error: "upstream_error" });
  const stamp = page.locator("#stamp");
  await expect(stamp).toContainText("The WNBA isn't answering right now");
  expect(await listStrayPeriods(page)).toEqual([]);

  await chooseSeason(page, 2025);

  await expect(stamp).toContainText("Last game");
  await expect(stamp).not.toContainText("The WNBA isn't answering");
  await expect(stamp).not.toContainText("Next tip-off");
});

/** @param {import("@playwright/test").Page} page */
const findTitle = (page) => page.getByRole("heading", { level: 1 });

test("an earlier season puts its year in the title until the current one is back", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await expect(findTitle(page)).toHaveText("WNBA");

  await chooseSeason(page, 2025);
  await expect(findTitle(page)).toHaveText("WNBA 2025");

  await chooseSeason(page, 2026);
  await expect(findTitle(page)).toHaveText("WNBA");
});

test("once the Finals are won, the current season's year is in the title too", async ({ page }) => {
  const app = await openApp(page);
  await expect(findTitle(page)).toHaveText("WNBA");

  await app.changeSeason((season) => ({
    ...season,
    series: season.series.map((series) =>
      series.round === 3 ? { ...series, winner: "NYL" } : series,
    ),
  }));

  await expect(findTitle(page)).toHaveText("WNBA 2026");
});

test("the year is the title's font and size, lighter, dimmer, and its digits 0.04em apart", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await chooseSeason(page, 2025);
  await expect(findTitle(page)).toHaveText("WNBA 2025");
  const readLook = (selector) =>
    page.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element);
      const { fontFamily, fontSize, letterSpacing, fontWeight, color } = style;
      return { fontFamily, fontSize, letterSpacing, fontWeight, color };
    });

  const title = await readLook("header.top h1");
  const year = await readLook("#titleYear");

  const sameLook = {
    fontWeight: title.fontWeight,
    color: title.color,
    letterSpacing: title.letterSpacing,
  };
  expect({ ...year, ...sameLook }).toEqual(title);
  expect(Number(year.fontWeight)).toBeLessThan(Number(title.fontWeight));
  expect(year.color).not.toBe(title.color);
  expect(await readYearTracking(page)).toBeCloseTo(0.04, 3);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a past season shows no Updates box, not even the app's release notes, and the current one shows it again", async ({
    page,
  }) => {
    await page.route(matchPath("/js/release-notes.js"), (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: 'export const RELEASE_NOTES = [{ at: "2026-09-30T20:55:00Z", text: "Something new." }];',
      }),
    );
    await openApp(page, { ...ONE_PAST_SEASON, updatesBox: "shown" });
    const updates = page.locator("#updates");
    await expect(updates).toContainText("Something new.");

    await chooseSeason(page, 2025);
    await expect(updates).toBeHidden();

    await chooseSeason(page, 2026);
    await expect(updates).toContainText("Something new.");
  });
});
