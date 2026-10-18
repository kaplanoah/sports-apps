import { IPHONE_AGENT } from "../../../../tests/browser/devices.mjs";
import { test, expect, openApp, serveLockedApp, LOCKED_PAGE_PATH } from "./harness.mjs";
import { PHONE, WELCOME, CONTINUE, openSettings } from "./home-screen.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * Taps a theme where Safari loads the page again for the pick, as a check would wait to see the
 * radio checked on the page the pick replaced.
 * @param {import("@playwright/test").Locator} choices
 * @param {string} name
 */
const pickReloadingTheme = (choices, name) => choices.getByRole("radio", { name }).click();

test.describe("on an iPhone, in the browser", () => {
  test.use({ ...PHONE, userAgent: IPHONE_AGENT });

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
    // The harness would keep the welcome closed in the storage this test takes away.
    await openApp(page, { isShowingWelcome: true });
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

  test("the Home Screen app's link opens the welcome past the gate, even once closed", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await serveLockedApp(page, { accessCode: "FASTBREAK" });
    await page.goto(LOCKED_PAGE_PATH);
    await page.evaluate((key) => localStorage.setItem(key, "closed"), "homeScreenWelcomeClosed");
    await page.goto(`${LOCKED_PAGE_PATH}?app-theme=dark`);
    await page.getByRole("textbox", { name: "Access code" }).fill("FASTBREAK");
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.locator(WELCOME)).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("a theme the page doesn't have reads as System, kept or named by a link, which then opens no welcome", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    await page.evaluate(() => localStorage.setItem("appearance", '"sepia"'));
    await page.reload();
    await expect(page.locator(WELCOME).getByRole("radio", { name: "System" })).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await page.goto("/?app-theme=sepia");
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator("#stamp")).toBeVisible();
    await expect(page.locator(WELCOME)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("appearance"))).toBe('"sepia"');
  });

  test("the welcome the Home Screen app's link opens stays through the reload a pick on it brings in Safari", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { get: () => false });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await openApp(page, { isShowingWelcome: true });
    await page.locator(WELCOME).getByRole("button", CONTINUE).click();
    await expect(page.locator(WELCOME)).toBeHidden();
    await page.goto("/?app-theme=dark");
    await expect(page.locator(WELCOME)).toBeVisible();
    await page.evaluate(() => Object.assign(window, { isBeforePick: true }));
    await pickReloadingTheme(page.locator(WELCOME), "Maple");
    await expect.poll(() => page.evaluate(() => "isBeforePick" in window)).toBe(false);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator(WELCOME)).toBeVisible();
  });
});
