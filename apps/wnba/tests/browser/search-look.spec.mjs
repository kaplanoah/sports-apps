import { test, expect } from "./harness.mjs";
import {
  ON_A_PHONE,
  findInput,
  findRows,
  openSeasonGames,
  sendSearch,
  tapSearch,
} from "./search-page.mjs";
import { measureFieldFace } from "../../../../tests/browser/type-scale.mjs";

// How Search looks on a phone: where its field, examples, and rows sit, and how a row is drawn.

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

test("the field sets 16px, which an iPhone doesn't zoom into on a tap, and looks as big as the text at --size-read", async ({
  page,
}) => {
  await openSeasonGames(page);
  await expect(findInput(page)).toHaveCSS("font-size", "16px");
  const widths = await measureFieldFace(findInput(page), "--size-read");
  expect(widths.field).toBeCloseTo(widths.step, 0);
});

test("the examples sit 4.5px under the field, their words 1.5px right of where its text starts, their lines from 2px right of it to 1px short of its right edge", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();

  const place = await page.evaluate(() => {
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    const input = /** @type {Element} */ (document.querySelector("#gameSearch .search-input"));
    const row = /** @type {HTMLElement} */ (document.querySelector("#gameSearch .search-example"));
    const item = /** @type {Element} */ (row.parentElement);
    const line = getComputedStyle(item, "::after");
    const fieldBox = field.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const textStart = input.getBoundingClientRect().left;
    const style = getComputedStyle(row);
    return {
      gap: itemBox.top - fieldBox.bottom,
      words: itemBox.left + Number.parseFloat(style.paddingLeft) - textStart,
      lineLeft: itemBox.left + Number.parseFloat(line.left) - textStart,
      lineRight: fieldBox.right - (itemBox.right - Number.parseFloat(line.right)),
      lift: (Number.parseFloat(style.paddingBottom) - Number.parseFloat(style.paddingTop)) / 2,
    };
  });

  expect(place).toEqual({ gap: 4.5, words: 1.5, lineLeft: 2, lineRight: 1, lift: 1.5 });
});

test("a row's words sit 1.25px over its middle, as the examples' are raised", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");
  const words = findRows(page).first().locator(".search-words");

  await expect(words).toHaveCSS("padding-bottom", "2.5px");
  await expect(words).toHaveCSS("padding-top", "0px");
});

test("the field sits 10.5px under the header's line", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await expect(findInput(page)).toBeFocused();

  const space = await page.evaluate(() => {
    const header = /** @type {Element} */ (document.querySelector("header.top"));
    const field = /** @type {Element} */ (document.querySelector("#gameSearch .search-field"));
    return field.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });

  expect(space).toBeCloseTo(10.5, 1);
});

test("every row is 44px under its line, with no room between the suggestions and the pages under them", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Lib");

  await expect(page.locator("#gameSearch .search-suggestions")).toHaveCount(2);
  const rows = await page.locator("#gameSearch .search-suggestions li").evaluateAll((items) =>
    items.map((item) => {
      const { top, bottom } = item.getBoundingClientRect();
      return { top, bottom };
    }),
  );
  for (const [index, { top, bottom }] of rows.entries()) {
    expect(bottom - top).toBe(45);
    if (index > 0) expect(top).toBe(rows[index - 1].bottom);
  }
});

test("a place's row names the place it's in dimmed, then a dim caret 4px from the words each side, centered on them", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "dark mode");

  await expect(findRows(page)).toHaveAccessibleName("Settings, Appearance");
  const crumb = await findRows(page).evaluate((row) => {
    const box = (/** @type {Element} */ element) => element.getBoundingClientRect();
    const inkOf = (/** @type {string} */ selector) =>
      getComputedStyle(/** @type {Element} */ (row.querySelector(selector))).color;
    const placeIn = /** @type {Element} */ (row.querySelector(".search-place-in"));
    const caret = /** @type {Element} */ (row.querySelector(".search-crumb"));
    const range = document.createRange();
    range.selectNodeContents(/** @type {Node} */ (caret.nextSibling));
    return {
      dim: inkOf(".search-mark"),
      words: inkOf(".search-words"),
      placeIn: inkOf(".search-place-in"),
      caret: inkOf(".search-crumb"),
      width: box(caret).width,
      height: box(caret).height,
      before: box(caret).left - box(placeIn).right,
      after: range.getBoundingClientRect().left - box(caret).right,
      offCenter:
        box(caret).top + box(caret).height / 2 - (box(placeIn).top + box(placeIn).height / 2),
    };
  });
  expect(crumb.placeIn).toBe(crumb.dim);
  expect(crumb.caret).toBe(crumb.dim);
  expect(crumb.words).not.toBe(crumb.dim);
  expect(crumb).toMatchObject({ width: 12, height: 12 });
  expect(crumb.before).toBeCloseTo(4, 1);
  expect(crumb.after).toBeCloseTo(4, 1);
  expect(Math.abs(crumb.offCenter)).toBeLessThan(2);
});
