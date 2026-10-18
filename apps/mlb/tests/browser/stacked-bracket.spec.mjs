import {
  test,
  expect,
  openBracket,
  buildFixtureSnapshot,
  chooseSeason,
  EVENING_FIXTURE,
  SEASON_2025,
} from "./harness.mjs";
import { LAPTOP, PHONE, WIDE_SCREEN } from "./screen-sizes.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";
import {
  expectDotsHeldWithBracket,
  readRoundDotsTop,
  trackRoundDots,
} from "../../../../tests/browser/round-dots.mjs";
import {
  expectPageHeldStill,
  readHeaderReach,
  readSeasonPartScroll,
  scrollSeasonPartToEnd,
  trackSeasonFrames,
} from "../../../../tests/browser/season-scroll.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

test("on a phone, the bracket's round dots sit just above the tab bar and follow its scroll", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page);
  const dots = page.locator("#bracketWrap .round-dots");
  await expect(dots.locator("[data-round]")).toHaveCount(4);
  await expect(dots.locator(".on")).toHaveCount(1);
  const dotsBox = await dots.boundingBox();
  const bar = await page.locator("#tabBar").boundingBox();
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeGreaterThan(0);
  expect(bar.y - (dotsBox.y + dotsBox.height)).toBeLessThanOrEqual(8);

  const scroller = page.locator("#bracketWrap .tree-scroll");
  await scroller.evaluate((tree) => tree.scrollTo({ left: 0, behavior: "instant" }));
  await expect(dots.locator('[data-round="WC"]')).toHaveClass("on");
  await scroller.evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
  await expect(dots.locator('[data-round="WS"]')).toHaveClass("on");
});

test.describe("in full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("on a phone, the round dots hold their height over the tab bar on every frame of a tap's slide to the standings and back, moving only sideways, with the bracket", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openBracket(page);
    const parts = page.locator("#bracketStandingsParts");
    await expect(parts).not.toHaveAttribute("data-sliding");
    await expect(page.locator("#bracketWrap .round-dots .on")).toHaveCount(1);
    const restingTop = await readRoundDotsTop(page);
    const pill = findSeasonPill(page);

    const readFramesOut = await trackRoundDots(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await expect(parts.locator('> [data-part="standings"]')).toBeVisible();
    expectDotsHeldWithBracket(await readFramesOut(), restingTop);

    const readFramesBack = await trackRoundDots(page);
    await pill.getByRole("tab", { name: "Bracket" }).click();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await expect(parts.locator('> [data-part="bracket"]')).toBeVisible();
    expectDotsHeldWithBracket(await readFramesBack(), restingTop);
  });

  test("on a phone, a tap that brings the bracket in from far down the standings moves only the parts, sideways, on every frame, and a tap back slides the standings in where they were", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openBracket(page);
    const parts = page.locator("#bracketStandingsParts");
    const pill = findSeasonPill(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await scrollSeasonPartToEnd(page, "standings");
    const standingsScroll = await readSeasonPartScroll(page, "standings");

    const readFramesOut = await trackSeasonFrames(page);
    await pill.getByRole("tab", { name: "Bracket" }).click();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await expect(parts.locator('> [data-part="bracket"]')).toBeVisible();
    expectPageHeldStill(await readFramesOut());

    const readFramesBack = await trackSeasonFrames(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expect(parts).not.toHaveAttribute("data-sliding");
    await expect(parts.locator('> [data-part="standings"]')).toBeVisible();
    expectPageHeldStill(await readFramesBack());
    expect(await readSeasonPartScroll(page, "standings")).toBe(standingsScroll);
  });
});

test("a stacked bracket that fits the screen's width has no round dots and nothing to scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openBracket(page);
  const scroller = page.locator("#bracketWrap .tree-scroll");
  const dots = page.locator("#bracketWrap .round-dots");
  const canScroll = () => scroller.evaluate((tree) => tree.scrollWidth > tree.clientWidth);
  await expect(scroller).toHaveClass(/stacked/);
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(dots).toHaveCount(1);
  expect(await canScroll()).toBe(true);

  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(dots).toHaveCount(0);
  expect(await canScroll()).toBe(false);
});

