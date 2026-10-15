import { test, expect, openApp } from "./harness.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { findSeasonPill, openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

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

/** @param {import("@playwright/test").Page} page */
const scrollBracketToEnd = (page) =>
  page
    .locator("#bracketWrap .bracket")
    .evaluate((tree) => tree.scrollTo({ left: tree.scrollWidth, behavior: "instant" }));

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
});
