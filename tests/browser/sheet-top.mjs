// Where a sheet's or settings' top holds what it shows, to compare one screen with another.

/**
 * How far under the top's edge its title and its close or back button sit, and the room under its
 * last line.
 * @param {import("@playwright/test").Locator} top a `.sheet-top`
 */
export const readTopSpacing = (top) =>
  top.evaluate((element) => {
    const band = element.getBoundingClientRect();
    const readTop = (/** @type {Element} */ part) => part.getBoundingClientRect().top - band.top;
    const button = /** @type {Element} */ (
      [...element.querySelectorAll(".sheet-close, .sheet-back")].find(
        (candidate) => getComputedStyle(candidate).display !== "none",
      )
    );
    const last = /** @type {Element} */ (element.lastElementChild);
    return {
      titleTop: readTop(/** @type {Element} */ (element.querySelector(".sheet-head h2"))),
      buttonTop: readTop(button),
      roomBelow: band.bottom - last.getBoundingClientRect().bottom,
    };
  });
