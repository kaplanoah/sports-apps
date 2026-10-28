import { countScrollHoldersAt } from "../../../../tests/browser/held-scrolls.mjs";
import { findMiddle, readScroll } from "../../../../tests/browser/season-scroll.mjs";
import { openFromHomeScreen, pullDown, PULL_START } from "../../../../tests/browser/touch.mjs";
import { test, expect, openApp } from "./harness.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

/** @param {Awaited<ReturnType<typeof openApp>>} app */
const rescoreFinalWhileAway = (app) =>
  app.changeSeasonWhileAway((season) => {
    const game = season.slate.today.games.find((each) => each.away === "STL");
    game.score = [7, 2];
    return season;
  });

test("pulling the page down on the Home Screen reads what it missed, without reloading", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  const final = page
    .locator("#seasonGames .game-day.is-today .game-row")
    .filter({ hasText: "Cardinals" });
  await expect(final).toContainText("1-2Final");
  await expect.poll(() => app.countOpenSockets()).toBeGreaterThan(0);
  await rescoreFinalWhileAway(app);
  await page.evaluate(() => Object.assign(window, { isSameLoad: true }));

  await pullDown(page, 200);

  await expect(final).toContainText("7-2Final");
  expect(await page.evaluate(() => "isSameLoad" in window)).toBe(true);
});

test("on Games, a scroll in the list scrolled down doesn't wait on the pull, while a pull from the header above it still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  const list = page.locator("#seasonGames .day-list");
  expect(await readScroll(list)).toBeGreaterThan(0);
  // The ranking's drag holds every scroll on the page, the list's too.
  const atHeader = await countScrollHoldersAt(page, PULL_START);

  expect(await countScrollHoldersAt(page, await findMiddle(list))).toBe(atHeader - 1);
  await app.holdStore();
  await pullDown(page, 200);
  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
});
