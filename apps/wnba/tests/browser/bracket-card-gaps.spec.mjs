import { test, expect, openApp } from "./harness.mjs";
import {
  holdHeaderStill,
  readSeasonPartScroll,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { scrollPageToEnd } from "../../../../tests/browser/page-left-down.mjs";
import { showTallUpdatesBox } from "../../../../tests/browser/updates-box.mjs";

// How the bracket's first-round cards spread on a phone to reach the round dots pinned above the
// tab bar.

test.use({ contextOptions: { reducedMotion: "reduce" } });

const PHONE = { width: 390, height: 844 };

const TIGHTEST_CARD_GAP = 32;

/**
 * The room above the first round's cards, between them, and from the last one's note to the round
 * dots, once the cards have spread.
 * @param {import("@playwright/test").Page} page
 */
async function readCardGaps(page) {
  await expect(page.locator('[data-series="1-2"] .card-note')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const readBox = (selector) =>
      /** @type {Element} */ (document.querySelector(selector)).getBoundingClientRect();
    const cards = ["1-0", "1-3", "1-1", "1-2"].map((id) => readBox(`[data-series="${id}"]`));
    return {
      aboveCards: cards[0].top - readBox(".round-name").bottom,
      between: cards.slice(1).map((card, index) => card.top - cards[index].bottom),
      lastNoteToDots: readBox(".round-dots").top - readBox('[data-series="1-2"] .card-note').bottom,
    };
  });
}

/**
 * Waits for the last card's note to end 12 to 16px above the round dots.
 * @param {import("@playwright/test").Page} page
 */
const expectReachingDots = (page) =>
  expect
    .poll(async () => {
      const { lastNoteToDots } = await readCardGaps(page);
      return lastNoteToDots >= 12 && lastNoteToDots < 12 + 4;
    })
    .toBe(true);

