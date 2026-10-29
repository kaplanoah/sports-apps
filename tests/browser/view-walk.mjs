import { expect } from "@playwright/test";

/** The group of each app's views that are its tabs, not a sheet or settings. */
export const TABS_GROUP = "the page's tabs";

/**
 * @typedef {{
 *   name: string,
 *   open: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   shown: (page: import("@playwright/test").Page) => import("@playwright/test").Locator,
 *   close?: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} View
 */

/**
 * Opens each view in turn, checks it once it's drawn, and closes it.
 * @param {import("@playwright/test").Page} page
 * @param {View[]} views
 * @param {(view: View) => Promise<void>} checkView
 */
export async function checkEachView(page, views, checkView) {
  for (const view of views) {
    await view.open(page);
    await expect(view.shown(page)).toBeVisible();
    // Past the tab bar's pill sliding to the tab, and any other motion, before the page is read.
    await page.clock.runFor(2000);
    await checkView(view);
    if (view.close) {
      await view.close(page);
      await expect(view.shown(page)).toBeHidden();
    }
  }
}
