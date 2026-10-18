import { test, expect, openApp } from "./harness.mjs";
import { listAnimations } from "../../../../tests/browser/animations.mjs";

// The Dream and Mystics' game, at 7:00 PM, before it starts.
const GAME_ID = "1042600132";

/** @param {any} season */
function startGame(season) {
  const game = season.games.find((each) => each.id === GAME_ID);
  Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
  Object.assign(game.away, { score: 30 });
  Object.assign(game.home, { score: 27 });
  return season;
}

test.describe("with reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("a game that starts changes in place, in the row it's in", async ({ page }) => {
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();
    const row = page.locator(`[data-game="${GAME_ID}"]`);
    await expect(row).toContainText("7:00");
    const shownRow = await row.elementHandle();

    await app.changeSeason(startGame);

    await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
    expect(await shownRow.evaluate((element) => element.isConnected)).toBe(true);
  });

  test("the bracket keeps its lines when a game that starts redraws it", async ({ page }) => {
    const app = await openApp(page);
    const lines = page.locator("#bracketWrap .bracket-lines path");
    await expect(lines).not.toHaveCount(0);
    const lineCount = await lines.count();

    await app.changeSeason(startGame);

    await expect(page.locator("#bracketWrap .card-note.live")).not.toHaveCount(0);
    await expect(lines).toHaveCount(lineCount);
  });

  test("a game that starts shows its line at once", async ({ page }) => {
    const readAnimations = await listAnimations(page);
    const app = await openApp(page);
    await page.getByRole("tab", { name: "Games" }).click();

    await app.changeSeason(startGame);

    await expect(page.locator(`[data-game="${GAME_ID}"] .game-status`)).toHaveText("Q2 5:10");
    expect(await readAnimations()).toEqual([]);
  });
});

test("a game that starts eases its score to its new height and fades in its new line", async ({
  page,
}) => {
  const readAnimations = await listAnimations(page);
  const app = await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator(`[data-game="${GAME_ID}"]`)).toContainText("7:00");

  await app.changeSeason(startGame);

  await expect(page.locator(`[data-game="${GAME_ID}"] .game-status`)).toHaveText("Q2 5:10");
  const animations = await readAnimations();
  const growth = animations.find(({ element }) => element === "score");
  expect(parseFloat(String(growth.last.height))).toBeGreaterThan(
    parseFloat(String(growth.first.height)),
  );
  expect(growth.first.overflow).toBe("clip");
  expect(animations).toContainEqual({
    element: "game-status",
    first: { opacity: 0 },
    last: { opacity: 1 },
    direction: "normal",
  });
});

test("the page draws what it opens with at once, rather than easing it in", async ({ page }) => {
  const readAnimations = await listAnimations(page);

  await openApp(page);

  await expect(page.locator('[data-series="1-0"] .team-line.won')).toContainText("Liberty");
  expect(await readAnimations()).toEqual([]);
});

test("a redraw fades in only what's on screen, not the days it adds to a Games list out of sight", async ({
  page,
}) => {
  const readAnimations = await listAnimations(page);

  await openApp(page, { isWholeSeason: true });

  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    /^2026-05-/,
  );
  expect(await readAnimations()).toEqual([]);
});
