import { expect } from "@playwright/test";
import { ANDROID_AGENT, IPHONE_AGENT } from "./devices.mjs";

const markOnHomeScreen = () => {
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

/**
 * Picks the dark look in Settings on an iPhone's Home Screen app and checks the note under the
 * icons says how to update the icon, with a link that opens Safari on that look, then checks
 * neither the browser nor an Android Home Screen app shows the note.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   context: import("@playwright/test").BrowserContext,
 *   browser: import("@playwright/test").Browser,
 *   openApp: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   looks: { light: string, dark: string },
 * }} app
 */
export async function checkReAddNote({ page, context, browser, openApp, openSettings, looks }) {
  await page.addInitScript(markOnHomeScreen);
  await openApp(page);
  await openSettings(page);
  const note = page.locator("#appearanceNote");
  await expect(note).toBeHidden();
  await page.getByRole("radio", { name: looks.dark }).check();
  await expect(note).toHaveText(
    "Apple only sets icons when you add a site to your home screen. To update your icon, re-add the site",
  );
  const safariAddress = new URL(page.url());
  safariAddress.searchParams.set("app-theme", "dark");
  await expect(note.getByRole("link", { name: "re-add the site" })).toHaveAttribute(
    "href",
    `x-safari-${safariAddress.href}`,
  );
  const noteBelowIcons = await page.evaluate(
    () =>
      document.querySelector("#appearanceNote").getBoundingClientRect().top -
      document.querySelector("#settingsDialog .appearance-choices").getBoundingClientRect().bottom,
  );
  // The row's 14px gap, less the 3px the note's tall lines and the names over it add.
  expect(noteBelowIcons).toBe(11);

  const browserTab = await context.newPage();
  await openApp(browserTab);
  await openSettings(browserTab);
  await browserTab.getByRole("radio", { name: looks.light }).check();
  await expect(browserTab.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(browserTab.locator("#appearanceNote")).toBeHidden();

  const android = await browser.newContext({ userAgent: ANDROID_AGENT, reducedMotion: "reduce" });
  const androidApp = await android.newPage();
  await androidApp.addInitScript(markOnHomeScreen);
  await openApp(androidApp);
  await openSettings(androidApp);
  await androidApp.getByRole("radio", { name: looks.dark }).check();
  await expect(androidApp.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(androidApp.locator("#appearanceNote")).toBeHidden();
  await android.close();
}

/**
 * Signs in to an iPhone's Home Screen app behind its access code, picks the dark look, and opens
 * the note's link in a browser that has never been signed in, as Safari is, which opens the
 * welcome on that look without asking for the code, with no token left in its address.
 * @param {{
 *   page: import("@playwright/test").Page,
 *   browser: import("@playwright/test").Browser,
 *   serveLockedApp: (page: import("@playwright/test").Page, options: { accessCode: string }) => Promise<unknown>,
 *   openSettings: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   looks: { light: string, dark: string },
 *   lockedPagePath: string,
 * }} app
 */
export async function checkReAddHandoff({
  page,
  browser,
  serveLockedApp,
  openSettings,
  looks,
  lockedPagePath,
}) {
  await page.addInitScript(markOnHomeScreen);
  await serveLockedApp(page, { accessCode: "FASTBREAK" });
  await page.goto(lockedPagePath);
  await page.getByRole("textbox", { name: "Access code" }).fill("FASTBREAK");
  await page.getByRole("button", { name: "Open" }).click();
  await openSettings(page);
  await page.getByRole("radio", { name: looks.dark }).check();
  const link = page.locator("#appearanceNote").getByRole("link", { name: "re-add the site" });
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(
      `^x-safari-http://[^/]+${lockedPagePath}access/handoff\\?token=[^&]+&app-theme=dark$`,
    ),
  );
  const safariAddress = (await link.getAttribute("href")).replace("x-safari-", "");

  const safari = await browser.newContext({
    userAgent: IPHONE_AGENT,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  const safariPage = await safari.newPage();
  await serveLockedApp(safariPage, { accessCode: "FASTBREAK" });
  await safariPage.goto(safariAddress);
  const redirected = new URL(safariPage.url());
  expect(`${redirected.pathname}${redirected.search}`).toBe(`${lockedPagePath}?app-theme=dark`);
  // Playwright routes only the first request of a redirect, so the page it leads to is opened
  // again through the Worker, with the cookie the redirect set.
  await safariPage.goto(redirected.href);
  await expect(safariPage.locator("#homeScreenWelcome")).toBeVisible();
  await expect(safariPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(safariPage.getByRole("textbox", { name: "Access code" })).toHaveCount(0);
  await safari.close();
}