test.describe("on a phone, the bracket", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("spreads its cards alike to reach the round dots, with each round's name just above them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE.width, height: 816 });
    await openApp(page);
    const gaps = await readCardGaps(page);
    expect(gaps.aboveCards).toBeCloseTo(16, 0);
    expect(gaps.between[0]).toBeGreaterThan(TIGHTEST_CARD_GAP);
    for (const gap of gaps.between) expect(gap).toBeCloseTo(gaps.between[0], 0);
    expect(gaps.lastNoteToDots).toBeGreaterThanOrEqual(12);
    expect(gaps.lastNoteToDots).toBeLessThan(12 + 4);
  });

  test("spreads its cards again to reach the round dots when what's above the bracket grows or shrinks", async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE.width, height: 816 });
    await openApp(page);
    const spread = await readCardGaps(page);

    await page.locator("header").evaluate((header) => {
      const above = Object.assign(document.createElement("div"), {
        id: "roomAbove",
        style: "flex: none; height: 12px",
      });
      header.after(above);
    });

    await expectReachingDots(page);
    expect((await readCardGaps(page)).between[0]).toBeLessThan(spread.between[0]);

    await page.locator("#roomAbove").evaluate((above) => above.remove());

    await expectReachingDots(page);
    expect((await readCardGaps(page)).between).toEqual(spread.between);
  });

  test("where the header stays put, spreads its cards again to reach the round dots when a tall Updates box over it grows, holding the view at its least height", async ({
    page,
  }) => {
    // A screen tall enough for the cards to spread under the box, which leaves the view its least
    // height, most of the screen, but not so tall that they reach their widest gaps.
    await page.setViewportSize({ width: PHONE.width, height: 1230 });
    await holdHeaderStill(page);
    await openApp(page);
    const updates = await showTallUpdatesBox(page, 400);
    await expectReachingDots(page);
    expect((await readCardGaps(page)).between[0]).toBeGreaterThan(TIGHTEST_CARD_GAP);
    const view = page.locator("#view-bracket-standings");
    const readViewHeight = () => view.evaluate((element) => element.getBoundingClientRect().height);
    const viewHeight = await readViewHeight();

    await updates.evaluate((box) => (box.style.height = "420px"));

    await expectReachingDots(page);
    expect(await readViewHeight()).toBe(viewHeight);
    await expect(updates).toBeVisible();
    expect((await updates.boundingBox()).height).toBe(420);
  });

  test("spreads its cards no more than 1.45 times their tightest gap on a taller screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE.width, height: 2000 });
    await openApp(page);
    const gaps = await readCardGaps(page);
    for (const gap of gaps.between)
      expect(gap).toBeCloseTo(Math.floor(1.45 * TIGHTEST_CARD_GAP), 0);
    expect(gaps.lastNoteToDots).toBeGreaterThan(100);
  });

  test("keeps its tightest gaps on a short screen, where its part scrolls", async ({ page }) => {
    await page.setViewportSize({ width: PHONE.width, height: 568 });
    await openApp(page);
    const gaps = await readCardGaps(page);
    for (const gap of gaps.between) expect(gap).toBeCloseTo(TIGHTEST_CARD_GAP, 0);
  });

  test("keeps its gaps when it lays out again however far its part is scrolled", async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE.width, height: 600 });
    await openApp(page);
    const atTop = await readCardGaps(page);
    await page.locator("#bracketWrap").evaluate((wrap) => {
      const room = Object.assign(document.createElement("div"), { style: "height: 2000px" });
      wrap.after(room);
    });
    await scrollSeasonPartToEnd(page, "bracket");
    expect(await readSeasonPartScroll(page, "bracket")).toBeGreaterThan(0);

    await page.evaluate(() => dispatchEvent(new Event("resize")));

    expect((await readCardGaps(page)).between).toEqual(atTop.between);
  });

  test("where the header stays put, keeps its gaps when it lays out again with the page scrolled under a tall box over the bracket, as a full Updates box leaves it", async ({
    page,
  }) => {
    // A screen tall enough for the box to scroll the page while the cards spread between their
    // tightest and widest gaps.
    await page.setViewportSize({ width: PHONE.width, height: 1400 });
    await holdHeaderStill(page);
    await openApp(page);
    await page.locator("header").evaluate((header) => {
      const box = Object.assign(document.createElement("div"), {
        style: "flex: none; height: 590px",
      });
      header.after(box);
    });
    await expect
      .poll(async () => (await readCardGaps(page)).between[0])
      .toBeLessThan(Math.floor(1.45 * TIGHTEST_CARD_GAP));
    const atTop = await readCardGaps(page);
    expect(atTop.between[0]).toBeGreaterThan(TIGHTEST_CARD_GAP);
    await scrollPageToEnd(page);

    await page.evaluate(() => dispatchEvent(new Event("resize")));

    expect((await readCardGaps(page)).between).toEqual(atTop.between);
  });

  test("never scrolls down, nor further sideways, once the screen shrinks after it spread its cards", async ({
    page,
  }) => {
    const shortScreen = { width: 375, height: 667 };
    await page.setViewportSize(shortScreen);
    await openApp(page);
    const tree = page.locator(".bracket");
    const readScrollRoom = () =>
      tree.evaluate((element) => ({
        down: element.scrollHeight - element.clientHeight,
        sideways: element.scrollWidth - element.clientWidth,
      }));
    expect((await readCardGaps(page)).between[0]).toBeCloseTo(TIGHTEST_CARD_GAP, 0);
    const roomOnOpen = await readScrollRoom();
    expect(roomOnOpen.down).toBe(0);

    await page.setViewportSize({ width: 430, height: 932 });
    await expect
      .poll(async () => (await readCardGaps(page)).between[0])
      .toBeGreaterThan(TIGHTEST_CARD_GAP);
    await page.setViewportSize(shortScreen);
    await expect
      .poll(async () => (await readCardGaps(page)).between[0])
      .toBeCloseTo(TIGHTEST_CARD_GAP, 0);
    expect(await readScrollRoom()).toEqual(roomOnOpen);
  });
});
