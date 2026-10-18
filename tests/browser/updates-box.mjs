import { waitForLoadToSettle } from "./at-rest.mjs";

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
