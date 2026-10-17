/**
 * Has the page leave the screen, or come back, as a phone's switch to another app does.
 * @param {import("@playwright/test").Page} page
 * @param {boolean} hidden
 */
export const setHidden = (page, hidden) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

/**
 * Moves the page's clock on by `ms` without running its timers, as a phone that suspends it does.
 * @param {import("@playwright/test").Page} page
 * @param {number} ms
 */
export const passTime = async (page, ms) =>
  page.clock.setSystemTime((await page.evaluate(() => Date.now())) + ms);

/**
 * Has the page come back to the screen and says whether `selector`'s dialog is open in the same
 * moment, before the browser can draw.
 * @param {import("@playwright/test").Page} page
 * @param {string} selector
 */
export const comeBackTo = (page, selector) =>
  page.evaluate((dialogSelector) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    return /** @type {HTMLDialogElement} */ (document.querySelector(dialogSelector)).open;
  }, selector);
