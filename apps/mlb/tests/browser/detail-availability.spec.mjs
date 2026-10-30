import {
  test,
  expect,
  openApp,
  BOX_SCORES,
  BROADCASTS_FIXTURE,
  buildFixtureSnapshot,
  buildSeasonRecord,
  openSettings,
  matchPath,
} from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("highlights request the shown season and retry an unfilled archive without a feed-error message", async ({
  page,
}) => {
  const past = { ...buildFixtureSnapshot(BROADCASTS_FIXTURE), season: 2025 };
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    store: { "seasons/2025": buildSeasonRecord(past) },
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE), 2025: past },
    boxScores: BOX_SCORES,
  });
  await openSettings(page);
  await page.locator("#seasonPicker").selectOption("2025");
  await page.keyboard.press("Escape");
  await expect(page.locator("#titleYear")).toHaveText("2025");
  const unavailable = (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "not_available_yet", message: "Not available yet" } },
    });
  await page.route(matchPath("/highlights"), unavailable);
  const request = page.waitForRequest(/\/highlights\?/);
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: /^Game details: Brewers at Padres, Tue, Oct 6/ })
    .click();
  const sheet = page.locator("#gameSheet");
  await sheet.getByRole("tab", { name: "Highlights" }).click();
  expect(new URL((await request).url()).searchParams.get("season")).toBe("2025");
  await expect(sheet.locator("#highlightsBody .retry-title")).toHaveText("Not available yet");
  await page.unroute(matchPath("/highlights"), unavailable);
  const retryRequest = page.waitForRequest(/\/highlights\?/);
  await sheet.locator("#highlightsBody").getByRole("button", { name: "Try again" }).click();
  expect(new URL((await retryRequest).url()).searchParams.get("season")).toBe("2025");
  await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(15);
  const reopenedRequest = page.waitForRequest(/\/highlights\?/);
  await page.reload();
  expect(new URL((await reopenedRequest).url()).searchParams.get("season")).toBe("2025");
  await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(15);
});
