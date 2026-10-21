import { test, expect, matchPath, openApp } from "./harness.mjs";
import { waitForTimedAnimations } from "../../../../tests/browser/animations.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { measureFieldFace, readRole } from "../../../../tests/browser/type-roles.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { SETTINGS, openSettings } from "../../../../tests/browser/settings.mjs";
import {
  checkFailedPickPutBack,
  checkNewCurrentSeasonListed,
  checkPickKeptThroughRedraw,
  checkSeasonsOnFailedList,
  checkSettingsOnReload,
  waitForSettingsFill,
} from "../../../../tests/browser/settings-reload.mjs";
import { openFromHomeScreen } from "../../../../tests/browser/touch.mjs";
import { readTopSpacing } from "../../../../tests/browser/sheet-top.mjs";
import { ONE_PAST_SEASON } from "./past-season.mjs";
import { chooseAppearance } from "./theme.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const readBackground = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const MAPLE = "rgb(234, 213, 178)";
const WALNUT = "rgb(29, 21, 17)";

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function expectTheme(page, theme) {
  const isDark = theme === "dark";
  await expect.poll(() => readBackground(page)).toBe(isDark ? WALNUT : MAPLE);
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
    isDark ? "#1d1511" : "#ead5b2",
  );
}

test("settings' header holds its title, its close button, and the room under them alike on a phone and a wide screen", async ({
  page,
}) => {
  const top = page.locator(`${SETTINGS} .sheet-top`);
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(top).toBeVisible();
  const onPhone = await readTopSpacing(top);

  await page.setViewportSize({ width: 1280, height: 844 });

  expect(await readTopSpacing(top)).toEqual(onPhone);
});

test("the Season picker sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the detail role's text", async ({
  page,
}) => {
  await openApp(page);
  const picker = page.locator("#seasonPicker");
  await expect(picker).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(picker, "--type-detail-size");
  expect(widths.field).toBeCloseTo(widths.role, 0);
});

test("a reload with settings open shows its seasons, switches, and look picked before the page's code arrives", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await checkSettingsOnReload({
    page,
    look: "Walnut",
    switchName: "Include content from The Athletic",
    pastSeason: "2025",
    currentSeason: "2026",
  });
});

test("a season picked while its record is on its way stays picked as the picker is drawn again meanwhile", async ({
  page,
}) => {
  const app = await openApp(page, ONE_PAST_SEASON);
  await checkPickKeptThroughRedraw({
    page,
    pastSeason: "2025",
    newSeason: 2027,
    moveCurrentTo: (year) => app.writeDocument("live/current", { season: year }),
  });
});

test("a reload while the store can't be reached keeps the Season picker on the past season the page shows", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  await picker.selectOption("2025");
  await expect(page.locator("#titleYear")).toHaveText("2025");
  await page.route(matchPath("/store/"), (route) => route.abort());
  const filling = waitForSettingsFill(page);

  await page.reload();

  await filling;
  await expect(picker).toHaveValue("2025");
  await expect(picker.locator("option")).toHaveText(["2026", "2025"]);
});

test("a reload while the store can't be reached, with nothing the page last showed to draw, leaves the Season picker as drawn, through a pick that can't be read too, never adding the year by the phone's clock", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await openSettings(page);
  const picker = page.locator("#seasonPicker");
  await expect(picker.locator("option")).toHaveText(["2026", "2025"]);
  await page.route(matchPath("/store/"), (route) => route.abort());
  await page.addInitScript(() => localStorage.removeItem("lastSeen"));
  await page.clock.setSystemTime(new Date("2027-01-15T17:00:00Z"));
  const filling = waitForSettingsFill(page);

  await page.reload();

  await filling;
  await expect(picker.locator("option")).toHaveText(["2026", "2025"]);
  await expect(picker).toHaveValue("2026");

  await picker.selectOption("2025");

  await expect(picker).toHaveValue("2026");
  await expect(picker.locator("option")).toHaveText(["2026", "2025"]);
});

test("a past season picked whose record can't be read puts the Season picker back on the season shown, says so, and can be picked again", async ({
  page,
}) => {
  await openApp(page, ONE_PAST_SEASON);
  await checkFailedPickPutBack({ page, pastSeason: "2025", currentSeason: "2026" });
});

