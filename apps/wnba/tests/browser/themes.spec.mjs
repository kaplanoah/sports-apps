import { test, expect } from "./harness.mjs";
import { checkEachView, openWithNews } from "./views.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listLayoutChanges, readLayout } from "../../../../tests/browser/theme-layout.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/**
 * @param {import("@playwright/test").Page} page
 * @param {"light" | "dark"} theme
 */
async function showTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // A link that eases its color on hover eases it into the new theme's too.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
}

/** @param {import("@playwright/test").Page} page */
async function listThemeLayoutChanges(page) {
  await showTheme(page, "light");
  const maple = await readLayout(page);
  await showTheme(page, "dark");
  const walnut = await readLayout(page);
  await showTheme(page, "light");
  return listLayoutChanges(maple, walnut);
}

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
