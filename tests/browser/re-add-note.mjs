import { expect } from "@playwright/test";

export const IPHONE_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_AGENT =
  "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

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
    "Apple only sets icons when you add a site to your home screen. To update yours, re-add the site.",
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
  expect(noteBelowIcons).toBeGreaterThan(0);

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
