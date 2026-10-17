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
