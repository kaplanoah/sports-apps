import { test, expect, openApp } from "./harness.mjs";
import { checkEachView, openWithNews } from "./views.mjs";
import { listChipsOffLook, listShownChipLooks } from "../../../../tests/browser/chip-looks.mjs";
import {
  listLowContrastText,
  listLowContrastTextAsShown,
  listLowContrastTextWithRowsPressed,
  waitForSettledColors,
} from "../../../../tests/browser/contrast.mjs";
import { pressOn } from "../../../../tests/browser/press-looks.mjs";
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

test("in every view, each row's text stays as readable as AA asks with the row pressed, in Maple and Walnut", async ({
  page,
}) => {
  await page.setViewportSize(SCREENS["a phone"]);
  await openWithNews(page);
  await checkEachView(page, async (view) => {
    expect(await listLowContrastTextWithRowsPressed(page), view.name).toEqual([]);
  });
});

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

for (const [theme, colorScheme] of /** @type {const} */ ([
  ["Maple", "light"],
  ["Walnut", "dark"],
])) {
  test(`in ${theme}, a live game's clock stays readable on its row pressed`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27 });
      return season;
    });
    const row = page.locator('[data-game="1042600132"]');
    await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
    const open = row.locator(".game-open");
    await waitForSettledColors(page);

    await pressOn(page, open);

    await expect(open).toHaveClass(/is-row-press/);
    expect(await listLowContrastTextAsShown(page)).toEqual([]);
    await page.mouse.up();
  });
}
