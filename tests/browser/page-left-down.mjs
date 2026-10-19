import { expect } from "@playwright/test";

/**
 * Leaves the page a pixel from its top, as a drag on a phone's header can on a view that scrolls in
 * itself, since a phone's page is a pixel taller than its screen, and says where the page is.
 * @param {import("@playwright/test").Page} page
 */
export const leavePagePixelDown = (page) =>
  page.evaluate(() => {
    scrollTo({ top: 1, behavior: "instant" });
    return scrollY;
  });

/**
 * Scrolls the page to its end, as a thumb does past a tall box over a view, and checks it went
 * further than the pixel a phone can leave it down.
 * @param {import("@playwright/test").Page} page
 */
export async function scrollPageToEnd(page) {
  const top = await page.evaluate(() => {
    scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    return scrollY;
  });
  expect(top).toBeGreaterThan(1);
}
