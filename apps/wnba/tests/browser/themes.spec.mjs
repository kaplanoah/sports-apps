import { test, expect } from "./harness.mjs";
import { checkEachView, openWithNews } from "./views.mjs";
import { listChipsOffLook, listShownChipLooks } from "../../../../tests/browser/chip-looks.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listThemeLayoutChanges, showTheme } from "../../../../tests/browser/theme-layout.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const SCREENS = {
  "a phone": { width: 390, height: 844 },
  "a wide screen": { width: 1280, height: 900 },
};

for (const [screen, viewport] of Object.entries(SCREENS)) {
  test(`on ${screen}, every view lays out the same in Walnut as in Maple, which change only colors`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openWithNews(page);
    await checkEachView(page, async (view) => {
      expect(await listThemeLayoutChanges(page), view.name).toEqual([]);
    });
  });

  test(`on ${screen}, every view's text stands out from what's behind it as WCAG's AA level asks, in Maple and Walnut`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openWithNews(page);
    await checkEachView(page, async (view) => {
      for (const theme of /** @type {const} */ (["light", "dark"])) {
        await showTheme(page, theme);
        expect(await listLowContrastText(page), `${view.name} in ${theme}`).toEqual([]);
      }
      await showTheme(page, "light");
    });
  });
}

test("in every view, each chip has its look's room beside its words and border, in Maple and Walnut", async ({
  page,
}) => {
  await page.setViewportSize(SCREENS["a phone"]);
  await openWithNews(page);
  const looks = new Set();
  await checkEachView(page, async (view) => {
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      await showTheme(page, theme);
      expect(await listChipsOffLook(page), `${view.name} in ${theme}`).toEqual([]);
    }
    await showTheme(page, "light");
    for (const look of await listShownChipLooks(page)) looks.add(look);
  });
  expect([...looks].sort()).toEqual(["filled", "outlined"]);
});
