import { waitForLoadToSettle } from "./at-rest.mjs";

/**
 * Taps the Updates box's dismiss button where it shows, as a finger does, which on the season tab
 * lands on its stand-in under it (rider-taps.js).
 * @param {import("@playwright/test").Page} page
 */
export async function dismissUpdatesBox(page) {
  const box = await page.getByRole("button", { name: "Dismiss updates" }).boundingBox();
  if (!box) throw new Error("The Updates box shows no dismiss button");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

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
