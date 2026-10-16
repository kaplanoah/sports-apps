import { test, expect, openApp, openSettings } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";

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

  test("the page opens on the welcome, in MLB's name and its themes, as the WNBA's does", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openApp(page, { isShowingWelcome: true });
    const welcome = page.locator("#homeScreenWelcome");
    await expect(welcome.getByRole("heading")).toHaveText("Add MLB to your Home Screen");
    await expect(welcome.locator(".welcome-steps > li:visible")).toHaveText([
      "Pick your theme You can change it later in Settings System Ball Night Game",
      "Tap Share",
      "Tap Add to Home Screen",
    ]);
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listTapsOffButtons(page)).toEqual([]);

    await welcome.getByRole("radio", { name: "Ball" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await listLowContrastText(page)).toEqual([]);
  });

  test("the settings say how to add the page to the Home Screen, above the ranking", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toContainText(
      "Tap Share, then Add to Home Screen. It opens full screen",
    );
    const { belowSettings, aboveRanking } = await measureTip(page);
    expect(belowSettings).toBeGreaterThan(0);
    expect(aboveRanking).toBeGreaterThan(0);
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
