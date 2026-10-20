import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
import {
  leaveFractionDown,
  leavePageFractionDown,
} from "../../../../tests/browser/page-left-down.mjs";
import { findSeasonPart } from "../../../../tests/browser/season-scroll.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { drag, dragAlong, openFromHomeScreen, pullDown } from "../../../../tests/browser/touch.mjs";
import { test, expect, openApp } from "./harness.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// A reload clears whatever the test left on the window.
/** @param {import("@playwright/test").Page} page */
const markPage = (page) => page.evaluate(() => Object.assign(window, { isSameLoad: true }));
/** @param {import("@playwright/test").Page} page */
const isSameLoad = (page) => page.evaluate(() => "isSameLoad" in window);

/** @param {Awaited<ReturnType<typeof openApp>>} app */
const startGameWhileAway = (app) =>
  app.changeSeasonWhileAway((season) => {
    const game = season.games.find((each) => each.id === "1042600132");
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    return season;
  });

const SHORTEST_REFRESH_MS = 800;

/** @param {import("@playwright/test").Page} page */
async function openGames(page) {
  await page.getByRole("tab", { name: "Games" }).click();
  const row = page.locator('[data-game="1042600132"]');
  await expect(row).toBeVisible();
  return row;
}

test("pulling the page down on the Home Screen reads what it missed, without reloading", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  const row = await openGames(page);
  await startGameWhileAway(app);
  await markPage(page);

  await pullDown(page, 200);

  await expect(row.locator(".game-status .clock")).toHaveText("Q2 5:10");
  expect(await isSameLoad(page)).toBe(true);
});

test("a refreshing page shows the turning spokes, held down until the store answers", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");
  const header = page.locator("header.top");
  const release = await app.holdStore();

  await pullDown(page, 200);

  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveClass(/turning/);
  await expect(header).toHaveCSS("top", "56px");
  release();
  await page.clock.runFor(SHORTEST_REFRESH_MS);
  await expect(spinner).toBeHidden();
  await expect(header).toHaveCSS("top", "auto");
});

test("a page that reloads while held down, as for a newer release, comes back in place, its Updates box too", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const header = page.locator("header.top");
  const release = await app.holdStore();
  await pullDown(page, 200);
  await expect(header).toHaveCSS("top", "56px");
  await expect(page.locator("#updates")).toHaveCSS("top", "56px");

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("#updates")).toHaveCSS("top", "auto");
  await expect(header).toHaveCSS("top", "auto");
  release();
});

test("a pull on a page left a fraction of a pixel down, as a phone can leave it, still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  await leavePageFractionDown(page);
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
});

test("a short pull settles back without refreshing", async ({ page }) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  await app.holdStore();

  await pullDown(page, 60);

  await expect(page.locator(".pull-refresh")).toBeHidden();
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
});

test("a sideways swipe from the top doesn't pull the page", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);

  const release = await drag(page, { x: 300, y: 40 }, { x: -200, y: 60 });

  await expect(page.locator(".pull-refresh")).toBeHidden();
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
  await release();
});

test("in the browser, pulling to refresh is left to the browser", async ({ page }) => {
  await openApp(page);
  await openGames(page);

  await pullDown(page, 200);

  await expect(page.locator(".pull-refresh")).toHaveCount(0);
});

test("a page let go eases back up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const header = page.locator("header.top");
  await header.evaluate((element) => {
    const transitions = /** @type {string[]} */ ([]);
    new MutationObserver(() => transitions.push(element.style.transition)).observe(element, {
      attributeFilter: ["style"],
    });
    Object.assign(window, { headerTransitions: transitions });
  });

  await pullDown(page, 60);

  await expect(header).toHaveCSS("top", "auto");
  const transitions = await page.evaluate(
    () => /** @type {string[]} */ (/** @type {any} */ (window).headerTransitions),
  );
  expect(transitions).toContain("top 0.3s");
});

test("a page pulled down and back up to where it started settles in place at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);

  const release = await dragAlong(
    page,
    [40, 70, 100, 70, 40].map((y) => ({ x: 200, y })),
  );
  await release();

  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
  await expect(page.locator("header.top")).toHaveCSS("position", "static");
});

