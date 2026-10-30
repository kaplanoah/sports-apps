import {
  test,
  expect,
  openApp,
  BOX_SCORES,
  BROADCASTS_FIXTURE,
  buildFixtureSnapshot,
  matchPath,
} from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("highlights request the shown season and retry an unfilled archive without a feed-error message", async ({
  page,
}) => {
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
    boxScores: BOX_SCORES,
  });
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
  expect(new URL((await request).url()).searchParams.get("season")).toBe("2026");
  await expect(sheet.locator("#highlightsBody .retry-title")).toHaveText("Not available yet");
  await page.unroute(matchPath("/highlights"), unavailable);
  await sheet.locator("#highlightsBody").getByRole("button", { name: "Try again" }).click();
  await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(15);
});
