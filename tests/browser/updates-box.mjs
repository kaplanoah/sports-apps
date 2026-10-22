import { expect } from "@playwright/test";
import { waitForLoadToSettle } from "./at-rest.mjs";
import { findCenter } from "./season-scroll.mjs";

/**
 * Taps the Updates box's button named `name` where it shows, once the page has settled, as a
 * finger does, which on the season tab lands on its stand-in under it (rider-taps.js).
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function tapUpdatesButton(page, name) {
  const button = page.locator("#updates").getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  await waitForLoadToSettle(page);
  const { x, y } = findCenter(await button.boundingBox());
  await page.mouse.click(x, y);
}

/** @param {import("@playwright/test").Page} page */
export const dismissUpdatesBox = (page) => tapUpdatesButton(page, "Dismiss updates");

/**
 * Opens the Updates box `height` pixels tall over the page, as a full one stands, once the page has
 * drawn what the store sent, since a draw with nothing new to show closes the box.
 * @param {import("@playwright/test").Page} page
 * @param {number} height
 */
export async function showTallUpdatesBox(page, height) {
  await waitForLoadToSettle(page);
  const box = page.locator("#updates");
  await box.evaluate((element, pixels) => {
    element.removeAttribute("hidden");
    Object.assign(/** @type {HTMLElement} */ (element).style, {
      flex: "none",
      height: `${pixels}px`,
    });
  }, height);
  return box;
}
