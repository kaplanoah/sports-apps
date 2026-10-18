import { test, expect, openApp, openSettings, serveLockedApp } from "./harness.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import {
  checkHandoffRenewal,
  checkReAddHandoff,
  checkReAddNote,
  checkReAddNoteDismissal,
  checkReAddNoteEases,
  checkSystemInstallIcon,
} from "../../../../tests/browser/re-add-note.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const BALL = "rgb(245, 241, 230)";
const NIGHT_GAME = "rgb(13, 31, 22)";

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectTheme(page, theme) {
  const isDark = theme === "dark";
  await expect.poll(() => readBackground(page)).toBe(isDark ? NIGHT_GAME : BALL);
  await expect(page.locator("#homeScreenIcon")).toHaveAttribute(
    "href",
    isDark ? "icon-180.png" : "icon-light-180.png",
  );
  await expect(page.locator("#tabIcon")).toHaveAttribute(
    "href",
    isDark ? "icon.svg" : "icon-light.svg",
  );
  await expect(page.locator("#themeColor")).toHaveAttribute(
    "content",
    isDark ? "#0d1f16" : "#f5f1e6",
  );
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} choice
 */
async function chooseAppearance(page, choice) {
  await openSettings(page);
  await page
    .getByRole("radiogroup", { name: "Appearance" })
    .getByRole("radio", { name: choice, exact: true })
    .check();
  await page.keyboard.press("Escape");
}

test("on System, the page and its icons follow the phone's dark or light setting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await expect(page.locator('input[name="appearance"][value="auto"]')).toBeChecked();
  await expectTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expectTheme(page, "light");
});

test("choosing Night Game or Ball overrides the phone, and the choice stays after a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await chooseAppearance(page, "Night Game");
  await expectTheme(page, "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await chooseAppearance(page, "Ball");
  await expectTheme(page, "light");
  await chooseAppearance(page, "System");
  await expectTheme(page, "dark");
});

test("a look chosen in another tab shows in this one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await expectTheme(page, "light");

  await keepInOtherTab(page, "appearance", "dark");

  await expectTheme(page, "dark");
  await openSettings(page);
  await expect(page.getByRole("radio", { name: "Night Game" })).toBeChecked();
});

test.describe("in an iPhone's Home Screen app", () => {
  test.use({ userAgent: IPHONE_AGENT });
  const looks = { light: "Ball", dark: "Night Game" };

  test("while the look picked isn't the icon's, settings shows both icons and how to update it, linking to Safari on the look picked, which System, the browser, and Android leave out", async ({
    page,
    context,
    browser,
  }) => {
    await checkReAddNote({ page, context, browser, openApp, openSettings, looks });
  });

  test("the icon note's X takes it away for good in that install", async ({ page }) => {
    await checkReAddNoteDismissal({ page, openApp, openSettings, looks });
  });

  test("an app added on System has the icon the phone's setting showed as it first opened", async ({
    page,
  }) => {
    await checkSystemInstallIcon({ page, openApp, openSettings, looks });
  });

  test("the icon note grows in as a pick sets the icon off and shrinks away as its opening played backward", async ({
    page,
  }) => {
    await checkReAddNoteEases({ page, openApp, openSettings, looks });
  });

  test("behind an access code, the link signs Safari in, so it opens the welcome on the theme picked without asking for the code", async ({
    page,
    browser,
  }) => {
    await checkReAddHandoff({ page, browser, serveLockedApp, openSettings, looks });
  });

  test("the link's handoff renews halfway through and on coming back once that's due, tries again after a failure, stops once settings closes or the icon's look is picked, and starts again as settings opens on the note", async ({
    page,
  }) => {
    await checkHandoffRenewal({ page, serveLockedApp, openSettings, looks });
  });
});

test("Appearance sits under Notifications, above the News switches, each choice showing the icon it offers", async ({
  page,
}) => {
  await openApp(page);
  await openSettings(page);
  const appearance = page.locator("#settingsDialog .appearance-row");
  const news = page.locator("#settingsDialog .settings-news");
  const [appearanceBox, newsBox] = await Promise.all([
    appearance.boundingBox(),
    news.boundingBox(),
  ]);
  expect(appearanceBox.y + appearanceBox.height).toBeLessThanOrEqual(newsBox.y);
  await expect(appearance.locator(".appearance-choice")).toHaveText([
    "System",
    "Ball",
    "Night Game",
  ]);
  for (const icon of await appearance.locator(".appearance-icon").all())
    expect(await icon.boundingBox()).toMatchObject({ width: 60, height: 60 });
});
