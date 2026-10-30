import { test, expect, openApp, matchPath } from "./harness.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const THEMES = /** @type {const} */ (["light", "dark"]);

for (const theme of THEMES) {
  for (const width of [390, 1280]) {
    test(`unfilled history explains availability and retries in ${theme} at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await openApp(page);
      await openSeasonPart(page, "Standings");
      await page
        .getByRole("button", { name: /^Liberty\b.*team details$/ })
        .first()
        .click();
      await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      const roster = page.locator("#rosterSection");
      await expect(roster.locator(".roster-coach")).toBeVisible();
      const unavailable = (route) =>
        route.fulfill({
          status: 409,
          json: { error: { code: "not_available_yet", message: "Not available yet" } },
        });
      await page.route(matchPath("/player"), unavailable);
      await roster.getByRole("button", { name: "Breanna Stewart" }).click();
      const sheet = page.locator("#playerSheet");
      await expect(sheet.locator(".retry-title")).toHaveText("Not available yet");
      await page.screenshot({ path: `/tmp/step2-availability-${theme}-${width}.png` });
      await page.unroute(matchPath("/player"), unavailable);
      await sheet.getByRole("button", { name: "Try again" }).click();
      await expect(sheet.locator(".player-facts")).toBeVisible();
      await expect(sheet.locator(".retry-block")).toHaveCount(0);
    });
  }
}
