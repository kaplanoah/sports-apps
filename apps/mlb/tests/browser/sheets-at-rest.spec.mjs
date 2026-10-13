import { test, expect, openApp, buildSnapshotWithStarters, ON_A_PHONE } from "./harness.mjs";
import {
  expectAtRest,
  forgetResizeLoops,
  listResizeLoops,
} from "../../../../tests/browser/at-rest.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";

// In full motion, every slide of a sheet and of the dialog ends, and then nothing moves or asks
// for a frame, and no ResizeObserver loops. Fingers here are Chromium's, so this runs in Chromium
// only.

test.use(ON_A_PHONE);

/** @type {() => Promise<string[]>} */
let readResizeLoops;
test.beforeEach(async ({ page }) => {
  readResizeLoops = await listResizeLoops(page);
});
test.afterEach(async () => {
  expect(await readResizeLoops()).toEqual([]);
});

// A tab tap has motion and resizing of its own, which the tab bar's at-rest spec counts, so the
// sheets' motion and ResizeObserver loops are counted from the Games view at rest.
/** @param {import("@playwright/test").Page} page */
async function showGames(page) {
  await openApp(page, { snapshots: { 2026: buildSnapshotWithStarters() } });
  await page.getByRole("tab", { name: "Games" }).click();
  await page.clock.runFor(1000);
  await forgetResizeLoops(page);
}

/** @param {import("@playwright/test").Page} page */
async function openGame(page) {
  await page
    .getByRole("button", { name: "Game details: Astros at Athletics, Thu, Sep 24" })
    .click();
  const gameSheet = page.locator("#gameSheet");
  await expectShown(gameSheet);
  return gameSheet;
}

/** @param {import("@playwright/test").Page} page */
async function openAstrosOverGame(page) {
  await page
    .locator("#gameSheet")
    .getByRole("button", { name: "Team details: Astros" })
    .first()
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Houston Astros");
  await expectShown(teamSheet);
  return teamSheet;
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ x: number, y: number }} from
 * @param {{ x?: number, y?: number }} by
 * @param {{ durationMs?: number }} [options]
 */
async function swipe(page, from, by, options) {
  const lift = await drag(page, from, by, options);
  await lift();
}

/** @param {import("@playwright/test").Page} page */
async function expectClosedAtRest(page) {
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expectAtRest(page);
}

test("opening a club's sheet over a game's, going back by arrow and by swipe, and a swipe that springs back each leave the page at rest", async ({
  page,
}) => {
  await showGames(page);
  const gameSheet = await openGame(page);
  await expectAtRest(page);

  const teamSheet = await openAstrosOverGame(page);
  await expectAtRest(page);

  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expectShown(gameSheet);
  await expect(teamSheet).toBeHidden();
  await expectAtRest(page);

  await openAstrosOverGame(page);
  await swipe(page, { x: 60, y: 400 }, { x: 250 });
  await expectShown(gameSheet);
  await expect(teamSheet).toBeHidden();
  await expectAtRest(page);

  await openAstrosOverGame(page);
  await swipe(page, { x: 60, y: 400 }, { x: 40 }, { durationMs: 1000 });
  await expectShown(teamSheet);
  await expectAtRest(page);
});

test("closing by caret, Escape, backdrop, and swipe down each leave no dialog open and the page at rest", async ({
  page,
}) => {
  await showGames(page);
  const gameSheet = await openGame(page);
  await gameSheet.getByRole("button", { name: "Close" }).click();
  await expectClosedAtRest(page);

  await openGame(page);
  await page.keyboard.press("Escape");
  await expectClosedAtRest(page);

  await openGame(page);
  await page
    .locator("#sheetDialog")
    .evaluate((dialog) => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expectClosedAtRest(page);

  await openGame(page);
  await swipe(page, { x: 200, y: 120 }, { y: 300 });
  await expectClosedAtRest(page);
});

test("a swipe down too short to close springs the sheet back and leaves the page at rest", async ({
  page,
}) => {
  await showGames(page);
  await openGame(page);

  await swipe(page, { x: 200, y: 120 }, { y: 40 }, { durationMs: 1000 });
  await expect(page.locator("#sheetDialog")).not.toHaveAttribute("data-dragged");
  await expect(page.locator("#sheetDialog")).toHaveAttribute("open");
  await expectAtRest(page);
});

test("sliding between a game's sections, by a tap on its starters and by swipes, leaves the page at rest", async ({
  page,
}) => {
  await showGames(page);
  const gameSheet = await openGame(page);
  const matchupTab = gameSheet.getByRole("tab", { name: "Matchup" });
  const gameTab = gameSheet.getByRole("tab", { name: "Game" });

  await gameSheet.getByRole("button", { name: "Pitching matchup: Blubaugh vs Springs" }).click();
  await expect(matchupTab).toHaveAttribute("aria-selected", "true");
  await expectAtRest(page);

  await swipe(page, { x: 60, y: 400 }, { x: 250 });
  await expect(gameTab).toHaveAttribute("aria-selected", "true");
  await expectShown(gameSheet);
  await expectAtRest(page);

  await swipe(page, { x: 330, y: 400 }, { x: -250 });
  await expect(matchupTab).toHaveAttribute("aria-selected", "true");
  await expectAtRest(page);
});
