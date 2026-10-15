import { test, expect, openApp, ON_A_PHONE } from "./harness.mjs";
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
