import { test, expect, openApp } from "./harness.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { readType } from "../../../../tests/browser/type-roles.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const IPHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const openSettings = (page) => page.getByRole("button", { name: "Settings", exact: true }).click();

/**
 * Chrome's install dialog, offered as Chrome offers it, answered with `outcome`. The page counts
 * how often it's shown.
 * @param {import("@playwright/test").Page} page
 * @param {"accepted" | "dismissed"} outcome
 */
const offerInstall = (page, outcome) =>
  page.evaluate((answer) => {
    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        const counted = /** @type {any} */ (window);
        counted.installShown = (counted.installShown ?? 0) + 1;
      },
      userChoice: Promise.resolve({ outcome: answer }),
    });
    window.dispatchEvent(offer);
    return offer.defaultPrevented;
  }, outcome);

test.describe("on an iPhone, in the browser", () => {
  test.use({ ...PHONE, userAgent: IPHONE_AGENT });

  test("a bar across the top of the screen says how to add the page to the Home Screen", async ({
    page,
  }) => {
    await openApp(page);
    const bar = page.locator("#homeScreenBar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText("Use this site like an app Tap Share, then Add to Home Screen");
    await expect(bar.getByRole("button", { name: "Install" })).toHaveCount(0);

    const barBox = await bar.boundingBox();
    const headerBox = await page.locator("header.top").boundingBox();
    expect(barBox.y).toBe(0);
    expect(barBox.width).toBe(390);
    expect(headerBox.y).toBeGreaterThanOrEqual(barBox.height);
  });

  test("Settings ends with the same steps, in a box under the settings", async ({ page }) => {
    await openApp(page);
    await openSettings(page);
    const tip = page.locator("#homeScreenTip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(
      "Use this site like an app Tap Share, then Add to Home Screen. It opens full screen, without the browser's bars.",
    );
    // Read together, since the sheet may still be rising.
    const gap = await tip.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        document.querySelector(".settings-controls").getBoundingClientRect().bottom,
    );
    expect(gap).toBeGreaterThan(0);
  });

  test("closing the bar keeps it closed on the next visit, and Settings keeps the steps", async ({
    page,
  }) => {
    await openApp(page);
    await page.locator("#homeScreenBar").getByRole("button", { name: "Close" }).click();
    await expect(page.locator("#homeScreenBar")).toBeHidden();

    await page.reload();
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator("#homeScreenBar")).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeVisible();
  });

  test("opened from the Home Screen, the page asks for nothing", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
    });
    await openApp(page);
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator("#homeScreenBar")).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });
});

test.describe("on an Android phone, in the browser", () => {
  test.use(PHONE);

  test("without Chrome's install dialog, the bar and Settings point to the browser's menu", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("#homeScreenBar")).toHaveText(
      "Use this site like an app Tap Menu, then Add to Home screen",
    );
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toHaveText(
      "Use this site like an app Tap Menu, then Add to Home screen. It opens full screen, without the browser's bars.",
    );
  });

  test("Chrome's install dialog takes the place of the steps, and Chrome's own banner, set in Settings as in the bar", async ({
    page,
  }) => {
    await openApp(page);
    expect(await offerInstall(page, "accepted")).toBe(true);

    const bar = page.locator("#homeScreenBar");
    await expect(bar.getByRole("button", { name: "Install" })).toBeVisible();
    await expect(bar).not.toContainText("Tap");
    await openSettings(page);
    const tip = page.locator("#homeScreenTip");
    await expect(tip).toHaveText(
      "Use this site like an app It opens full screen, without the browser's bars Install",
    );
    for (const part of [".home-screen-title", ".home-screen-install"])
      expect(await readType(tip.locator(part)), part).toEqual(await readType(bar.locator(part)));
    expect(await listStrayPeriods(page)).toEqual([]);
  });

  test("installing from the bar opens Chrome's dialog, and then the page asks no more", async ({
    page,
  }) => {
    await openApp(page);
    await offerInstall(page, "accepted");
    await page.locator("#homeScreenBar").getByRole("button", { name: "Install" }).click();

    await expect(page.locator("#homeScreenBar")).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (window).installShown)).toBe(1);
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });

  test("turning Chrome's dialog down brings the steps back", async ({ page }) => {
    await openApp(page);
    await offerInstall(page, "dismissed");
    await openSettings(page);
    await page.locator("#homeScreenTip").getByRole("button", { name: "Install" }).click();

    await expect(page.locator("#homeScreenTip")).toContainText("Tap Menu, then Add to Home screen");
    await expect(page.locator("#homeScreenTip").getByRole("button")).toHaveCount(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).installShown)).toBe(1);
  });

  test("the standings' pill holds just under the bar as the page scrolls", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Standings" }).click();
    const barHeight = (await page.locator("#homeScreenBar").boundingBox()).height;

    await page.evaluate(() => scrollTo({ top: 400, behavior: "instant" }));
    await expect(page.locator("#standings-bar")).toHaveClass(/stuck/);
    const pillBar = await page.locator("#standings-bar").boundingBox();
    expect(Math.round(pillBar.y)).toBe(Math.round(barHeight));
  });

  test("the Games view fits under the bar, its games reaching the screen's bottom without the page scrolling", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
    const barHeight = (await page.locator("#homeScreenBar").boundingBox()).height;
    const header = await page.locator("header.top").boundingBox();
    const list = await page.locator("#seasonGames .day-list").boundingBox();
    expect(header.y).toBeGreaterThanOrEqual(barHeight);
    expect(Math.round(list.y + list.height)).toBeGreaterThanOrEqual(844);
    expect(Math.round(list.y + list.height)).toBeLessThanOrEqual(845);
    const room = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(room).toBeLessThanOrEqual(1);
  });

  test("once installed from the browser's menu, the page asks no more", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("#homeScreenBar")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));

    await expect(page.locator("#homeScreenBar")).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });
});

test("on a computer, the page asks for nothing", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator("#homeScreenBar")).toBeHidden();
  await openSettings(page);
  await expect(page.locator("#homeScreenTip")).toBeHidden();
});