test("on a phone, the bracket stacks the AL above the NL, each running left to right into the World Series", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page);
  const bracket = page.locator("#bracketWrap");
  const findCard = (round) => bracket.locator(".box").filter({ hasText: round });
  const readLeft = async (round) => (await findCard(round).first().boundingBox()).x;

  const al = bracket.locator(".league-head.al");
  const nl = bracket.locator(".league-head.nl");
  await expect(al).toHaveText("American League");
  await expect(nl).toHaveText("National League");
  await expect(al).toHaveCSS("text-align", "left");
  const alTop = (await al.boundingBox()).y;
  const nlTop = (await nl.boundingBox()).y;
  expect(alTop).toBeLessThan(nlTop);

  const worldSeries = await bracket
    .locator(".box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(await readLeft("Wild Card")).toBeLessThan(await readLeft("Division Series"));
  expect(await readLeft("Division Series")).toBeLessThan(await readLeft("Championship Series"));
  expect(await readLeft("Championship Series")).toBeLessThan(worldSeries.x);

  const alcs = await findCard("Championship Series").nth(0).boundingBox();
  const nlcs = await findCard("Championship Series").nth(1).boundingBox();
  expect(alcs.y).toBeGreaterThan(alTop);
  expect(alcs.y).toBeLessThan(nlTop);
  expect(nlcs.y).toBeGreaterThan(nlTop);
  expect(worldSeries.y).toBeGreaterThan(alcs.y);
  expect(worldSeries.y).toBeLessThan(nlcs.y);
});

test("on a phone, the World Series card scrolls all the way to the middle of the screen", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page);
  const scroller = page.locator(".tree-scroll");
  await expect(scroller).toBeVisible();
  await scroller.evaluate(
    (element) =>
      new Promise((resolve) => {
        element.addEventListener("scrollend", resolve, { once: true });
        element.scrollLeft = element.scrollWidth;
      }),
  );

  const worldSeries = await page
    .locator("#bracketWrap .box")
    .filter({ has: page.locator(".world") })
    .boundingBox();
  expect(Math.abs(worldSeries.x + worldSeries.width / 2 - PHONE.width / 2)).toBeLessThan(2);
  expect((await readBracketFit(page)).pageOverflow).toBe(0);
});

test("on a phone, the bracket opens on the earliest round still playing, and swipes either way", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  const scroller = page.locator(".tree-scroll");
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);

  await chooseSeason(page, "2025");
  const worldSeries = page.locator('.box[data-round="WS"]');
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"]').first()).not.toBeInViewport();

  await scroller.evaluate((element) => (element.scrollLeft = 0));
  await expect(page.locator('.box[data-round="WC"]').first()).toBeInViewport();
  await expect(worldSeries).not.toBeInViewport();

  await page.getByRole("tab", { name: "Games" }).click();
  await openSeasonPart(page, "Bracket");
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
});

test("on a phone, a tap on the bracket's tab brings it back to the round still playing", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");
  const worldSeries = page.locator('.box[data-round="WS"]');
  await expect(worldSeries).toBeInViewport({ ratio: 1 });
  await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator(".tree-scroll").evaluate((element) => (element.scrollLeft = 0));
  await expect(worldSeries).not.toBeInViewport();

  await findSeasonTab(page).click();

  await expect(worldSeries).toBeInViewport({ ratio: 1 });
});

test("on a phone, a bracket opening on the Division Series keeps its byes' seed labels in view", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  const snapshot = buildFixtureSnapshot(EVENING_FIXTURE);
  for (const id of ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"])
    snapshot.series[id] = { winsA: 2, winsB: 0, started: true };
  await openBracket(page, { snapshots: { [EVENING_FIXTURE.season]: snapshot } });

  const division = page.locator('.box[data-round="DS"]').first();
  await expect(division.locator(".series")).toBeInViewport({ ratio: 1 });
  await expect(division.locator(".seed-label")).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.box[data-round="WC"] .series').first()).not.toBeInViewport({
    ratio: 1,
  });
});

