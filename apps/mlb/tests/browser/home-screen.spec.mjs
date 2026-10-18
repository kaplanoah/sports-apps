import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { drawIcon } from "../../../../tests/browser/home-screen-icons.mjs";
import { MIDDLE_ALLOWANCE, measureStepNumbers } from "../../../../tests/browser/step-numbers.mjs";
import { test, expect, openApp, openSettings, readColor } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listThemeLayoutChanges, showTheme } from "../../../../tests/browser/theme-layout.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PAGE_FOLDER = new URL("../../page/", import.meta.url);

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
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);

    await welcome.getByRole("radio", { name: "Ball" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await listLowContrastText(page)).toEqual([]);
  });

  test("the theme icons sit evenly apart from the start of their row, as far apart on the welcome as in Settings, however long their names", async ({
    page,
  }) => {
    /** The first icon's distance from the start of its row, and each next icon's from the one before. */
    const listIconSteps = (where) =>
      page.locator(`${where} .appearance-choices`).evaluate((row) => {
        const lefts = [row, ...row.querySelectorAll(".appearance-icon")].map(
          (box) => box.getBoundingClientRect().left,
        );
        return lefts.slice(1).map((left, index) => left - lefts[index]);
      });
    await openApp(page, { isShowingWelcome: true });
    expect(await listIconSteps("#homeScreenWelcome")).toEqual([0, 82, 82]);
    await page
      .locator("#homeScreenWelcome")
      .getByRole("button", { name: "Continue in browser" })
      .click();
    await openSettings(page);
    expect(await listIconSteps("#settingsDialog")).toEqual([0, 82, 82]);
  });

  test("each step's number sits in the middle of its circle", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    expect(Math.abs(await measureStepNumbers(page))).toBeLessThan(MIDDLE_ALLOWANCE);
  });

  test("each step's circle sits a pixel under the middle of its words", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    const offsets = await page
      .locator("#homeScreenWelcome .welcome-steps > li:visible")
      .evaluateAll((steps) =>
        steps.map((step) => {
          const circle = getComputedStyle(step, "::before");
          const circleMiddle =
            step.getBoundingClientRect().top +
            parseFloat(circle.top) +
            parseFloat(circle.height) / 2;
          const words = step.querySelector(".welcome-step").getBoundingClientRect();
          return circleMiddle - (words.top + words.height / 2);
        }),
      );
    expect(offsets).toEqual([1, 1, 1]);
  });

  test("the welcome lays out the same in Night Game as in Ball, which change only colors", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator("#homeScreenWelcome")).toBeVisible();
    expect(await listThemeLayoutChanges(page)).toEqual([]);
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

  test("the settings' box sets its steps in the receding ink, its own in Ball and the dim ink in Night Game, around its buttons' names in the full ink", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    const steps = page.locator('#homeScreenTip .home-screen-steps[data-ask="browser"]');
    const looks = [];
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      await showTheme(page, theme);
      expect(await listLowContrastText(page), theme).toEqual([]);
      looks.push({
        steps: await steps.evaluate((element) => getComputedStyle(element).color),
        name: await steps
          .locator("b")
          .first()
          .evaluate((element) => getComputedStyle(element).color),
        receding: await readColor(page, "--receding-ink"),
        dim: await readColor(page, "--ink-dim"),
        ink: await readColor(page, "--ink"),
      });
    }
    const [ball, nightGame] = looks;
    for (const look of looks) {
      expect(look.steps).toBe(look.receding);
      expect(look.name).toBe(look.ink);
    }
    expect(ball.receding).not.toBe(ball.dim);
    expect(nightGame.receding).toBe(nightGame.dim);
  });

  test("the Share icon sits as set by eye for Libre Franklin, 1.5px up in the welcome and 1px up in the settings' box", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    const welcome = page.locator("#homeScreenWelcome");
    await expect(welcome.locator(".welcome-step svg")).toHaveCSS("top", "-1.5px");
    await welcome.getByRole("button", { name: "Continue in browser" }).click();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip .home-screen-steps svg")).toHaveCSS(
      "vertical-align",
      "-1px",
    );
  });

  test("the settings' box sets its buttons' names three quarters of a step over its caption's weight", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    const caption = await readRole(page, "caption");
    const names = page.locator("#homeScreenTip .home-screen-steps b");
    await expect(names).toHaveText(["Share", "Add to Home Screen"]);
    for (const name of await names.all())
      await expect(name).toHaveCSS("font-weight", String(caption.weight + 75));
  });

  test("the settings' box shows the icon the Home Screen takes in the theme on screen, and each theme choice its own, from the page's stylesheet", async ({
    page,
  }) => {
    const icon = page.locator("#homeScreenTip .home-screen-icon");
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await openSettings(page);
    await expect(icon).toHaveCSS("background-image", drawIcon(PAGE_FOLDER, "icon-light-180.png"));
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(icon).toHaveCSS("background-image", drawIcon(PAGE_FOLDER, "icon-180.png"));
    const nameIcon = (image) =>
      ["icon-light-180.png", "icon-180.png"].find(
        (file) => drawIcon(PAGE_FOLDER, file) === image,
      ) ?? image;
    const choiceIcons = await page
      .locator("#settingsDialog .appearance-icon")
      .evaluateAll((icons) =>
        icons.map((choiceIcon) => [
          getComputedStyle(choiceIcon).backgroundImage,
          getComputedStyle(choiceIcon, "::after").backgroundImage,
        ]),
      );
    expect(choiceIcons.map((images) => images.map(nameIcon))).toEqual([
      ["icon-light-180.png", "icon-180.png"],
      ["icon-light-180.png", "none"],
      ["icon-180.png", "none"],
    ]);
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

  test("the welcome keeps to a column as wide as a phone's, in the middle of the screen", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    const column = await page.locator("#homeScreenWelcome .welcome-steps").evaluate((steps) => {
      const box = steps.getBoundingClientRect();
      return { width: box.width, leftOfRight: box.left - (innerWidth - box.right) };
    });
    expect(column).toEqual({ width: 360, leftOfRight: 0 });
  });
});