test("while the store can't list its seasons, a new current season joins the Season picker, with the past season shown still chosen", async ({
  page,
}) => {
  const app = await openApp(page, ONE_PAST_SEASON);
  await checkNewCurrentSeasonListed({
    page,
    pastSeason: "2025",
    newSeason: 2027,
    moveCurrentTo: (year) => app.writeDocument("live/current", { season: year }),
    seasons: ["2027", "2026", "2025"],
  });
});

test("a reload with settings open while the store can't list its seasons lists the ones it listed, with the season shown, even one the store moved on to, chosen", async ({
  page,
}) => {
  const app = await openApp(page, ONE_PAST_SEASON);
  await checkSeasonsOnFailedList({
    page,
    beforeReload: () => app.moveSeasonTo(2027),
    seasons: ["2027", "2026", "2025"],
    shown: "2027",
  });
});

test("settings list Notifications, the News switches, and Appearance, with lines only between the three", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registration = { pushManager: { getSubscription: async () => null } };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: async () => registration, addEventListener() {} },
    });
    Object.defineProperty(Notification, "permission", { get: () => "default" });
  });
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const rows = page.locator(`${SETTINGS} .settings-controls .control-row`);
  await expect(rows.locator(".control-label > span:first-child")).toHaveText([
    "Notifications",
    "Include dedicated Liberty sources",
    "Include content from The Athletic",
    "Appearance",
  ]);
  await expect(page.locator("#notifyNote")).toHaveText("Final scores");
  const groups = page.locator(`${SETTINGS} .settings-controls > *`);
  const readBorders = () =>
    Promise.all([
      groups.evaluateAll((each) => each.map((group) => getComputedStyle(group).borderTopStyle)),
      rows.evaluateAll((each) => each.map((row) => getComputedStyle(row).borderTopStyle)),
      page
        .locator(`${SETTINGS} .settings-controls`)
        .evaluate((controls) => getComputedStyle(controls).borderBottomStyle),
    ]);
  // The Season row stays hidden while the store keeps only the current season.
  expect(await readBorders()).toEqual([
    ["none", "none", "solid", "solid"],
    ["none", "none", "none", "none", "solid"],
    "none",
  ]);

  await page.locator("#notifyRow").evaluate((row) => row.setAttribute("hidden", ""));
  expect((await readBorders())[0]).toEqual(["none", "none", "none", "solid"]);
});

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

test("choosing Walnut or Maple overrides the phone, and the choice stays after a reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await chooseAppearance(page, "Walnut");
  await expectTheme(page, "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");

  await page.emulateMedia({ colorScheme: "dark" });
  await chooseAppearance(page, "Maple");
  await expectTheme(page, "light");
  await chooseAppearance(page, "System");
  await expectTheme(page, "dark");
});

test("a look this device kept by its plain name on an earlier visit still shows", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("appearance", "dark"));
  await openApp(page);

  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Walnut" })).toBeChecked();
});

test("a look chosen in another tab shows in this one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page);
  await expectTheme(page, "light");

  await keepInOtherTab(page, "appearance", "dark");

  await expectTheme(page, "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Walnut" })).toBeChecked();
});

test("settings end with the release the page came from, NBA.com's credit for the data, and the copyright, without asking the Worker", async ({
  page,
}) => {
  const served = await serveReleases(page);
  served.isHanging = true;
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const footer = page.locator(`${SETTINGS} .settings-footer`);
  await expect(footer.locator(".settings-version")).toHaveText([
    /^v2\.13\.0\u2022Released /,
    "Includes data from NBA.com",
    "\u00a9 2026 Noah Kaplan",
  ]);
  await expect(page.locator(`${SETTINGS} .sheet-top`)).not.toContainText("NBA.com");
});

/**
 * Opens settings with the release named at their foot, and waits for the sheet to settle.
 * @param {import("@playwright/test").Page} page
 */
async function openSettingsWithRelease(page) {
  await serveReleases(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("#versionNote")).toBeVisible();
  await waitForTimedAnimations(page);
}

