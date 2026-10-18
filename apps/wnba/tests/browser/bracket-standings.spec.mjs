import { test, expect, openApp } from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import {
  listFillFades,
  noteNameFades,
  readFilledNames,
} from "../../../../tests/browser/pill-names.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";
import {
  readSeasonPartScroll,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { findRows, sendSearch, tapSearch } from "./search-page.mjs";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/** @param {import("@playwright/test").Page} page */
const findPillNames = (page) => findSeasonPill(page).getByRole("tab");

/**
 * The season with its playoff field not yet set, and a way to set it again.
 * @param {ReturnType<typeof openApp> extends Promise<infer App> ? App : never} app
 */
async function unsetField(app) {
  /** @type {any[]} */
  let series = [];
  await app.changeSeason((season) => {
    series = season.series;
    return { ...season, series: [] };
  });
  return () => app.changeSeason((season) => ({ ...season, series }));
}

test("in the playoffs, the tab is named Bracket and opens on the bracket, first in its pill", async ({
  page,
}) => {
  await openApp(page);

  await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
  await expect(findPillNames(page)).toHaveText(["Bracket", "Standings"]);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("until the playoff field is set, the tab is named Standings and opens on them, first in its pill, and turns to Bracket once it's set", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();

  const setField = await unsetField(app);

  await expect(findSeasonTab(page)).toHaveAccessibleName("Standings");
  await expect(findPillNames(page)).toHaveText(["Standings", "Bracket"]);
  await expect(findPillNames(page).first()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#standings-league")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();

  await setField();

  await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
  await expect(findPillNames(page)).toHaveText(["Bracket", "Standings"]);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("a tap on the pill switches between the bracket and the standings, leaving the tab's name and the pill's order", async ({
  page,
}) => {
  await openApp(page);

  await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();

  await expect(page.locator("#standings-league")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();
  await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
  await expect(findPillNames(page)).toHaveText(["Bracket", "Standings"]);

  await findSeasonPill(page).getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("a tap on the tab while its part shows from its top slides back to the part it's named for: the bracket in the playoffs, and the standings before", async ({
  page,
}) => {
  const app = await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  expect(await readSeasonPartScroll(page, "standings")).toBe(0);

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
  await expect(findPillNames(page).first()).toHaveAttribute("aria-selected", "true");

  await unsetField(app);
  await expect(findSeasonTab(page)).toHaveAccessibleName("Standings");
  await openSeasonPart(page, "Bracket");
  await expect(page.locator("#bracketWrap")).toBeVisible();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(0);

  await findSeasonTab(page).click();

  await expect(page.locator("#standings-league")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();
  await expect(findPillNames(page).first()).toHaveAttribute("aria-selected", "true");
});

test("a tap on the tab while the standings show scrolled down takes them back to their top, and only the next tap slides back to the bracket", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await scrollSeasonPartToEnd(page, "standings");

  await findSeasonTab(page).click();

  await expect.poll(() => readSeasonPartScroll(page, "standings")).toBe(0);
  await expect(page.locator("#bracketStandingsPill")).not.toHaveClass(/\bstuck\b/);
  await expect(page.locator("#standings-league")).toBeVisible();

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("the header and the pill hold still while the standings scroll under the pill, which ends in its line once they're under it", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  const pill = page.locator("#bracketStandingsPill");
  const readTops = () =>
    page.evaluate(() => ({
      header: Math.round(document.querySelector("header").getBoundingClientRect().top),
      pill: Math.round(document.getElementById("bracketStandingsPill").getBoundingClientRect().top),
      page: Math.round(scrollY),
    }));
  const before = await readTops();
  await expect(pill).not.toHaveClass(/\bstuck\b/);

  await scrollSeasonPartToEnd(page, "standings");

  expect(await readTops()).toEqual(before);
});

test("each part keeps its own place: the bracket chosen far down the standings shows from its top, and the standings chosen again show where they were", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await scrollSeasonPartToEnd(page, "standings");
  const standingsScroll = await readSeasonPartScroll(page, "standings");
  expect(standingsScroll).toBeGreaterThan(0);
  const pill = findSeasonPill(page);

  await pill.getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator("#bracketWrap .round-name").first()).toBeInViewport();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(0);
  await expect(page.locator("#bracketStandingsPill")).not.toHaveClass(/\bstuck\b/);

  await pill.getByRole("tab", { name: "Standings" }).click();

  await expect(page.locator("#standings-league")).toBeVisible();
  expect(await readSeasonPartScroll(page, "standings")).toBe(standingsScroll);
  await expect(page.locator("#bracketStandingsPill")).toHaveClass(/\bstuck\b/);
});

test("search's Bracket row, with the bracket left scrolled down, opens it at its top, just under the pill", async ({
  page,
}) => {
  // A screen short enough for the bracket to scroll.
  await page.setViewportSize({ width: 390, height: 480 });
  await openApp(page);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await scrollSeasonPartToEnd(page, "bracket");
  await tapSearch(page);

  await sendSearch(page, "bracket");
  await findRows(page).filter({ hasText: "Bracket" }).first().tap();

  await expect(page.locator("#bracketWrap .round-name").first()).toBeInViewport();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(0);
  await expect(page.locator("#bracketStandingsPill")).not.toHaveClass(/\bstuck\b/);
});

test("the bracket's round names sit 10px under the pill's bar", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#bracketWrap .round-name").first()).toBeVisible();

  const room = await page.evaluate(
    () =>
      document.querySelector("#bracketWrap .round-name").getBoundingClientRect().top -
      document.getElementById("bracketStandingsPill").getBoundingClientRect().bottom,
  );

  expect(room).toBeCloseTo(10, 0);
});

test.describe("in full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a tap hands the pill's fill to the name tapped, the old name's fading out as the new one's fades in, eased alike", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
    const tabList = findSeasonPill(page);
    const readFades = await noteNameFades(tabList);

    await tabList.getByRole("tab", { name: "Standings" }).click();

    await expect(page.locator("#standings-league")).toBeVisible();
    await expect
      .poll(async () => listFillFades(await readFades()))
      .toEqual(["Bracket 0.18s 0s ease-in-out", "Standings 0.18s 0s ease-in-out"]);
    await expect.poll(() => readFilledNames(tabList)).toEqual(["Standings"]);
  });

  test("the tab's name and the pill's order change at once when the playoff field is set, rather than easing in", async ({
    page,
  }) => {
    const readAnimations = await listAnimations(page);
    const app = await openApp(page);
    await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
    const setField = await unsetField(app);
    await expect(findSeasonTab(page)).toHaveAccessibleName("Standings");

    await setField();

    await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
    const tabAnimations = (await readAnimations()).filter(({ element }) =>
      /\b(tab-face|tab-icon|tab-label|pager-bar|pager-tabs)\b/.test(element),
    );
    expect(tabAnimations).toEqual([]);
  });
});

test("with reduced motion, a tap moves the pill's fill at once, fading nothing", async ({
  page,
}) => {
  await openApp(page);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  const tabList = findSeasonPill(page);
  const readFades = await noteNameFades(tabList);

  await tabList.getByRole("tab", { name: "Standings" }).click();

  await expect(page.locator("#standings-league")).toBeVisible();
  expect(await readFilledNames(tabList)).toEqual(["Standings"]);
  expect(await readFades()).toEqual([]);
});
