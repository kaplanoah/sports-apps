import { test, expect, openApp } from "./harness.mjs";
import {
  expectAtRest,
  forgetResizeLoops,
  listResizeLoops,
} from "../../../../tests/browser/at-rest.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";

// In full motion, every slide of a sheet, a section, and the dialog ends, and then nothing moves or
// asks for a frame, and no ResizeObserver loops. Fingers here are Chromium's, so this runs in
// Chromium only.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** @type {() => Promise<string[]>} */
let readResizeLoops;
test.beforeEach(async ({ page }) => {
  readResizeLoops = await listResizeLoops(page);
});
test.afterEach(async () => {
  expect(await readResizeLoops()).toEqual([]);
});

// A tab tap has motion and resizing of its own, which the tab bar's at-rest spec counts, so the
// sheets' motion and ResizeObserver loops are counted from the games at rest, with the game's
// row in view.
/** @param {import("@playwright/test").Page} page */
async function showPreviousGames(page) {
  await openApp(page);
  await page.getByRole("tab", { name: "Games" }).click();
  await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
  await findAcesAtFever(page).evaluate(
    (button) =>
      new Promise((resolve) => {
        const list = /** @type {HTMLElement} */ (button.closest(".day-list"));
        list.addEventListener("scroll", resolve, { once: true });
        button.scrollIntoView({ block: "nearest" });
      }),
  );
  await page.clock.runFor(1000);
  await forgetResizeLoops(page);
}

/** @param {import("@playwright/test").Page} page */
const findAcesAtFever = (page) =>
  page
    .locator("#seasonGames")
    .getByRole("button", { name: "Game details: Aces at Fever, First Round Game 2" });

/** @param {import("@playwright/test").Page} page */
async function openGame(page) {
  await findAcesAtFever(page).click();
  const gameSheet = page.locator("#gameSheet");
  await expect(gameSheet.locator(".line-score")).toBeVisible();
  await expectShown(gameSheet);
  return gameSheet;
}

/**
 * Opens the Fever's sheet over the game's, and waits for its stats.
 * @param {import("@playwright/test").Page} page
 */
async function openFeverOverGame(page) {
  await page
    .locator("#gameSheet .faceoff")
    .getByRole("button", { name: /^Fever\b.*team details$/ })
    .click();
  const teamSheet = page.locator("#teamSheet");
  await expect(teamSheet.locator("#teamTitle")).toHaveText("Indiana Fever");
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

test("opening a sheet over another, going back by arrow and by swipe, and a swipe that springs back each leave the page at rest", async ({
  page,
}) => {
  await showPreviousGames(page);
  const gameSheet = await openGame(page);
  await expectAtRest(page);

  const teamSheet = await openFeverOverGame(page);
  await expectAtRest(page);

  await teamSheet.getByRole("button", { name: "Back to Game", exact: true }).click();
  await expectShown(gameSheet);
  await expect(teamSheet).toBeHidden();
  await expectAtRest(page);

  await openFeverOverGame(page);
  await swipe(page, { x: 60, y: 400 }, { x: 250 });
  await expectShown(gameSheet);
  await expect(teamSheet).toBeHidden();
  await expectAtRest(page);

  await swipe(page, { x: 330, y: 400 }, { x: -250 });
  await expectShown(gameSheet);
  await expectAtRest(page);

  await openFeverOverGame(page);
  await swipe(page, { x: 60, y: 400 }, { x: 40 }, { durationMs: 1000 });
  await expectShown(teamSheet);
  await expectAtRest(page);
});

test("switching a sheet's sections by pill and by swipe leaves the page at rest", async ({
  page,
}) => {
  await showPreviousGames(page);
  await openGame(page);
  const teamSheet = await openFeverOverGame(page);

  await teamSheet.getByRole("tab", { name: "Roster" }).click();
  await expectShown(page.locator("#rosterSection"));
  await expectAtRest(page);

  await teamSheet.getByRole("tab", { name: "Team" }).click();
  await expectShown(page.locator("#teamSection"));
  await expectAtRest(page);

  await swipe(page, { x: 330, y: 400 }, { x: -250 });
  await expectShown(page.locator("#rosterSection"));
  await expectAtRest(page);
});

test("closing by caret, Escape, backdrop, and swipe down each leave no dialog open and the page at rest", async ({
  page,
}) => {
  await showPreviousGames(page);
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
  await showPreviousGames(page);
  await openGame(page);

  await swipe(page, { x: 200, y: 120 }, { y: 40 }, { durationMs: 1000 });
  await expect(page.locator("#sheetDialog")).not.toHaveAttribute("data-dragged");
  await expect(page.locator("#sheetDialog")).toHaveAttribute("open");
  await expectAtRest(page);
});
