import { test, expect, openApp } from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";
import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
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
  findCenter,
  findSeasonPart,
  findTouchTargets,
  holdHeaderStill,
  isPillBandShown,
  readHeaderReach,
  readPillHoldTop,
  readSeasonPartScroll,
  readSeasonRide,
  scrollSeasonPart,
  scrollSeasonPartToEnd,
  wheelPastSeasonPartEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { showTallUpdatesBox } from "../../../../tests/browser/updates-box.mjs";
import {
  leaveFractionDown,
  leavePageFractionDown,
  leavePagePixelDown,
  scrollPageToEnd,
} from "../../../../tests/browser/page-left-down.mjs";
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

test("once the playoff field is set while the standings show far down, the bracket comes in scrolled as far as the header then rode, rather than at its top", async ({
  page,
}) => {
  const app = await openApp(page);
  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await waitForLoadToSettle(page);
  const setField = await unsetField(app);
  await expect(page.locator("#standings-league")).toBeVisible();
  await scrollSeasonPartToEnd(page, "standings");
  const reach = await readHeaderReach(page);

  await setField();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(reach);
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
  await waitForLoadToSettle(page);
  await scrollSeasonPartToEnd(page, "standings");

  await findSeasonTab(page).click();

  await expect.poll(() => readSeasonPartScroll(page, "standings")).toBe(0);
  await expect(page.locator("#bracketStandingsPill")).not.toHaveClass(/\bstuck\b/);
  await expect(page.locator("#standings-league")).toBeVisible();

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("where the header stays put, a tap on the tab with the page scrolled under a tall Updates box takes the page back to its top, and only the next tap slides back to the bracket", async ({
  page,
}) => {
  await holdHeaderStill(page);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  await showTallUpdatesBox(page, 600);
  await scrollPageToEnd(page);

  await findSeasonTab(page).click();

  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("#standings-league")).toBeVisible();
  await expect(page.locator("#bracketWrap")).toBeHidden();

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("where the header stays put, a tap on the tab with the page under a tall Updates box left a fraction of a pixel down, as a phone can leave it, slides back to the bracket", async ({
  page,
}) => {
  await holdHeaderStill(page);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  await showTallUpdatesBox(page, 600);
  await leavePageFractionDown(page);

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("where the header rides, a tap on the tab with the page a pixel down from its top, as a phone can leave it, still slides back to the bracket", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  await waitForLoadToSettle(page);
  expect(await leavePagePixelDown(page)).toBe(1);

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("a tap on the tab with the standings left a fraction of a pixel down, as a phone can leave them, slides back to the bracket", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  await waitForLoadToSettle(page);
  await leaveFractionDown(findSeasonPart(page, "standings"));

  await findSeasonTab(page).click();

  await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
  await expect(page.locator("#standingsWrap")).toBeHidden();
});

test("the header and the pill ride up as far as the standings scroll, the page holding still", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const pill = page.locator("#bracketStandingsPill");
  const before = await readSeasonRide(page);

  await scrollSeasonPart(page, "standings", 40);

  await expect
    .poll(() => readSeasonRide(page))
    .toEqual({ ...before, headerTop: before.headerTop - 40, pillTop: before.pillTop - 40 });
  await expect(pill).not.toHaveClass(/\bstuck\b/);
});

test("once the header is gone, the pill holds at the top and ends in its line as the standings scroll under it, even past their end", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const header = page.locator("header.top");
  const pill = page.locator("#bracketStandingsPill");

  await scrollSeasonPartToEnd(page, "standings");
  await page.mouse.move(195, 500);

  expect(await wheelPastSeasonPartEnd(page, "standings")).toBe(0);
  expect(await readSeasonRide(page)).toMatchObject({
    pillTop: await readPillHoldTop(page),
    pageScroll: 0,
  });
  const headerBox = await header.boundingBox();
  expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(await readPillHoldTop(page));
  await expect(pill).toHaveClass(/\bstuck\b/);
  expect(await pill.evaluate((bar) => getComputedStyle(bar, "::before").visibility)).toBe(
    "visible",
  );
});

test("with the header just gone, the band above the pill covers it, and the pill ends in its line only once a row scrolls under it", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const pill = page.locator("#bracketStandingsPill");
  const reach = await readHeaderReach(page);

  await scrollSeasonPart(page, "standings", reach - 1);

  expect(await isPillBandShown(page)).toBe(false);

  await scrollSeasonPart(page, "standings", reach);

  await expect
    .poll(() => readSeasonRide(page))
    .toMatchObject({ pillTop: await readPillHoldTop(page) });
  await expect(pill).not.toHaveClass(/\bstuck\b/);
  expect(await isPillBandShown(page)).toBe(true);

  await scrollSeasonPart(page, "standings", reach + 1);

  await expect(pill).toHaveClass(/\bstuck\b/);
});

test("over a header of a fractional height, the header rides whole pixels, holding the pill no lower than its band reaches", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const view = page.locator("#view-bracket-standings");
  /** @returns {Promise<string>} */
  const readPartsTop = () =>
    view.evaluate((element) => element.style.getPropertyValue("--parts-top"));
  const partsTop = await readPartsTop();

  const holdTop = await readPillHoldTop(page);

  // The header grows so its ride ends 0.3px past a whole pixel, which rounding to the nearest drops.
  await page.evaluate((heldAt) => {
    const header = /** @type {HTMLElement} */ (document.querySelector("header.top"));
    const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
    const ride = pill.getBoundingClientRect().top - heldAt;
    const height = header.getBoundingClientRect().height;
    Object.assign(header.style, {
      boxSizing: "border-box",
      height: `${height + 1.3 - (ride % 1)}px`,
    });
  }, holdTop);

  await expect.poll(readPartsTop).not.toBe(partsTop);
  const reach = await readHeaderReach(page);
  expect(Number.isInteger(reach)).toBe(true);

  await scrollSeasonPart(page, "standings", reach);

  expect(await readSeasonRide(page)).toMatchObject({ pillTop: holdTop });
});

test("the standings' last row ends above the tab bar once they're scrolled to their end", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await expect(page.locator("#standings-league")).toBeVisible();
  await waitForLoadToSettle(page);

  await scrollSeasonPartToEnd(page, "standings");

  const lastRow = await page.locator("#standingsWrap tbody tr").last().boundingBox();
  const tabBar = await page.locator("#tabBar").boundingBox();
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(tabBar.y);
});

