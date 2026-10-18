import { test, expect, openApp } from "./harness.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { findSeasonPill, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import {
  expectDotsHeldWithBracket,
  readRoundDotsLift,
  readRoundDotsTop,
  trackRoundDots,
} from "../../../../tests/browser/round-dots.mjs";
import {
  expectNoScrollAsHeightChanges,
  expectScrollHeldAsPartsRest,
  hideResizesFromPage,
  isSeasonPillHeld,
  trackSeasonScroll,
} from "../../../../tests/browser/season-scroll.mjs";

const PHONE = { width: 390, height: 844 };

test.use({
  viewport: PHONE,
  hasTouch: true,
  isMobile: true,
  contextOptions: { reducedMotion: "reduce" },
});

/**
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
const findPart = (page, part) => page.locator(`#bracketStandingsParts > [data-part="${part}"]`);

/**
 * Where a part sits across the screen.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
const readPartLeft = (page, part) =>
  findPart(page, part).evaluate((element) => Math.round(element.getBoundingClientRect().x));

/**
 * Waits until a part rests on the screen, chosen in the pill, with the parts no longer moving.
 * @param {import("@playwright/test").Page} page
 * @param {"standings" | "bracket"} part
 */
async function expectPartShown(page, part) {
  const element = findPart(page, part);
  await expect(element).toBeVisible();
  await expect(element).not.toHaveAttribute("inert");
  await expect.poll(() => readPartLeft(page, part)).toBe(0);
  await expect(page.locator("#bracketStandingsParts")).not.toHaveAttribute("data-sliding");
  const name = part === "bracket" ? "Bracket" : "Standings";
  await expect(findSeasonPill(page).getByRole("tab", { name })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/**
 * Scrolls the bracket to its last round, and waits for its dot to light, which the bracket's
 * scroll event does, so nothing the scroll changes lands later.
 * @param {import("@playwright/test").Page} page
 */
async function scrollBracketToEnd(page) {
  await page
    .locator("#bracketWrap .bracket")
    .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));
  await expect(page.locator("#bracketWrap .round-dots [data-round]").last()).toHaveClass(/\bon\b/);
}

/** @param {import("@playwright/test").Page} page */
const readBracketScroll = (page) =>
  page.locator("#bracketWrap .bracket").evaluate((tree) => tree.scrollLeft);

test("a swipe left on the bracket at its last round brings in the standings, and a swipe right on them goes back to the bracket", async ({
  page,
}) => {
  await openApp(page);
  await expectPartShown(page, "bracket");
  await scrollBracketToEnd(page);

  await (
    await drag(page, { x: 330, y: 400 }, { x: -250 })
  )();

  await expectPartShown(page, "standings");
  await expect(findPart(page, "bracket")).toBeHidden();

  await (
    await drag(page, { x: 60, y: 400 }, { x: 250 })
  )();

  await expectPartShown(page, "bracket");
  await expect(findPart(page, "standings")).toBeHidden();
});

test("a swipe left on the bracket short of its last round scrolls the bracket, and leaves the standings where they are", async ({
  page,
}) => {
  await openApp(page);
  await expectPartShown(page, "bracket");
  const before = await readBracketScroll(page);

  await (
    await drag(page, { x: 330, y: 400 }, { x: -150 })
  )();

  await expect.poll(() => readBracketScroll(page)).toBeGreaterThan(before);
  await expectPartShown(page, "bracket");
});

test("a swipe right on the bracket, before its first part, leaves it where it is", async ({
  page,
}) => {
  await openApp(page);
  await expectPartShown(page, "bracket");
  await page.locator("#bracketWrap .bracket").evaluate((tree) => (tree.scrollLeft = 0));

  await (
    await drag(page, { x: 60, y: 400 }, { x: 250 })
  )();

  await expectPartShown(page, "bracket");
});

