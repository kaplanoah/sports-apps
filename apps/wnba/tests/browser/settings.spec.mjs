import { test, expect, openApp, serveLockedApp } from "./harness.mjs";
import { serveReleases } from "../../../../tests/browser/serve-releases.mjs";
import { measureFieldFace, readRole } from "../../../../tests/browser/type-roles.mjs";
import { keepInOtherTab } from "../../../../tests/browser/other-tab.mjs";
import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { checkReAddHandoff, checkReAddNote } from "../../../../tests/browser/re-add-note.mjs";
import { readTopSpacing } from "../../../../tests/browser/sheet-top.mjs";
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
  const top = page.locator("#settingsDialog .sheet-top");
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
  const rows = page.locator("#settingsDialog .settings-controls .control-row");
  await expect(rows.locator(".control-label > span:first-child")).toHaveText([
    "Notifications",
    "Include dedicated Liberty sources",
    "Include content from The Athletic",
    "Appearance",
  ]);
  await expect(page.locator("#notifyNote")).toHaveText("Final scores");
  const groups = page.locator("#settingsDialog .settings-controls > *");
  const readBorders = () =>
    Promise.all([
      groups.evaluateAll((each) => each.map((group) => getComputedStyle(group).borderTopStyle)),
      rows.evaluateAll((each) => each.map((row) => getComputedStyle(row).borderTopStyle)),
      page
        .locator("#settingsDialog .settings-controls")
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

test.describe("in an iPhone's Home Screen app", () => {
  test.use({ userAgent: IPHONE_AGENT });

  test("changing the appearance says how to update the icon, under the icons, linking to Safari on the theme picked, which the browser and Android leave out", async ({
    page,
    context,
    browser,
  }) => {
    const openSettings = (tab) =>
      tab.getByRole("button", { name: "Settings", exact: true }).click();
    const looks = { light: "Maple", dark: "Walnut" };
    await checkReAddNote({ page, context, browser, openApp, openSettings, looks });
  });

  test("behind an access code, the link signs Safari in, so it opens the welcome on the theme picked without asking for the code", async ({
    page,
    browser,
  }) => {
    const openSettings = (tab) =>
      tab.getByRole("button", { name: "Settings", exact: true }).click();
    const looks = { light: "Maple", dark: "Walnut" };
    await checkReAddHandoff({ page, browser, serveLockedApp, openSettings, looks });
  });
});

test("settings end with the release, NBA.com's credit for the data, and the copyright", async ({
  page,
}) => {
  await serveReleases(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const footer = page.locator("#settingsDialog .settings-footer");
  await expect(footer.locator(".settings-version")).toHaveText([
    /^v\d/,
    "Includes data from NBA.com",
    "\u00a9 2026 Noah Kaplan",
  ]);
  await expect(page.locator("#settingsDialog .sheet-top")).not.toContainText("NBA.com");
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
  await page.waitForFunction(() => document.getAnimations().length === 0);
}

/** @param {import("@playwright/test").Page} page */
const readSettingsBoxes = (page) =>
  page.locator("#settingsDialog").evaluate((dialog) => {
    const readBox = (selector) => dialog.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      sheet: dialog.getBoundingClientRect().toJSON(),
      body: readBox(".settings-body"),
      top: readBox(".sheet-top"),
      head: readBox(".sheet-head"),
      title: readBox("h2"),
      close: readBox(".sheet-close"),
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

  test("set their title level with their close button and 32px over the first setting, and end 17px over the bottom", async ({
    page,
  }) => {
    await openSettingsWithRelease(page);
    const { sheet, top, head, title, close, controls, footer } = await readSettingsBoxes(page);
    const findMiddle = (box) => box.top + box.height / 2;
    expect(Math.abs(findMiddle(title) - findMiddle(close))).toBeLessThan(1);
    expect(head.bottom).toBeLessThanOrEqual(top.bottom);
    expect(Math.round(controls.top - title.bottom)).toBe(32);
    expect(Math.round(sheet.bottom - footer.bottom)).toBe(17);
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
    expect(await readSize(page.locator("#settingsDialog .appearance-choice").first())).toBe(note);
    expect(setting).toBeGreaterThan(body);
    expect(note).toBeGreaterThan(detail);
    const icon = await page.locator("#settingsDialog .appearance-icon").first().boundingBox();
    expect(icon.width).toBe(60);
  });

  test("a switch's knob is Walnut's cream in each theme, on or off", async ({ page }) => {
    await openApp(page);
    for (const appearance of ["Maple", "Walnut"]) {
      await chooseAppearance(page, appearance);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const knobs = await page
        .locator("#settingsDialog .switch:visible")
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
