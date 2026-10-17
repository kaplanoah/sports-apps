import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { drawIcon } from "../../../../tests/browser/home-screen-icons.mjs";
import { MIDDLE_ALLOWANCE, measureStepNumbers } from "../../../../tests/browser/step-numbers.mjs";
import { test, expect, openApp } from "./harness.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listNeverShownWords } from "../../../../tests/browser/never-shown-words.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listThemeLayoutChanges } from "../../../../tests/browser/theme-layout.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { LEAGUE_WORDS } from "../../page/js/league-words.js";

const PAGE_FOLDER = new URL("../../page/", import.meta.url);

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

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
const CONTINUE = { name: "Continue in browser" };

/** @param {import("@playwright/test").Page} page */
const listWelcomeSteps = (page) => page.locator(`${WELCOME} .welcome-steps > li:visible`);

/**
 * Taps a theme where Safari loads the page again for the pick, as a check would wait to see the
 * radio checked on the page the pick replaced.
 * @param {import("@playwright/test").Locator} choices
 * @param {string} name
 */
const pickReloadingTheme = (choices, name) => choices.getByRole("radio", { name }).click();

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

  test("each step's number sits in the middle of its circle", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    expect(Math.abs(await measureStepNumbers(page))).toBeLessThan(MIDDLE_ALLOWANCE);
  });

  test("the heading opens the welcome's room", async ({ page }) => {
    await openApp(page, { isShowingWelcome: true });
    const headingGap = await page.locator(WELCOME).evaluate((welcome) => {
      const roomTop =
        welcome.getBoundingClientRect().top + parseFloat(getComputedStyle(welcome).paddingTop);
      return welcome.querySelector(".welcome-title").getBoundingClientRect().top - roomTop;
    });
    expect(headingGap).toBe(0);
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
    await openApp(page, { isShowingWelcome: true, isShowingUpdates: true });
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
  test("a theme picked in the browser rides in the page's address, which keeps it through a reload, and System takes it out", async ({
    page,
  }) => {
    const readTheme = () => new URL(page.url()).searchParams.get("theme");
    await openApp(page, { isShowingWelcome: true });
    await page.locator(WELCOME).getByRole("radio", { name: "Walnut" }).check();
    await expect.poll(readTheme).toBe("dark");
    await page.reload();
    await expect(page.locator("#stamp")).toBeVisible();
    expect(readTheme()).toBe("dark");

    await page.locator(WELCOME).getByRole("radio", { name: "System" }).check();
    await expect.poll(readTheme).toBe(null);
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await openSettings(page);
    await page.locator("#settingsDialog").getByRole("radio", { name: "Maple" }).check();
    await expect.poll(readTheme).toBe("light");
  });

  test("in Safari, a pick loads the page again at the address that names it, still on the welcome", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    await expect(page.locator(WELCOME)).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    await pickReloadingTheme(page.locator(WELCOME), "Walnut");
    await expect.poll(() => new URL(page.url()).searchParams.get("theme")).toBe("dark");
    await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(WELCOME).getByRole("radio", { name: "Walnut" })).toBeChecked();
  });

  test("a theme picked in another tab renames this tab's address too", async ({
    page,
    context,
  }) => {
    const readTheme = () => new URL(page.url()).searchParams.get("theme");
    await openApp(page);
    await expect(page.locator("#stamp")).toBeVisible();
    const otherTab = await context.newPage();
    await openApp(otherTab);
    await openSettings(otherTab);
    await otherTab.locator("#settingsDialog").getByRole("radio", { name: "Walnut" }).check();
    await expect.poll(readTheme).toBe("dark");
  });

  test("in Safari, a pick in Settings loads the page again at its address, with Settings back open", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await expect(page.locator("#stamp")).toBeVisible();
    await openSettings(page);
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    await pickReloadingTheme(page.locator("#settingsDialog"), "Walnut");
    await expect.poll(() => new URL(page.url()).searchParams.get("theme")).toBe("dark");
    await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      page.locator("#settingsDialog").getByRole("radio", { name: "Walnut" }),
    ).toBeChecked();
  });

  test("in Safari, a pick in another tab loads this tab again at the address that names it", async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
    await openApp(page);
    await expect(page.locator("#stamp")).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    const otherTab = await context.newPage();
    await openApp(otherTab);
    await openSettings(otherTab);
    await pickReloadingTheme(otherTab.locator("#settingsDialog"), "Walnut");
    await expect.poll(() => new URL(page.url()).searchParams.get("theme")).toBe("dark");
    await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
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

  test("the Home Screen app, where the phone refuses it storage, shows the phone's theme from its first paint", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => true });
      Object.defineProperty(window, "localStorage", {
        get: () => {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
      const themesShown = [];
      Object.assign(window, { themesShown });
      new MutationObserver(() => themesShown.push(document.documentElement.dataset.theme)).observe(
        document,
        { subtree: true, attributeFilter: ["data-theme"] },
      );
    });
    await page.emulateMedia({ colorScheme: "dark" });
    // The harness would keep the welcome and the Updates box closed in the storage this test takes away.
    await openApp(page, { isShowingWelcome: true, isShowingUpdates: true });
    await page.goto("/?theme=dark");
    await expect(page.locator("#stamp")).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    const themesShown = await page.evaluate(() => /** @type {any} */ (window).themesShown);
    expect(new Set(themesShown)).toEqual(new Set(["dark"]));
  });

  test("a theme picked on an earlier visit is in the page's address as it opens in the browser", async ({
    page,
  }) => {
    await openApp(page);
    await page.evaluate(() => localStorage.setItem("appearance", JSON.stringify("dark")));
    await page.goto("/");
    await expect(page.locator("#stamp")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("theme")).toBe("dark");
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

  test("the Home Screen app's link to re-add the site opens the browser on the app's theme, kept as its own, and on the welcome, even once closed", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page);
    await page.goto("/?app-theme=dark");
    await expect(page.locator(WELCOME)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(new URL(page.url()).search).toBe("?theme=dark");
    await expect(page.locator(WELCOME).getByRole("radio", { name: "Walnut" })).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem("appearance"))).toBe('"dark"');
  });

  test("the welcome the Home Screen app's link opens stays through the reload a pick on it brings in Safari", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    await page.locator(WELCOME).getByRole("button", { name: "Continue in browser" }).click();
    await expect(page.locator(WELCOME)).toBeHidden();
    await page.goto("/?app-theme=dark");
    await expect(page.locator(WELCOME)).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    await pickReloadingTheme(page.locator(WELCOME), "Maple");
    await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(WELCOME)).toBeVisible();
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
