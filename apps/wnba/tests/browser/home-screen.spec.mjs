import { test, expect, openApp } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listThemeLayoutChanges } from "../../../../tests/browser/theme-layout.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";

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

const WELCOME = "#homeScreenWelcome";
const CONTINUE = { name: "Continue in the browser" };

/** @param {import("@playwright/test").Page} page */
const listWelcomeSteps = (page) => page.locator(`${WELCOME} .welcome-steps > li:visible`);

const PICK_STEP = "Pick your theme You can change it later in Settings System Maple Walnut";

test.describe("on an iPhone, in the browser", () => {
  test.use({ ...PHONE, userAgent: IPHONE_AGENT });

  test("the page opens on the welcome, which picks a theme and says how to add the page to the Home Screen", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    const welcome = page.locator(WELCOME);
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole("heading")).toHaveText("Add WNBA to your Home Screen");
    await expect(listWelcomeSteps(page)).toHaveText([
      PICK_STEP,
      "Tap Share",
      "Tap Add to Home Screen",
    ]);
    await expect(welcome.getByRole("radio", { name: "System" })).toBeChecked();
    await expect(welcome.getByRole("button", CONTINUE)).toBeVisible();
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listLowContrastText(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    expect(await listTapsOffButtons(page)).toEqual([]);
    expect(await listNeverShownWords(page, LEAGUE_WORDS.neverShown)).toEqual([]);
  });

  test("the welcome lays out the same in Walnut as in Maple, which change only colors", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator(WELCOME)).toBeVisible();
    expect(await listThemeLayoutChanges(page)).toEqual([]);
  });

  test("the welcome is there before the page's code runs, so it never arrives over the page", async ({
    page,
  }) => {
    await page.route(/\/js\/app\.js(?:[?#]|$)/, (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator(WELCOME)).toBeVisible();
    await expect(listWelcomeSteps(page)).toHaveText([
      PICK_STEP,
      "Tap Share",
      "Tap Add to Home Screen",
    ]);
  });

  test("a theme picked on the welcome is the page's theme, its Home Screen icon, and Appearance's pick in Settings", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    const welcome = page.locator(WELCOME);
    await welcome.getByRole("radio", { name: "Walnut" }).check();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#homeScreenIcon")).toHaveAttribute("href", "icon-180.png");
    await expect(welcome.getByRole("radio", { name: "Walnut" })).toBeChecked();
    await expect(page.locator("#manifestLink")).toHaveAttribute(
      "href",
      "manifest.webmanifest?theme=dark",
    );
    expect(await listLowContrastText(page)).toEqual([]);
    await welcome.getByRole("radio", { name: "System" }).check();
    await expect(page.locator("#manifestLink")).toHaveAttribute("href", "manifest.webmanifest");
    await welcome.getByRole("radio", { name: "Walnut" }).check();
    await welcome.getByRole("button", CONTINUE).click();
    await openSettings(page);
    await expect(page.locator('input[name="appearance"][value="dark"]')).toBeChecked();
  });

  test("going on in the browser closes the welcome for good on this device, and Settings keeps the steps", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await expect(page.locator(WELCOME)).toBeHidden();

    await page.reload();
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator(WELCOME)).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toHaveText(
      "Use this site like an app Tap Share, then Add to Home Screen. It opens full screen, without the browser's bars.",
      { useInnerText: true },
    );
  });

  test("the settings' box shows the icon the Home Screen takes in the theme on screen", async ({
    page,
  }) => {
    const icon = page.locator("#homeScreenTip .home-screen-icon");
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await openSettings(page);
    await expect(icon).toHaveCSS("background-image", /\/icon-light-180\.png/);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(icon).toHaveCSS("background-image", /\/icon-180\.png/);
  });

  test("the Home Screen app's first open takes the theme its address names, drops it from the address, and never puts it over one picked since", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await page.goto("/?theme=dark");
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(new URL(page.url()).search).toBe("");
    await openSettings(page);
    await expect(page.locator('input[name="appearance"][value="dark"]')).toBeChecked();

    await page.locator("#settingsDialog").getByRole("radio", { name: "Maple" }).check();
    await page.goto("/?theme=dark");
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("a shared link that names a theme opens in the browser on the phone's own, and drops it from the address", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await page.goto("/?theme=dark");
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(new URL(page.url()).search).toBe("");
    await openSettings(page);
    await expect(page.locator('input[name="appearance"][value="auto"]')).toBeChecked();
  });

  test("opened from the Home Screen, the page asks for nothing", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
    });
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator(WELCOME)).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });
});

test.describe("on an Android phone, in the browser", () => {
  test.use(PHONE);

  test("without Chrome's install dialog, the welcome and Settings point to the browser's menu", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    await expect(listWelcomeSteps(page)).toHaveText([
      PICK_STEP,
      "Tap Menu",
      "Tap Add to Home screen",
    ]);
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toHaveText(
      "Use this site like an app Tap Menu, then Add to Home screen. It opens full screen, without the browser's bars.",
      { useInnerText: true },
    );
  });

  test("Chrome's install dialog takes the place of the steps in the welcome and Settings, and of Chrome's own banner", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    expect(await offerInstall(page, "accepted")).toBe(true);

    await expect(listWelcomeSteps(page)).toHaveText([PICK_STEP, "Tap to install Install"]);
    expect(await listTextOffRoles(page)).toEqual([]);
    expect(await listStrayPeriods(page)).toEqual([]);
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toHaveText(
      "Use this site like an app It opens full screen, without the browser's bars INSTALL",
      { useInnerText: true },
    );
    expect(await listStrayPeriods(page)).toEqual([]);
  });

  test("installing from the welcome opens Chrome's dialog, and then the page asks no more", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    await offerInstall(page, "accepted");
    await page.locator(WELCOME).getByRole("button", { name: "Install" }).click();

    await expect(page.locator(WELCOME)).toBeHidden();
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

  test("once installed from the browser's menu, the page asks no more", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator(WELCOME)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));

    await expect(page.locator(WELCOME)).toBeHidden();
    await openSettings(page);
    await expect(page.locator("#homeScreenTip")).toBeHidden();
  });
});

test("on a computer, the page asks for nothing", async ({ page }) => {
  await openApp(page, { isShowingWelcome: true });
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator(WELCOME)).toBeHidden();
  await openSettings(page);
  await expect(page.locator("#homeScreenTip")).toBeHidden();
});