test("on a small tablet, which the app treats as a phone, the bracket opens on the round still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openBracket(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  await chooseSeason(page, "2025");

  await expect(page.locator('.box[data-round="WS"]')).toBeInViewport({ ratio: 1 });
  expect(
    await page.locator(".tree-scroll").evaluate((scroller) => scroller.scrollLeft),
  ).toBeGreaterThan(0);
});

test("wider than a phone, the stacked bracket starts at the Wild Card with every seed in view, whatever round is still playing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await openBracket(page, {
    store: { "seasons/2025": SEASON_2025 },
  });
  const scroller = page.locator(".tree-scroll");
  const readScroll = () => scroller.evaluate((element) => element.scrollLeft);
  const expectSeedsInView = async () => {
    await expect(page.locator(".seed-label")).toHaveCount(12);
    for (const label of await page.locator(".seed-label").all())
      await expect(label).toBeInViewport();
  };
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);

  await chooseSeason(page, "2025");
  await expect(page.locator('.box[data-round="WS"]').filter({ hasText: "Dodgers" })).toHaveCount(1);
  await expectSeedsInView();
  expect(await readScroll()).toBe(0);
});

const readStackedSpaces = (page) =>
  page.evaluate(() => {
    const readBox = (element) => element.getBoundingClientRect();
    const pill = readBox(document.querySelector("#bracketStandingsPill"));
    const line = readBox(document.querySelector("#bracketWrap .league-head.al"));
    const [upperCard, lowerCard] = [...document.querySelectorAll("#bracketWrap .box")].map(readBox);
    return {
      aboveLeague: line.top - pill.bottom,
      belowLine: upperCard.top - line.bottom,
      betweenRows: lowerCard.top - upperCard.bottom - 22,
    };
  });

/**
 * The spaces inside the stacked bracket, which hold however far its part or the page is scrolled.
 * @param {import("@playwright/test").Page} page
 */
const readInnerSpaces = async (page) => {
  const { belowLine, betweenRows } = await readStackedSpaces(page);
  return { belowLine, betweenRows };
};

test("on a phone too short for the bracket, its spaces are at their tightest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  expect(await readStackedSpaces(page)).toEqual({
    aboveLeague: 0,
    belowLine: 5,
    betweenRows: 6,
  });
});

test("on a taller phone, every space in the bracket grows by the same factor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();

  const { aboveLeague, belowLine, betweenRows } = await readStackedSpaces(page);
  const growth = betweenRows / 13;
  expect(growth).toBeGreaterThan(1.5);
  expect(belowLine / 11).toBeCloseTo(growth, 0);
  expect(aboveLeague / 13).toBeCloseTo(growth - 1, 0);
});

const readCardTops = (page, round) =>
  page
    .locator("#bracketWrap .box")
    .filter({ hasText: round })
    .evaluateAll((boxes) => boxes.map((box) => box.getBoundingClientRect().top));

test("on a phone, each wild card card sits level with the division card it feeds", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page);
  await expect(page.locator("#bracketWrap .bracket-stage")).toBeVisible();

  const wildCardTops = await readCardTops(page, "Wild Card");
  const divisionTops = await readCardTops(page, "Division Series");

  expect(wildCardTops).toHaveLength(4);
  expect(wildCardTops.toSorted()).toEqual(divisionTops.toSorted());
});

test("on a phone, a league's name stays at the left while its line scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openBracket(page);
  const name = page.locator("#bracketWrap .league-head.al .league-name");
  await expect(name).toBeVisible();
  const restingLeft = (await name.boundingBox()).x;

  await page.locator(".tree-scroll").evaluate((scroller) => (scroller.scrollLeft = 300));

  await expect.poll(async () => (await name.boundingBox()).x).toBe(restingLeft);
});

test("narrowing the window until the whole bracket can't show switches to the stacked bracket", async ({
  page,
}) => {
  await page.setViewportSize(WIDE_SCREEN);
  await openBracket(page);
  const al = page.locator("#bracketWrap .league-head.al");
  const nl = page.locator("#bracketWrap .league-head.nl");
  await expect(al).toHaveCSS("text-align", "center");
  expect((await al.boundingBox()).y).toBe((await nl.boundingBox()).y);

  await page.setViewportSize(LAPTOP);

  await expect(al).toHaveCSS("text-align", "left");
  expect((await al.boundingBox()).y).toBeLessThan((await nl.boundingBox()).y);
});

