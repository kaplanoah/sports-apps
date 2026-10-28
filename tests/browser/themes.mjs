import { checkEachView } from "./view-walk.mjs";
import { listChipsOffLook, listShownChipLooks } from "./chip-looks.mjs";
import { listLowContrastTextInEachTheme } from "./contrast.mjs";
import { SETTINGS } from "./settings.mjs";
import { THEMES, listThemeLayoutChanges, showTheme } from "./theme-layout.mjs";

// How every view of every app's page looks in each of its themes, which change only colors.

/** @typedef {import("./view-walk.mjs").View} View */

/**
 * @typedef {{
 *   openWithEverything: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   viewGroups: Record<string, View[]>,
 *   chipLooks: Record<string, string[]>,
 *   themeNames: Record<(typeof THEMES)[number], string>,
 * }} App
 */

const SCREENS = {
  "a phone": { width: 390, height: 844 },
  "a wide screen": { width: 1280, height: 900 },
};

/**
 * Every tab, sheet, and settings the page holds, and those of them it shows, each tab named by its
 * id and only while it's chosen.
 * @param {import("@playwright/test").Page} page
 */
const readPlaces = (page) =>
  page.evaluate((settings) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const sheets = [...document.querySelectorAll(".sheet-page")];
    const settingsSheet = document.querySelector(settings);
    const isChosen = (/** @type {Element} */ tab) =>
      tab.getAttribute("aria-selected") === "true" && tab.checkVisibility();
    return {
      held: [
        ...tabs.map((tab) => `the tab ${tab.id}`),
        ...sheets.map((sheet) => `the sheet ${sheet.id}`),
        ...(settingsSheet ? ["settings"] : []),
      ],
      shown: [
        ...tabs.filter(isChosen).map((tab) => `the tab ${tab.id}`),
        ...sheets
          .filter((sheet) => sheet.checkVisibility())
          .map((sheet) => `the sheet ${sheet.id}`),
        ...(settingsSheet?.checkVisibility() ? ["settings"] : []),
      ],
    };
  }, SETTINGS);

/**
 * @param {import("@playwright/test").TestType<any, any>} test
 * @param {import("@playwright/test").Expect<any>} expect
 * @param {App} app
 */
export function testThemes(test, expect, app) {
  test.use({ contextOptions: { reducedMotion: "reduce" } });
  const { light, dark } = app.themeNames;

  for (const [screen, viewport] of Object.entries(SCREENS)) {
    for (const [group, views] of Object.entries(app.viewGroups)) {
      test(`on ${screen}, ${group} lay out the same in ${dark} as in ${light}, which change only colors`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await app.openWithEverything(page);
        await checkEachView(page, views, async (view) => {
          expect(await listThemeLayoutChanges(page), view.name).toEqual([]);
        });
      });

      test(`on ${screen}, the text of ${group} stands out from what's behind it as WCAG's AA level asks, in ${light} and ${dark}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await app.openWithEverything(page);
        await checkEachView(page, views, async (view) => {
          expect(await listLowContrastTextInEachTheme(page), view.name).toEqual([]);
        });
      });
    }
  }

  for (const [group, views] of Object.entries(app.viewGroups)) {
    test(`in ${group}, each chip has its look's room beside its words and border, in ${light} and ${dark}`, async ({
      page,
    }) => {
      await page.setViewportSize(SCREENS["a phone"]);
      await app.openWithEverything(page);
      const looks = new Set();
      await checkEachView(page, views, async (view) => {
        for (const theme of THEMES) {
          await showTheme(page, theme);
          expect(await listChipsOffLook(page), `${view.name} in ${theme}`).toEqual([]);
        }
        await showTheme(page, "light");
        for (const look of await listShownChipLooks(page)) looks.add(look);
      });
      expect([...looks].sort()).toEqual(app.chipLooks[group]);
    });
  }

  test("the views show every tab and sheet the page has, and settings", async ({ page }) => {
    test.slow();
    await page.setViewportSize(SCREENS["a phone"]);
    await app.openWithEverything(page);
    const held = new Set();
    const shown = new Set();
    await checkEachView(page, Object.values(app.viewGroups).flat(), async () => {
      const places = await readPlaces(page);
      for (const place of places.held) held.add(place);
      for (const place of places.shown) shown.add(place);
    });
    expect([...held].filter((place) => !shown.has(place))).toEqual([]);
  });
}
