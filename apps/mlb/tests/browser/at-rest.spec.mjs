import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  BROADCASTS_FIXTURE,
  ON_A_PHONE,
} from "./harness.mjs";
import {
  expectAtRest,
  forgetResizeLoops,
  listResizeLoops,
  waitForLoadToSettle,
} from "../../../../tests/browser/at-rest.mjs";

// In full motion, every slide ends, and then nothing moves or asks for a frame. Each test counts
// ResizeObserver loops from its first gesture, since what the page does as it loads isn't theirs.

test.use(ON_A_PHONE);

test("a tab tap, a tap on a day, and a tap on Today each leave the page at rest, with no ResizeObserver loop", async ({
  page,
}) => {
  const readResizeLoops = await listResizeLoops(page);
  await openApp(page, { isWholeSeason: true });
  await waitForLoadToSettle(page);
  await expectAtRest(page);
  await forgetResizeLoops(page);

  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await expectAtRest(page);

  const sunday = page.locator('#seasonGames .day-cell[data-day="2026-09-27"]');
  await sunday.click();
  await expect(sunday).toHaveClass(/is-chosen/);
  await page.clock.runFor(2000);
  await expect(page.locator('#seasonGames .listed-day[data-day="2026-09-27"]')).toBeInViewport();
  await expectAtRest(page);

  await page.locator("#seasonGames .go-today").click();
  await page.clock.runFor(2000);
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await expectAtRest(page);

  expect(await readResizeLoops()).toEqual([]);
});

test("a shown list that grows loops no ResizeObserver", async ({ page }) => {
  const readResizeLoops = await listResizeLoops(page);
  await openApp(page);
  await waitForLoadToSettle(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await expectAtRest(page);
  await forgetResizeLoops(page);

  await page
    .locator("#seasonGames .listed-day")
    .first()
    .evaluate((day) => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      day.append(filler);
    });
  await page.clock.runFor(500);

  await expect
    .poll(() => page.locator("#seasonGames .day-list").evaluate((list) => list.scrollHeight))
    .toBeGreaterThan(3000);
  expect(await readResizeLoops()).toEqual([]);
});

/**
 * How far the shown view starts above the Updates box's end, which is nothing when it's under it.
 * @param {import("@playwright/test").Page} page
 */
const measureOverlap = (page) =>
  page.evaluate(() => {
    const updates = /** @type {Element} */ (document.getElementById("updates"));
    const view = /** @type {Element} */ (document.querySelector(".view.active"));
    return Math.max(0, updates.getBoundingClientRect().bottom - view.getBoundingClientRect().top);
  });

test("a reload on Games, then Bracket, leaves each view under the Updates box", async ({
  page,
}) => {
  const at = new Date(Date.parse(BROADCASTS_FIXTURE.now) - 60 * 60 * 1000).toISOString();
  const log = [
    { won: "CLE", lost: "TB", game: 3 },
    { won: "MIL", lost: "LAD", series: "NL_DS1", game: 2 },
    { won: "TB", lost: "CLE", game: 1 },
  ].map(({ series = "AL_DS1", ...game }) => ({
    at,
    ended: at,
    kind: "game",
    series,
    score: [2, 1],
    runs: [3, 2],
    ...game,
  }));
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
    store: { "seasons/2026": { log } },
  });
  await expect(page.locator("#updates")).toContainText("Brewers beat the");
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();

  await page.reload();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await waitForLoadToSettle(page);
  expect(await measureOverlap(page)).toBe(0);

  await page.getByRole("tab", { name: "Bracket" }).click();
  await expect(page.locator("#bracketWrap .bracket-stage")).toBeVisible();
  await expectAtRest(page);
  expect(await measureOverlap(page)).toBe(0);
});
