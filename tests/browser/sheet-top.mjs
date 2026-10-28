// Where a sheet's or settings' top holds what it shows, to compare one screen with another.

import { openSettings, SETTINGS } from "./settings.mjs";

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
 * A settings panel's colors and where its top holds its title and its close or back button, down
 * and across, to check a page of settings against settings, whose band may hold more under its
 * title.
 * @param {import("@playwright/test").Locator} dialog a `.settings-panel`
 */
async function readSettingsTop(dialog) {
  const top = dialog.locator(".sheet-top");
  const looks = await top.evaluate((element) => {
    const panel = /** @type {Element} */ (element.closest("dialog"));
    const button = /** @type {Element} */ (
      [...element.querySelectorAll(".sheet-close, .settings-back")].find(
        (candidate) => getComputedStyle(candidate).display !== "none",
      )
    );
    return {
      panel: getComputedStyle(panel).backgroundColor,
      band: getComputedStyle(element).backgroundColor,
      shadow: getComputedStyle(element).boxShadow,
      buttonLeft: button.getBoundingClientRect().left - panel.getBoundingClientRect().left,
    };
  });
  const { titleTop, buttonTop } = await readTopSpacing(top);
  return { ...looks, titleTop, buttonTop };
}

/**
 * @param {any} test
 * @param {any} expect
 * @param {{ openApp: (page: import("@playwright/test").Page) => Promise<unknown>, settingsPages: string[] }} options
 */
export function testSettingsPageTops(test, expect, { openApp, settingsPages }) {
  test("every page of settings has settings' own top, its colors, its title, and its back arrow where settings' close button is", async ({
    page,
  }) => {
    await openApp(page);
    await openSettings(page);
    const settings = page.locator(SETTINGS);
    const settingsTop = await readSettingsTop(settings);

    for (const name of settingsPages) {
      await settings.locator(`#${name.toLowerCase()}Btn`).click();
      const dialog = page.locator(`#${name.toLowerCase()}Dialog`);
      await expect(dialog.locator(".settings-back")).toBeVisible();
      expect(await readSettingsTop(dialog), name).toEqual(settingsTop);
      await dialog.locator(".settings-back").click();
      await expect(dialog).toBeHidden();
    }
  });
}