test("a swipe that brings the bracket in from far down the standings shows it just under the pill, which stays held, and the page lets go of the room it held back at its top", async ({
  page,
}) => {
  await openApp(page);
  await openSeasonPart(page, "Standings");
  await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  const pill = page.locator("#bracketStandingsPill");
  await expect(pill).toHaveClass(/stuck/);

  await (
    await drag(page, { x: 60, y: 400 }, { x: 250 })
  )();

  await expectPartShown(page, "bracket");
  await expect(pill).toHaveClass(/stuck/);
  const { partsTop, pillBottom, pageWidth } = await page.evaluate(() => ({
    partsTop: document.getElementById("bracketStandingsParts").getBoundingClientRect().top,
    pillBottom: document.getElementById("bracketStandingsPill").getBoundingClientRect().bottom,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(Math.abs(partsTop - pillBottom)).toBeLessThanOrEqual(1);
  expect(pageWidth).toBe(PHONE.width);
  await expect(page.locator("#bracketStandingsParts")).toHaveAttribute("data-holding-room");

  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));

  await expect(page.locator("#bracketStandingsParts")).not.toHaveAttribute("data-holding-room");
  await expect(pill).not.toHaveClass(/stuck/);
});

test.describe("in full motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  /**
   * Notes where a part is across the screen on each frame, until the returned function stops and
   * reads the notes.
   * @param {import("@playwright/test").Page} page
   * @param {"standings" | "bracket"} part
   */
  async function trackPart(page, part) {
    await page.evaluate((key) => {
      const element = /** @type {HTMLElement} */ (
        document.querySelector(`#bracketStandingsParts > [data-part="${key}"]`)
      );
      const noted = /** @type {number[]} */ ([]);
      const note = () => {
        noted.push(Math.round(element.getBoundingClientRect().x));
        if (!(/** @type {any} */ (window).isTrackingDone)) requestAnimationFrame(note);
      };
      requestAnimationFrame(note);
      Object.assign(window, { partLefts: noted, isTrackingDone: false });
    }, part);
    return () =>
      page.evaluate(() => {
        Object.assign(window, { isTrackingDone: true });
        return /** @type {number[]} */ (/** @type {any} */ (window).partLefts);
      });
  }

  test("a finger swiping the bracket left at its last round moves nothing but the parts while it does, and once it lifts, the pill hands off to Standings as they set off and settle without stepping back", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    await page.evaluate(() => {
      const changes = /** @type {string[]} */ ([]);
      const parts = /** @type {HTMLElement} */ (document.getElementById("bracketStandingsParts"));
      const isMoving = (/** @type {MutationRecord} */ record) =>
        record.attributeName === "style" ||
        (record.attributeName === "data-sliding" && record.target === parts);
      new MutationObserver((records) =>
        changes.push(
          ...records
            .filter((record) => !isMoving(record))
            .map((record) => record.attributeName ?? ""),
        ),
      ).observe(/** @type {Node} */ (document.getElementById("view-bracket-standings")), {
        attributes: true,
        subtree: true,
      });
      Object.assign(window, { partChanges: changes });
    });

    const release = await drag(page, { x: 330, y: 400 }, { x: -250 }, { durationMs: 1000 });
    const standingsLeft = await readPartLeft(page, "standings");
    expect(standingsLeft).toBeGreaterThan(0);
    expect(standingsLeft).toBeLessThan(PHONE.width);
    await expect(findSeasonPill(page).getByRole("tab", { name: "Bracket" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await page.evaluate(() => /** @type {any} */ (window).partChanges)).toEqual([]);
    const readLefts = await trackPart(page, "standings");
    await release();
    await expectPartShown(page, "standings");
    const lefts = await readLefts();

    expect(lefts.length).toBeGreaterThan(5);
    expect(lefts.every((left, index) => index === 0 || left <= lefts[index - 1])).toBe(true);
    expect(lefts.at(-1)).toBe(0);
  });

  test("a short swipe left on the bracket at its last round springs back to the bracket once the finger lifts", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);

    const release = await drag(page, { x: 330, y: 400 }, { x: -46 }, { durationMs: 1000 });
    expect(await readPartLeft(page, "bracket")).toBeLessThan(-30);
    await release();

    await expectPartShown(page, "bracket");
    await expect(findPart(page, "standings")).toBeHidden();
  });

  test("the round dots hold their height over the tab bar on every frame of a tap's slide to the standings and back, moving only sideways, with the bracket", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    const restingTop = await readRoundDotsTop(page);
    const pill = findSeasonPill(page);

    const readFramesOut = await trackRoundDots(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expectPartShown(page, "standings");
    expectDotsHeldWithBracket(await readFramesOut(), restingTop);

    const readFramesBack = await trackRoundDots(page);
    await pill.getByRole("tab", { name: "Bracket" }).click();
    await expectPartShown(page, "bracket");
    expectDotsHeldWithBracket(await readFramesBack(), restingTop);
  });

  test("the round dots hold their height over the tab bar on every frame of a swipe from the bracket's last round to the standings", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    const restingTop = await readRoundDotsTop(page);

    const readFrames = await trackRoundDots(page);
    const release = await drag(page, { x: 330, y: 400 }, { x: -250 }, { durationMs: 1000 });
    await release();
    await expectPartShown(page, "standings");

    expectDotsHeldWithBracket(await readFrames(), restingTop);
  });

  test("a bracket laid out again while a finger holds it part way to the standings keeps its cards spread", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    const tree = page.locator("#bracketWrap .bracket");
    const readCardGap = () =>
      tree.evaluate((element) => element.style.getPropertyValue("--card-gap"));
    const spreadGap = await readCardGap();
    expect(parseFloat(spreadGap)).toBeGreaterThan(32);

    const release = await drag(page, { x: 330, y: 400 }, { x: -150 }, { durationMs: 1000 });
    await expect(page.locator("#bracketStandingsParts")).toHaveAttribute("data-sliding", "finger");
    await page.evaluate(() => dispatchEvent(new Event("resize")));

    expect(await readCardGap()).toBe(spreadGap);
    await release();
  });

  test("the round dots hold their height over the tab bar when the bracket redraws for new results while a finger holds it part way to the standings", async ({
    page,
  }) => {
    const app = await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    const restingTop = await readRoundDotsTop(page);

    const release = await drag(page, { x: 330, y: 400 }, { x: -150 }, { durationMs: 1000 });
    await expect(page.locator("#bracketStandingsParts")).toHaveAttribute("data-sliding", "finger");
    await app.changeSeason((season) => {
      season.series.find((series) => series.id === "1-1").bottom.wins = 1;
      return season;
    });
    await expect(page.locator('[data-series="1-1"] .team-line').nth(1)).toContainText("1");

    expect(await readRoundDotsTop(page)).toBe(restingTop);
    await release();
  });

  test("the round dots stay just above the tab bar when the screen resizes while a finger holds the bracket part way to the standings", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    const restingLift = await readRoundDotsLift(page);

    const release = await drag(page, { x: 330, y: 400 }, { x: -150 }, { durationMs: 1000 });
    await expect(page.locator("#bracketStandingsParts")).toHaveAttribute("data-sliding", "finger");
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height - 100 });

    await expect.poll(() => readRoundDotsLift(page)).toBe(restingLift);
    await release();
  });

  test("the round dots stay just above the tab bar when the bracket grows taller while a finger holds it part way to the standings", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    const restingLift = await readRoundDotsLift(page);
    const tree = page.locator("#bracketWrap .bracket");
    const readHeight = () => tree.evaluate((element) => element.getBoundingClientRect().height);
    const restingHeight = await readHeight();

    const release = await drag(page, { x: 330, y: 400 }, { x: -150 }, { durationMs: 1000 });
    await expect(page.locator("#bracketStandingsParts")).toHaveAttribute("data-sliding", "finger");
    await tree.evaluate((element) => element.style.setProperty("--card-gap", "80px"));
    expect(await readHeight()).toBeGreaterThan(restingHeight);

    expect(await readRoundDotsLift(page)).toBe(restingLift);
    await release();
  });

  test("the round dots hold their height over the tab bar on every frame of a tap that brings the bracket in from far down the standings", async ({
    page,
  }) => {
    await openApp(page);
    await expectPartShown(page, "bracket");
    const restingTop = await readRoundDotsTop(page);
    const pill = findSeasonPill(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expectPartShown(page, "standings");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);

    const readFrames = await trackRoundDots(page);
    await pill.getByRole("tab", { name: "Bracket" }).click();
    await expectPartShown(page, "bracket");

    expectDotsHeldWithBracket(await readFrames(), restingTop);
  });

  test("a tap that brings the bracket in from far down the standings scrolls the page only as the parts set off, never on the frame they rest and the page grows shorter, with the bracket just under the pill and the standings holding still", async ({
    page,
  }) => {
    await openApp(page);
    const pill = findSeasonPill(page);
    await pill.getByRole("tab", { name: "Standings" }).click();
    await expectPartShown(page, "standings");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);

    const readFrames = await trackSeasonScroll(page, { coming: "bracket", leaving: "standings" });
    await pill.getByRole("tab", { name: "Bracket" }).click();
    await expectPartShown(page, "bracket");

    expectScrollHeldAsPartsRest(await readFrames());
  });

  test("a swipe that brings the bracket in from far down the standings scrolls the page only as the parts set off, never on the frame they rest and the page grows shorter", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await expectPartShown(page, "standings");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);

    const readFrames = await trackSeasonScroll(page, { coming: "bracket", leaving: "standings" });
    const release = await drag(page, { x: 60, y: 400 }, { x: 250 }, { durationMs: 1000 });
    await release();
    await expectPartShown(page, "bracket");

    expectScrollHeldAsPartsRest(await readFrames());
  });

  test("a short swipe far down the standings springs back to them where they were, with the page scrolled as far as before", async ({
    page,
  }) => {
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await expectPartShown(page, "standings");
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);
    const readPlace = async () => ({
      scroll: await page.evaluate(() => Math.round(scrollY)),
      top: await findPart(page, "standings").evaluate((part) =>
        Math.round(part.getBoundingClientRect().top),
      ),
    });
    const before = await readPlace();

    const release = await drag(page, { x: 60, y: 400 }, { x: 46 }, { durationMs: 1000 });
    expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(before.scroll);
    await release();

    await expectPartShown(page, "standings");
    expect(await readPlace()).toEqual(before);
  });

  /**
   * Opens the bracket on a phone small enough for the page to scroll down it, at its last round,
   * and scrolls the page to the bracket's end.
   * @param {import("@playwright/test").Page} page
   */
  async function openFarDownBracketOnSmallPhone(page) {
    await page.setViewportSize({ width: 320, height: 568 });
    await openApp(page);
    await expectPartShown(page, "bracket");
    await scrollBracketToEnd(page);
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);
  }

  test("on a small phone, a swipe that brings the standings in from far down the bracket scrolls the page only as the parts rest, never as the page grows when they set off", async ({
    page,
  }) => {
    await openFarDownBracketOnSmallPhone(page);

    const readFrames = await trackSeasonScroll(page, { coming: "standings", leaving: "bracket" });
    const release = await drag(page, { x: 300, y: 400 }, { x: -250 }, { durationMs: 1000 });
    await release();
    await expectPartShown(page, "standings");

    expectScrollHeldAsPartsRest(await readFrames());
  });

  test("on a small phone, a short swipe far down the bracket springs back to it where it was, never scrolling the page as its height changes", async ({
    page,
  }) => {
    await openFarDownBracketOnSmallPhone(page);
    const before = await page.evaluate(() => Math.round(scrollY));

    const readFrames = await trackSeasonScroll(page, { coming: "standings", leaving: "bracket" });
    const release = await drag(page, { x: 300, y: 400 }, { x: -46 }, { durationMs: 1000 });
    await release();
    await expectPartShown(page, "bracket");

    expectNoScrollAsHeightChanges(await readFrames());
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(before);
  });

  test("a swipe that brings the bracket in from far down the standings leaves the pill held at the top on a screen that grew taller without a resize, as a Home Screen app does as it opens", async ({
    page,
  }) => {
    await hideResizesFromPage(page);
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height - 61 });
    await openApp(page);
    await openSeasonPart(page, "Standings");
    await expectPartShown(page, "standings");
    await page.setViewportSize(PHONE);
    await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await expect(page.locator("#bracketStandingsPill")).toHaveClass(/stuck/);

    const release = await drag(page, { x: 60, y: 400 }, { x: 250 }, { durationMs: 1000 });
    await release();

    await expectPartShown(page, "bracket");
    expect(await isSeasonPillHeld(page)).toBe(true);
  });
});
