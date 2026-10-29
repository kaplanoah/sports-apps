import { holdClock } from "./harness.mjs";
import { readRole } from "./type-roles.mjs";
import { SCREENS } from "./themes.mjs";
import { THEMES, showTheme } from "./theme-layout.mjs";

/**
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {{
 *   openApp: (page: import("@playwright/test").Page, options: { isWholeSeason: boolean }) => Promise<unknown>,
 *   today: string,
 *   font: string,
 *   size: number,
 *   weight: number,
 *   labelTracking: number,
 *   tomorrow?: { day: string, accessibleName: string, weight: number },
 * }} app
 */
export function testDateLabelTracking(test, expect, app) {
  for (const [screen, viewport] of Object.entries(SCREENS)) {
    test(`on ${screen}, only TODAY and the tomorrow sidebar label use tighter tracking in both themes`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await app.openApp(page, { isWholeSeason: true });
      await page.getByRole("tab", { name: "Games" }).click();
      const today = page.locator(`#seasonGames .day-strip > [data-day="${app.today}"]`);
      const word = today.locator(".cell-name");
      const ordinary = page.locator("#seasonGames .day-cell:not(.is-today) .cell-name").first();
      const month = page.locator("#seasonGames .cell-month").first();
      for (const theme of THEMES) {
        await showTheme(page, theme);
        const label = await readRole(page, "label");
        expect(label.spacing).toBeCloseTo(app.size * app.labelTracking, 6);
        await expect(word).toHaveCSS("letter-spacing", `${app.size * 0.02}px`);
        await expect(word).toHaveCSS("font-size", `${app.size}px`);
        await expect(word).toHaveCSS("font-weight", String(app.weight));
        expect(await word.evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
          app.font,
        );
        for (const other of [ordinary, month])
          await expect(other).toHaveCSS("letter-spacing", `${label.spacing}px`);
        await expect(today).toHaveAttribute("aria-current", "date");
        await expect(today).toHaveAccessibleName(/^Today \d+\s*, \w+, \w+$/);
        if (app.tomorrow) {
          const tomorrow = page.locator(
            `#seasonGames .listed-day[data-day="${app.tomorrow.day}"] .day-label`,
          );
          await expect(tomorrow).toHaveAccessibleName(app.tomorrow.accessibleName);
          await expect(tomorrow.locator(".day-name")).toHaveText("Tmrw");
          await expect(tomorrow.locator(".day-name")).toHaveCSS("letter-spacing", "0.26px");
          await expect(tomorrow.locator(".day-name")).toHaveCSS("font-size", `${app.size}px`);
          await expect(tomorrow.locator(".day-name")).toHaveCSS(
            "font-weight",
            String(app.tomorrow.weight),
          );
          expect(
            await tomorrow
              .locator(".day-name")
              .evaluate((element) => getComputedStyle(element).fontFamily),
          ).toContain(app.font);
          await expect(tomorrow.locator(".day-month")).toHaveCSS(
            "letter-spacing",
            `${label.spacing}px`,
          );
          await expect(page.locator("#seasonGames .day-name:not(.is-tomorrow)").first()).toHaveCSS(
            "letter-spacing",
            `${label.spacing}px`,
          );
        }
      }
      const before = await today.boundingBox();
      await ordinary.locator("..").click();
      await page.locator("#seasonGames .go-today").focus();
      await page.keyboard.press("Enter");
      await expect(today).toHaveClass(/is-chosen/);
      await expect(word).toHaveCSS("letter-spacing", `${app.size * 0.02}px`);
      expect(await today.boundingBox()).toEqual(before);
    });
  }

  test("TODAY keeps its tracking in the moving date copy and after the list settles", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(SCREENS["a phone"]);
    await app.openApp(page, { isWholeSeason: true });
    await page.getByRole("tab", { name: "Games" }).click();
    await page.clock.runFor(1000);
    await holdClock(page);
    const today = page.locator(`#seasonGames .day-strip > [data-day="${app.today}"]`);
    await page.locator("#seasonGames .day-list").evaluate((list, day) => {
      const current = /** @type {HTMLElement} */ (list.querySelector(`[data-day="${day}"]`));
      const before = /** @type {HTMLElement} */ (current.previousElementSibling);
      list.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      list.scrollTop = before.offsetTop - Number.parseFloat(getComputedStyle(list).paddingTop);
    }, app.today);
    await page.clock.runFor(100);
    const copy = page.locator("#seasonGames .strip-lens .day-cell.is-today .cell-name");
    await expect(copy).toHaveCount(1);
    await expect(copy).toHaveCSS("letter-spacing", `${app.size * 0.02}px`);
    await expect(today.locator(".cell-name")).toHaveCSS("letter-spacing", `${app.size * 0.02}px`);
    await expect(page.locator('#seasonGames [aria-current="date"]')).toHaveCount(1);
    await page.clock.runFor(1500);
    await expect(page.locator("#seasonGames .strip-lens")).toHaveCount(0);
    await page.locator("#seasonGames .go-today").click();
    await page.clock.runFor(1500);
    await expect(today).toHaveClass(/is-chosen/);
    await expect(today.locator(".cell-name")).toHaveCSS("letter-spacing", `${app.size * 0.02}px`);
  });
}
