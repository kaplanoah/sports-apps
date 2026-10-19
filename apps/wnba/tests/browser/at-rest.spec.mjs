import { test, expect, openApp, openGameSheet } from "./harness.mjs";
import {
  countFramesAcross,
  expectAtRest,
  forgetResizeLoops,
  listResizeLoops,
  waitForLoadToSettle,
} from "../../../../tests/browser/at-rest.mjs";
import { findSeasonPill } from "../../../../tests/browser/season-tab.mjs";
import {
  isPillBandShown,
  readHeaderReach,
  readPillHoldTop,
  readSeasonPartScroll,
  readSeasonRide,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import { VALKYRIES_AT_WINGS, finishValkyriesAtWings } from "./game-sheet-games.mjs";

// In full motion, every slide ends, and then nothing moves or asks for a frame. Each test counts
// ResizeObserver loops from its first gesture, since what the page does as it loads isn't theirs.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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

  await page.locator('#seasonGames .day-cell[data-day="2026-09-27"]').click();
  await expect(page.locator('#seasonGames .day-cell[data-day="2026-09-27"]')).toHaveClass(
    /is-chosen/,
  );
  await page.clock.runFor(2000);
  await expect(page.locator('#seasonGames .listed-day[data-day="2026-09-27"]')).toBeInViewport();
  await expectAtRest(page);

  await page.locator("#seasonGames .go-today").click();
  await page.clock.runFor(2000);
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await expectAtRest(page);

  expect(await readResizeLoops()).toEqual([]);
});

test("a tap on the pill between the bracket and the standings leaves the page at rest each way, and from far down the standings brings the bracket in with the header still gone", async ({
  page,
}) => {
  const readResizeLoops = await listResizeLoops(page);
  await openApp(page);
  await waitForLoadToSettle(page);
  await expect(page.locator("#bracketWrap .bracket")).toBeInViewport();
  await expectAtRest(page);
  await forgetResizeLoops(page);

  await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();
  await expect(page.locator("#standings-league")).toBeInViewport();
  await expectAtRest(page);
  await scrollSeasonPartToEnd(page, "standings");

  await findSeasonPill(page).getByRole("tab", { name: "Bracket" }).click();
  await expect(page.locator("#bracketWrap .bracket")).toBeInViewport();
  await expectAtRest(page);

  expect(await readSeasonPartScroll(page, "bracket")).toBe(await readHeaderReach(page));
  expect(await readSeasonRide(page)).toMatchObject({ pillTop: await readPillHoldTop(page) });
  expect(await isPillBandShown(page)).toBe(true);
  expect(await readResizeLoops()).toEqual([]);
});

test("the page's redraw each minute, which keeps its times current, asks for no frame", async ({
  page,
}) => {
  await openApp(page);
  await waitForLoadToSettle(page);

  expect(await countFramesAcross(page, 60_000)).toBe(0);
});

// The lead chart's tile takes its corner from CSS's rx, which only this spec checks in WebKit, as
// an iPhone draws it.
test("the lead chart's tile rounds its corners by the card's shape token", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const app = await openApp(page);
  await app.changeSeason(finishValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  const tile = sheet.locator(".lead-chart .lead-tile");
  await expect(tile).toBeVisible();
  const [corner, token] = await tile.evaluate((rect) => [
    getComputedStyle(rect).rx,
    getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim(),
  ]);
  expect(corner).toBe(token);
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
