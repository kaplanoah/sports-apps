import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { drawIcon } from "../../../../tests/browser/home-screen-icons.mjs";
import { MIDDLE_ALLOWANCE, measureStepNumbers } from "../../../../tests/browser/step-numbers.mjs";
import { test, expect, openApp } from "./harness.mjs";
import { PHONE, WELCOME, CONTINUE, openSettings } from "./home-screen.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listThemeLayoutChanges } from "../../../../tests/browser/theme-layout.mjs";
import { listTextOffRoles, readRole } from "../../../../tests/browser/type-roles.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PAGE_FOLDER = new URL("../../page/", import.meta.url);

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
    await expect(welcome.getByRole("heading")).toHaveText("Add WNBA to your home screen");
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
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator(WELCOME)).toBeVisible();
    expect(await listThemeLayoutChanges(page)).toEqual([]);
  });

  test("each step's number sits in the middle of its circle", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    expect(Math.abs(await measureStepNumbers(page))).toBeLessThan(MIDDLE_ALLOWANCE);
  });

  // An iPhone's bottom inset, which keeps its home bar clear, is 34px, and Android's Chrome has none.
  test("Continue's text sits 24px over the welcome's bottom, on an iPhone and where there's no inset", async ({
    page,
  }) => {
    await openApp(page, { isShowingWelcome: true });
    const textOverBottom = await page.locator(WELCOME).evaluate((welcome) => {
      const rule = /** @type {CSSStyleRule} */ (
        [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules])
          .find((each) => each instanceof CSSStyleRule && each.selectorText === ".welcome")
      );
      const declared = rule.style.paddingBottom;
      const halfButton =
        welcome.querySelector(".welcome-continue").getBoundingClientRect().height / 2;
      return [34, 0].map((inset) => {
        const probe = document.createElement("div");
        probe.style.paddingBottom = declared.replace("env(safe-area-inset-bottom)", `${inset}px`);
        welcome.append(probe);
        const padding = parseFloat(getComputedStyle(probe).paddingBottom);
        probe.remove();
        return padding + halfButton;
      });
    });
    expect(textOverBottom).toEqual([24, 24]);
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

  test("where Safari refuses the page its storage, a theme picked on the welcome still shows, without loading the page again", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
    });
    await page.emulateMedia({ colorScheme: "light" });
    // The harness would keep the Updates box dismissed in the storage this test takes away.
    await openApp(page, { isShowingWelcome: true, updatesBox: "new" });
    await expect(page.locator("#stamp")).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    await page.locator(WELCOME).getByRole("radio", { name: "Walnut" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("#homeScreenIcon")).toHaveAttribute("href", "icon-180.png");
    expect(await page.evaluate(() => "isBeforePick" in window)).toBe(true);
  });

  test("before the page's code arrives, the welcome already picks the theme and closes for good", async ({
    page,
  }) => {
    await page.route(/\/js\/app\.js(?:[?#]|$)/, (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    const welcome = page.locator(WELCOME);
    await welcome.getByRole("radio", { name: "Walnut" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await welcome.getByRole("button", CONTINUE).click();
    await expect(welcome).toBeHidden();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(welcome).toBeHidden();
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
    expect(await listLowContrastText(page)).toEqual([]);
    await welcome.getByRole("button", CONTINUE).click();
    await openSettings(page);
    await expect(page.locator('input[name="appearance"][value="dark"]')).toBeChecked();
  });

  // Safari opens a Home Screen app at the page's address as it stood when it was added.
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
      "Use this site like an app Tap Share then Add to Home Screen. It'll open full screen, without the browser's bars.",
      { useInnerText: true },
    );
  });

  test("the settings' box's Share icon sits as set by eye for Barlow, 1.5px over the other icons' place", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    await expect(page.locator("#homeScreenTip .home-screen-steps svg")).toHaveCSS(
      "vertical-align",
      "-0.5px",
    );
  });

  test("the settings' box sets its buttons' names a step over its caption's weight", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    const caption = await readRole(page, "caption");
    const names = page.locator("#homeScreenTip .home-screen-steps b");
    await expect(names).toHaveText(["Share", "Add to Home Screen"]);
    for (const name of await names.all())
      await expect(name).toHaveCSS("font-weight", String(caption.weight + 100));
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
    const choiceIcons = page.locator("#settingsDialog .appearance-icon");
    await expect(choiceIcons.nth(0)).toHaveCSS(
      "background-image",
      drawIcon(PAGE_FOLDER, "icon-system-180.png"),
    );
    await expect(choiceIcons.nth(1)).toHaveCSS(
      "background-image",
      drawIcon(PAGE_FOLDER, "icon-light-180.png"),
    );
    await expect(choiceIcons.nth(2)).toHaveCSS(
      "background-image",
      drawIcon(PAGE_FOLDER, "icon-180.png"),
    );
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
      "Use this site like an app Tap Menu then Add to Home screen. It'll open full screen, without the browser's bars.",
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
      "Use this site like an app It'll open full screen, without the browser's bars INSTALL",
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

    await expect(page.locator("#homeScreenTip")).toContainText("Tap Menu then Add to Home screen");
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
