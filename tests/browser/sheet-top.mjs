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
      [...element.querySelectorAll(".sheet-close, .sheet-back, .settings-back")].find(
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

/**
 * A settings panel's colors and where its top holds its title and its close or back button, to
 * check a page of settings against settings, whose band may hold more under its title.
 * @param {import("@playwright/test").Locator} dialog a `.settings-panel`
 */
export async function readSettingsTop(dialog) {
  const top = dialog.locator(".sheet-top");
  const colors = await top.evaluate((element) => ({
    panel: getComputedStyle(/** @type {Element} */ (element.closest("dialog"))).backgroundColor,
    band: getComputedStyle(element).backgroundColor,
    shadow: getComputedStyle(element).boxShadow,
  }));
  const { titleTop, buttonTop } = await readTopSpacing(top);
  return { ...colors, titleTop, buttonTop };
}
