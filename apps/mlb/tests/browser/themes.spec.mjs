import { test, expect } from "./harness.mjs";
import { VIEW_GROUPS, checkEachView, openWithEverything } from "./views.mjs";
import { listChipsOffLook, listShownChipLooks } from "../../../../tests/browser/chip-looks.mjs";
import {
  listLowContrastText,
  listLowContrastTextWithRowsPressed,
} from "../../../../tests/browser/contrast.mjs";
import { listThemeLayoutChanges, showTheme } from "../../../../tests/browser/theme-layout.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const SCREENS = {
  "a phone": { width: 390, height: 844 },
  "a wide screen": { width: 1280, height: 900 },
};

for (const [screen, viewport] of Object.entries(SCREENS)) {
  for (const [group, views] of Object.entries(VIEW_GROUPS)) {
    test(`on ${screen}, ${group} lay out the same in Night Game as in Ball, which change only colors`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openWithEverything(page);
      await checkEachView(page, views, async (view) => {
        expect(await listThemeLayoutChanges(page), view.name).toEqual([]);
      });
    });

    test(`on ${screen}, the text of ${group} stands out from what's behind it as WCAG's AA level asks, in Ball and Night Game`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openWithEverything(page);
      await checkEachView(page, views, async (view) => {
        for (const theme of /** @type {const} */ (["light", "dark"])) {
          await showTheme(page, theme);
          expect(await listLowContrastText(page), `${view.name} in ${theme}`).toEqual([]);
        }
        await showTheme(page, "light");
      });
    });
  }
}

for (const [group, views] of Object.entries(VIEW_GROUPS)) {
  test(`in ${group}, each row's text stays as readable as AA asks with the row pressed, in Ball and Night Game`, async ({
    page,
  }) => {
    await page.setViewportSize(SCREENS["a phone"]);
    await openWithEverything(page);
    await checkEachView(page, views, async (view) => {
      expect(await listLowContrastTextWithRowsPressed(page), view.name).toEqual([]);
    });
  });
}

const CHIP_LOOKS = {
  "the page's tabs": ["filled", "outlined"],
  "a game's sheets": [],
  "a club's and a player's sheets": ["filled", "outlined"],
};

for (const [group, views] of Object.entries(VIEW_GROUPS)) {
  test(`in ${group}, each chip has its look's room beside its words and border, in Ball and Night Game`, async ({
    page,
  }) => {
    await page.setViewportSize(SCREENS["a phone"]);
    await openWithEverything(page);
    const looks = new Set();
    await checkEachView(page, views, async (view) => {
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        await showTheme(page, theme);
        expect(await listChipsOffLook(page), `${view.name} in ${theme}`).toEqual([]);
      }
      await showTheme(page, "light");
      for (const look of await listShownChipLooks(page)) looks.add(look);
    });
    expect([...looks].sort()).toEqual(CHIP_LOOKS[group]);
  });
}