/**
 * How far the stacked bracket ends above its part's bottom space, where the part's padding starts.
 * @param {import("@playwright/test").Page} page
 */
const readSpaceLeft = (page) =>
  page.evaluate(() => {
    const part = document.querySelector('#bracketStandingsParts > [data-part="bracket"]');
    const spaceBottom =
      part.getBoundingClientRect().bottom - parseFloat(getComputedStyle(part).paddingBottom);
    return spaceBottom - document.querySelector(".bracket-stage").getBoundingClientRect().bottom;
  });

/**
 * Whether the stacked bracket fills down to its part's bottom space, ending less than 8px short.
 * @param {import("@playwright/test").Page} page
 */
const isFilling = async (page) => {
  const spaceLeft = await readSpaceLeft(page);
  return spaceLeft >= 0 && spaceLeft < 8;
};

test("on a laptop too narrow for the whole bracket, the stacked bracket fills down to its part's bottom space", async ({
  page,
}) => {
  await page.setViewportSize(LAPTOP);
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head")).toHaveCount(2);

  expect(await isFilling(page)).toBe(true);
  expect(await readCardTops(page, "Wild Card")).toEqual(
    await readCardTops(page, "Division Series"),
  );
});

test("on a laptop where the header stays put, the stacked bracket keeps filling down to its part's bottom space when it redraws with the page scrolled under a tall box over it", async ({
  page,
}) => {
  // A screen tall enough for the bracket to fit under the box, which scrolls the page.
  await page.setViewportSize({ width: LAPTOP.width, height: 1200 });
  await page.addInitScript(() => Reflect.deleteProperty(window, "ScrollTimeline"));
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head")).toHaveCount(2);
  await page.locator("header").evaluate((header) => {
    const box = Object.assign(document.createElement("div"), {
      style: "flex: none; height: 400px",
    });
    header.after(box);
  });
  await expect.poll(() => isFilling(page)).toBe(true);
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.evaluate(() => dispatchEvent(new Event("resize")));

  expect(await isFilling(page)).toBe(true);
});

const readBracketFit = (page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".tree-scroll");
    const stage = document.querySelector(".bracket-stage").getBoundingClientRect();
    return {
      stageBottom: stage.bottom + scrollY,
      lowestNoteBottom: Math.max(
        ...[...document.querySelectorAll(".card-note")].map(
          (note) => note.getBoundingClientRect().bottom + scrollY,
        ),
      ),
      dotsTop: document.querySelector(".round-dots").getBoundingClientRect().top + scrollY,
      scrollLeft: scroller.scrollLeft,
      bracketOverflow: scroller.scrollWidth - scroller.clientWidth,
      pageOverflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
    };
  });

/**
 * Waits for the bracket to fill the height down to just above the round dots, with its lowest note
 * at its bottom, all from one redraw.
 * @param {import("@playwright/test").Page} page
 */
const expectBracketToFillHeight = (page) =>
  expect
    .poll(async () => {
      const { stageBottom, lowestNoteBottom, dotsTop } = await readBracketFit(page);
      return {
        reachesDots: dotsTop - stageBottom >= 8 && dotsTop - stageBottom < 18,
        endsAtNotes: stageBottom - lowestNoteBottom < 4,
      };
    })
    .toEqual({ reachesDots: true, endsAtNotes: true });

test("on a phone, the bracket fills the height above the tab bar and swipes sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openBracket(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { bracketOverflow, pageOverflow } = await readBracketFit(page);
  expect(bracketOverflow).toBeGreaterThan(0);
  expect(pageOverflow).toBe(0);
});

test("on a phone, the bracket fills the height above the tab bar again when what's above it grows or shrinks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openBracket(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);

  await page.locator("header").evaluate((header) => {
    const above = Object.assign(document.createElement("div"), {
      id: "roomAbove",
      style: "flex: none; height: 40px",
    });
    header.after(above);
  });

  await expectBracketToFillHeight(page);

  await page.locator("#roomAbove").evaluate((above) => above.remove());

  await expectBracketToFillHeight(page);
});

