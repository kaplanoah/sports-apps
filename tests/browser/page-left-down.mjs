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
 * Has `scroller` report itself a third of a pixel down, as a phone can leave it, since Chromium
 * keeps a scroll at whole pixels. A scroll still moves it.
 * @param {import("@playwright/test").Locator} scroller
 */
export const leaveFractionDown = (scroller) =>
  scroller.evaluate((element) => {
    const scrollTop = /** @type {PropertyDescriptor} */ (
      Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")
    );
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get: () => 1 / 3,
      set(top) {
        scrollTop.set?.call(element, top);
      },
    });
  });

/**
 * Has the page report itself a third of a pixel down, as a phone can leave it, both as its own
 * scroll and as the window's.
 * @param {import("@playwright/test").Page} page
 */
export async function leavePageFractionDown(page) {
  await leaveFractionDown(page.locator(":root"));
  await setPageScroll(page, 1 / 3);
}

/**
 * Has the window report itself `top` pixels down, without moving it or telling the page.
 * @param {import("@playwright/test").Page} page
 * @param {number} top
 */
export async function setPageScroll(page, top) {
  await page.evaluate(
    (scrollY) =>
      Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY }),
    top,
  );
}

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
