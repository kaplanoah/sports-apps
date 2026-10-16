import { test, expect, openApp, openSettings } from "./harness.mjs";
import { readType } from "../../../../tests/browser/type-roles.mjs";

const IPHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * How far below the settings the Home Screen box starts, and how far below it the ranking's
 * heading does, read together, since the sheet may still be rising.
 * @param {import("@playwright/test").Page} page
 */
const measureTip = (page) =>
  page.locator("#homeScreenTip").evaluate((tip) => {
    const readBox = (selector) => document.querySelector(selector).getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const settings = readBox(".settings-controls");
    const ranking = readBox("#rankingTitle");
    return {
      belowSettings: box.top - settings.bottom,
      aboveRanking: ranking.top - box.bottom,
      besideRanking: ranking.left - box.right,
    };
  });

test.describe("on an iPhone, in the browser", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE_AGENT,
  });

  test("a bar across the top says how to add the page to the Home Screen, and so do the settings, above the ranking, its title set as the bar's", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("#homeScreenBar")).toHaveText(
      "Use this site like an app Tap Share, then Add to Home Screen",
    );

    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toContainText(
      "Tap Share, then Add to Home Screen. It opens full screen",
    );
    const { belowSettings, aboveRanking } = await measureTip(page);
    expect(belowSettings).toBeGreaterThan(0);
    expect(aboveRanking).toBeGreaterThan(0);
    expect(await readType(page.locator("#homeScreenTip .home-screen-title"))).toEqual(
      await readType(page.locator("#homeScreenBar .home-screen-title")),
    );
  });
});

test.describe("on a tablet, in the browser", () => {
  test.use({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: true,
    userAgent: IPHONE_AGENT.replace("iPhone; CPU iPhone OS", "iPad; CPU OS"),
  });

  test("the Home Screen box sits under the settings, beside the ranking", async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeVisible();
    const { belowSettings, besideRanking } = await measureTip(page);
    expect(belowSettings).toBeGreaterThan(0);
    expect(besideRanking).toBeGreaterThan(0);
  });
});