test("a page let go stays held to its pull's place until its own move back ends, not a move inside it or another of its own", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  // Right after the page's own handler lets go, a part inside the first moved part ends a move of
  // its top, and then the moved part ends a move of something other than its top.
  await page.evaluate(() =>
    document.addEventListener("touchend", () => {
      const moved = /** @type {HTMLElement} */ (
        [...document.body.children].find((part) => /** @type {HTMLElement} */ (part).style.top)
      );
      const inside = /** @type {HTMLElement} */ (moved.querySelector("*"));
      /**
       * @param {HTMLElement} part
       * @param {string} propertyName
       */
      const endMove = (part, propertyName) => {
        part.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName }));
        return moved.style.position;
      };
      Object.assign(window, {
        positionsAfterOtherMoves: [endMove(inside, "top"), endMove(moved, "opacity")],
      });
    }),
  );

  await pullDown(page, 60);

  expect(await page.evaluate(() => /** @type {any} */ (window).positionsAfterOtherMoves)).toEqual([
    "relative",
    "relative",
  ]);
  await expect(page.locator("header.top")).toHaveCSS("top", "auto");
});

test("a swipe down in an open sheet is the sheet's, not a pull", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.locator(SETTINGS);
  await expect(sheet).toBeVisible();
  const box = /** @type {{ x: number, y: number }} */ (await sheet.boundingBox());

  const release = await drag(page, { x: box.x + 40, y: box.y + 20 }, { y: 120 });

  await expect(page.locator(".pull-refresh")).toBeHidden();
  expect(await page.locator("header.top").evaluate((header) => header.style.top)).toBe("");
  await release();
});

test("on the season tab, a pull holds the standings down with the header", async ({ page }) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openSeasonPart(page, "Standings");
  const standings = page.locator("#standingsWrap");
  await expect(standings.locator("table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  const before = await standings.boundingBox();
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
  await expect.poll(async () => (await standings.boundingBox()).y).toBe(before.y + 56);
});

test("on the season tab, a pull on the standings left a fraction of a pixel down, as a phone can leave them, still refreshes", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openSeasonPart(page, "Standings");
  const standings = page.locator("#standingsWrap");
  await expect(standings.locator("table").first()).toBeVisible();
  await waitForLoadToSettle(page);
  await leaveFractionDown(findSeasonPart(page, "standings"));
  await app.holdStore();
  const box = /** @type {{ x: number, y: number }} */ (await standings.boundingBox());

  const release = await drag(page, { x: box.x + 40, y: box.y + 20 }, { y: 200 });
  await release();

  await expect(page.locator(".pull-refresh")).toHaveClass(/turning/);
  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
});

test("on a phone, the tab bar stays put while the page is held down", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openFromHomeScreen(page);
  const app = await openApp(page);
  await openGames(page);
  const tabBar = page.locator("#tabBar");
  const before = await tabBar.boundingBox();
  await app.holdStore();

  await pullDown(page, 200);

  await expect(page.locator("header.top")).toHaveCSS("top", "56px");
  expect(await tabBar.boundingBox()).toEqual(before);
});

/** @param {import("@playwright/test").Locator} spinner */
const readShownSpokes = (spinner) =>
  spinner.evaluate((element) => element.style.getPropertyValue("--pull-spokes"));

test("the spokes appear whole, one by one, as the page is pulled", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 60 });

  expect(await readShownSpokes(spinner)).toBe("3");
  await expect(spinner).not.toHaveClass(/turning/);
  await release();
});

test("the spokes start turning once the pull is far enough, before letting go", async ({
  page,
}) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 200 });

  expect(await readShownSpokes(spinner)).toBe("8");
  await expect(spinner).toHaveClass(/turning/);
  await release();
});

test("a refresh quicker than the eye still shows the spokes turning a moment", async ({ page }) => {
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");
  // The page's clock otherwise keeps time with the test's, which would race the steps below.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  await pullDown(page, 200);

  await expect(spinner).toHaveClass(/turning/);
  await page.clock.runFor(SHORTEST_REFRESH_MS - 1);
  await expect(spinner).toBeVisible();
  await page.clock.runFor(1);
  await expect(spinner).toBeHidden();
});

test("the turning spokes step round, and slower under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openFromHomeScreen(page);
  await openApp(page);
  await openGames(page);
  const spinner = page.locator(".pull-refresh");

  const release = await drag(page, { x: 200, y: 40 }, { y: 200 });

  await expect(spinner).toHaveCSS("animation-name", "spokes-turn");
  await expect(spinner).toHaveCSS("animation-duration", "0.8s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-duration", "2.4s");
  await release();
});