test("on a phone where the header stays put, the bracket fills the height again when a tall Updates box over it grows, holding the view at its least height", async ({
  page,
}) => {
  // A screen tall enough for the bracket to fit under the box, which leaves the view its least
  // height, most of the screen.
  await page.setViewportSize({ width: 390, height: 1450 });
  await page.addInitScript(() => Reflect.deleteProperty(window, "ScrollTimeline"));
  await openBracket(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  const updates = page.locator("#updates");
  await updates.evaluate((box) => {
    box.removeAttribute("hidden");
    Object.assign(/** @type {HTMLElement} */ (box).style, { flex: "none", height: "500px" });
  });
  await expectBracketToFillHeight(page);
  const view = page.locator("#view-bracket-standings");
  const readViewHeight = () => view.evaluate((element) => element.getBoundingClientRect().height);
  const viewHeight = await readViewHeight();

  await updates.evaluate((box) => (box.style.height = "520px"));

  await expectBracketToFillHeight(page);
  expect(await readViewHeight()).toBe(viewHeight);
});

test("on a phone, the bracket keeps its spaces when it redraws however far its part is scrolled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();
  const atTop = await readInnerSpaces(page);
  await page.locator("#bracketWrap").evaluate((wrap) => {
    const room = Object.assign(document.createElement("div"), { style: "height: 2000px" });
    wrap.after(room);
  });
  await scrollSeasonPartToEnd(page, "bracket");

  await page.evaluate(() => dispatchEvent(new Event("resize")));

  expect(await readInnerSpaces(page)).toEqual(atTop);
});

test("on a phone where the header stays put, the bracket keeps its spaces when it redraws with the page scrolled under a tall box over it, as a full Updates box leaves it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1400 });
  await page.addInitScript(() => Reflect.deleteProperty(window, "ScrollTimeline"));
  await openBracket(page);
  await expect(page.locator("#bracketWrap .league-head.al")).toBeVisible();
  await page.locator("header").evaluate((header) => {
    const box = Object.assign(document.createElement("div"), {
      style: "flex: none; height: 590px",
    });
    header.after(box);
  });
  await expect
    .poll(async () => (await readBracketFit(page)).stageBottom)
    .toBeLessThan(await page.evaluate(() => innerHeight + scrollY));
  const atTop = await readInnerSpaces(page);
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);

  await page.evaluate(() => dispatchEvent(new Event("resize")));

  expect(await readInnerSpaces(page)).toEqual(atTop);
});

test("on a phone a little short of room, the bracket's spaces shrink so it fits above the round dots, its part scrolling only as far as the header rides", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 830 });
  await openBracket(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
  const { belowLine, betweenRows } = await readStackedSpaces(page);
  expect(belowLine).toBeLessThan(11);
  expect(betweenRows).toBeLessThan(13);
  expect(
    await page
      .locator('#bracketStandingsParts > [data-part="bracket"]')
      .evaluate((part) => part.scrollHeight - part.clientHeight),
  ).toBeLessThanOrEqual((await readHeaderReach(page)) + 1);
});

test("on a phone, the bracket redraws for a new screen height and keeps its sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await openBracket(page);
  await expect(page.locator(".bracket-stage")).toBeVisible();
  await page.locator(".tree-scroll").evaluate(
    (scroller) =>
      new Promise((resolve) => {
        scroller.addEventListener("scrollend", resolve, { once: true });
        scroller.scrollLeft = 300;
      }),
  );
  const { scrollLeft } = await readBracketFit(page);
  expect(scrollLeft).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 900 });

  await expectBracketToFillHeight(page);
  expect((await readBracketFit(page)).scrollLeft).toBe(scrollLeft);
});

test("on a phone, a bracket drawn while another tab showed fills the height once shown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openBracket(page);
  await openSeasonPart(page, "Standings");
  await page.reload();
  await expect(page.locator("#standingsWrap")).toBeVisible();

  await openSeasonPart(page, "Bracket");

  await expect(page.locator(".bracket-stage")).toBeVisible();
  await expectBracketToFillHeight(page);
});