test("each part keeps its own place: the bracket chosen far down the standings shows from its top with the header still gone, and the standings chosen again show where they were", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  await scrollSeasonPartToEnd(page, "standings");
  const standingsScroll = await readSeasonPartScroll(page, "standings");
  const reach = await readHeaderReach(page);
  expect(standingsScroll).toBeGreaterThan(reach);
  const pill = findSeasonPill(page);

  await pill.getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator("#bracketWrap .round-name").first()).toBeInViewport();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(reach);
  await expect
    .poll(() => readSeasonRide(page))
    .toMatchObject({ pillTop: await readPillHoldTop(page) });
  await expect(page.locator("#bracketStandingsPill")).not.toHaveClass(/\bstuck\b/);
  expect(await isPillBandShown(page)).toBe(true);

  await pill.getByRole("tab", { name: "Standings" }).click();

  await expect(page.locator("#standings-league")).toBeVisible();
  expect(await readSeasonPartScroll(page, "standings")).toBe(standingsScroll);
  await expect(page.locator("#bracketStandingsPill")).toHaveClass(/\bstuck\b/);
});

test("the pill gives up its line once what's above it grows past where the standings sit still", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const pill = page.locator("#bracketStandingsPill");
  await scrollSeasonPart(page, "standings", (await readHeaderReach(page)) + 20);
  await expect(pill).toHaveClass(/\bstuck\b/);

  await showTallUpdatesBox(page, 100);

  await expect(pill).not.toHaveClass(/\bstuck\b/);
});

test("with the header still partly showing, the bracket chosen shows scrolled as far as the standings, so the header stays where it is", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const before = await readSeasonRide(page);
  await scrollSeasonPart(page, "standings", 40);
  await expect.poll(() => readSeasonRide(page)).toMatchObject({ pillTop: before.pillTop - 40 });

  await findSeasonPill(page).getByRole("tab", { name: "Bracket" }).click();

  await expect(page.locator("#bracketWrap .round-name").first()).toBeInViewport();
  expect(await readSeasonPartScroll(page, "bracket")).toBe(40);
  expect(await readSeasonRide(page)).toMatchObject({
    headerTop: before.headerTop - 40,
    pillTop: before.pillTop - 40,
  });
});

test("a touch on the header lands on the part under it, so a drag there scrolls it, while the header's button still takes its tap", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const header = await page.locator("header.top").boundingBox();

  const found = await findTouchTargets(page, {
    onHeader: { x: header.x + 40, y: header.y + header.height / 2 },
    onSettings: findCenter(await page.locator("#settingsBtn").boundingBox()),
  });

  expect(found).toEqual({ onHeader: "standings", onSettings: "settingsBtn" });
});

test("a touch on the pill's bar beside its names lands on the part under it, while each name still takes its tap", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const bar = await page.locator("#bracketStandingsPill").boundingBox();
  const names = await findSeasonPill(page).boundingBox();
  const bracketName = findPillNames(page).filter({ hasText: "Bracket" });

  const found = await findTouchTargets(page, {
    besideNames: { x: names.x + names.width + 8, y: bar.y + bar.height / 2 },
    onName: findCenter(await bracketName.boundingBox()),
  });

  expect(found).toEqual({ besideNames: "standings", onName: "bracketStandingsTab-bracket" });
});

test("where the browser has no scroll-driven animations, the header stays put and the parts scroll under the pill", async ({
  page,
}) => {
  await holdHeaderStill(page);
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await waitForLoadToSettle(page);
  const before = await readSeasonRide(page);

  await scrollSeasonPartToEnd(page, "standings");

  expect(await readSeasonRide(page)).toEqual(before);
  const pillBottom = await page.evaluate(
    () => document.getElementById("bracketStandingsPill").getBoundingClientRect().bottom,
  );
  const partTop = await findSeasonPart(page, "standings").evaluate(
    (part) => part.getBoundingClientRect().top,
  );
  expect(partTop).toBeCloseTo(pillBottom, 0);
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

  test("a tap that turns a slide back before it rests leaves the part it brings back where it is", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await expect(page.locator("#standings-league")).toBeVisible();
    await waitForLoadToSettle(page);
    await scrollSeasonPart(page, "standings", 40);

    await findSeasonPart(page, "standings").evaluate((standings) => {
      const pill = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsPill"));
      /** @type {HTMLElement} */ (pill.querySelector('[data-tab="bracket"]')).click();
      standings.scrollTop = 60;
      /** @type {HTMLElement} */ (pill.querySelector('[data-tab="standings"]')).click();
    });

    await expect(page.locator("#bracketStandingsParts")).not.toHaveAttribute("data-sliding");
    expect(await readSeasonPartScroll(page, "standings")).toBe(60);
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
    const tabParts = ["tab-face", "tab-icon", "tab-label", "pager-bar", "pager-tabs"];
    const tabAnimations = (await readAnimations()).filter(({ classes }) =>
      classes.some((name) => tabParts.includes(name)),
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