/** @param {import("@playwright/test").Page} page */
const readSettingsBoxes = (page) =>
  page.locator(SETTINGS).evaluate((dialog) => {
    const readBox = (selector) => dialog.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sheet: dialog.getBoundingClientRect().toJSON(),
      body: readBox(".settings-body"),
      top: readBox(".sheet-top"),
      head: readBox(".sheet-head"),
      title: readBox("h2"),
      close: readBox(".sheet-close"),
      tip: readBox("#homeScreenTip"),
      controls: readBox(".settings-controls"),
      footer: readBox(".settings-footer"),
    };
  });

test.describe("on a phone, settings", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("rise from the bottom to fill the screen, like every sheet", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openSettingsWithRelease(page);
    const { sheet } = await readSettingsBoxes(page);
    expect([sheet.top, sheet.height]).toEqual([0, 844]);
  });

  // A phone's browser, unlike the Home Screen app, draws the Home Screen box.
  test("set their title level with their close button and 32px over the Home Screen box, then the first setting, and end 17px over the bottom", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { sheet, top, head, title, close, tip, controls, footer } = await readSettingsBoxes(page);
    const findMiddle = (box) => box.top + box.height / 2;
    expect(Math.abs(findMiddle(title) - findMiddle(close))).toBeLessThan(1);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
    expect(Math.round(tip.top - title.bottom)).toBe(32);
    expect(Math.round(controls.top - tip.bottom)).toBe(14);
    expect(Math.round(sheet.bottom - footer.bottom)).toBe(17);
  });

  test("in the Home Screen app, which has no Home Screen box, set the first setting 32px under their title", async ({
    page,
  }) => {
    await openFromHomeScreen(page);
    await openSettingsWithRelease(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
    const { title, controls } = await readSettingsBoxes(page);
    expect(Math.round(controls.top - title.bottom)).toBe(32);
  });
});

test.describe("on a wide screen, settings", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("open nearly the screen's height, like every sheet, in the middle of the screen", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { sheet } = await readSettingsBoxes(page);
    expect(Math.round(sheet.height)).toBe(900 - 48);
    expect(Math.abs(sheet.top + sheet.height / 2 - 450)).toBeLessThan(1);
  });

  test("set their title level with their close button, inside the header", async ({ page }) => {
    await openSettingsWithRelease(page);
    const { top, head, title, close } = await readSettingsBoxes(page);
    const findMiddle = (box) => box.top + box.height / 2;
    expect(Math.abs(findMiddle(title) - findMiddle(close))).toBeLessThan(1);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("settings set a setting's name a step over a sentence, and its note and the appearance names a step over a fact, with bigger icons", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const readSize = (locator) =>
      locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    const [setting, note, body, detail] = await Promise.all(
      ["setting", "setting-note", "body", "detail"].map(
        async (role) => (await readRole(page, role)).size,
      ),
    );

    expect(await readSize(page.getByText("Include content from The Athletic"))).toBe(setting);
    expect(await readSize(page.getByText("Most stories need a subscription"))).toBe(note);
    expect(await readSize(page.locator(`${SETTINGS} .appearance-choice`).first())).toBe(note);
    expect(setting).toBeGreaterThan(body);
    expect(note).toBeGreaterThan(detail);
    const icon = await page.locator(`${SETTINGS} .appearance-icon`).first().boundingBox();
    expect(icon.width).toBe(60);
  });

  test("a switch's knob is Walnut's cream in each theme, on or off", async ({ page }) => {
    await openApp(page);
    for (const appearance of ["Maple", "Walnut"]) {
      await chooseAppearance(page, appearance);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const knobs = await page
        .locator(`${SETTINGS} .switch:visible`)
        .evaluateAll((switches) =>
          switches.map((element) => [
            element.getAttribute("aria-checked"),
            getComputedStyle(element.querySelector(".switch-knob")).backgroundColor,
          ]),
        );
      expect(new Set(knobs.map(([checked]) => checked)), appearance).toEqual(
        new Set(["true", "false"]),
      );
      for (const [checked, color] of knobs)
        expect(color, `${appearance}, ${checked}`).toBe("rgb(241, 233, 223)");
      await page.keyboard.press("Escape");
    }
  });
});
