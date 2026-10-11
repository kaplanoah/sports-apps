import { test, expect, openApp, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { measureStoredBytes, SAVED_COPY_BYTES } from "../../../../tests/browser/saved-copy.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

const holdPageCode = (page) => holdRequests(page, matchPath("/js/app.js"));

/** @param {import("@playwright/test").Page} page */
const findFinalWinner = (page) => page.locator('[data-series="1-0"] .team-line.won');

/**
 * @param {import("@playwright/test").Page} page
 * @param {Record<string, string>} items what the page's storage holds before it loads
 */
const storeBeforeLoad = (page, items) =>
  page.addInitScript((stored) => {
    for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  }, items);

test("a reload shows what the page last drew before its code arrives", async ({ page }) => {
  await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  const stamp = await page.locator("#stamp").textContent();
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#stamp")).toBeVisible();
  await expect(page.locator("#stamp")).toHaveText(stamp);
  await page.clock.runFor(4000);
  await expect(page.locator("#loadNote")).toHaveCount(0);
  release();
});

test("a saved part the page doesn't draw whole keeps the markup the page has", async ({ page }) => {
  await storeBeforeLoad(page, {
    lastDrawn: JSON.stringify({ "view-bracket": { markup: "<p>Old</p>", hidden: false } }),
  });

  await openApp(page);

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#view-bracket")).not.toContainText("Old");
});

test("saved markup that can't be read leaves the page to open as it would", async ({ page }) => {
  await storeBeforeLoad(page, { lastDrawn: "{not json", lastTab: "games" });

  await openApp(page);

  await expect(page.locator("#view-games")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a reload on the Games view shows the day it was on before the page's code arrives, and today after two minutes off the screen", async ({
    page,
  }) => {
    await storeBeforeLoad(page, { lastTab: "games" });
    await openApp(page, { isWholeSeason: true });
    const list = page.locator("#seasonGames .day-list");
    const today = page.locator("#seasonGames .game-day.is-today");
    const earlier = page.locator('#seasonGames .listed-day[data-day="2026-09-20"]');
    await expect(today).toBeInViewport();
    await page.locator('#seasonGames .day-cell[data-day="2026-09-20"]').click();
    await expect(earlier).toBeInViewport();
    const top = await list.evaluate((element) => element.scrollTop);
    let release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(earlier).toBeInViewport();
    expect(await list.evaluate((element) => element.scrollTop)).toBe(top);
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
      "data-day",
      "2026-09-20",
    );
    release();
    // The copy the page put back has already taken the load note away, so only the page's loading
    // says its code has run and is there to note when the page leaves the screen.
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(2 * 60_000);
    release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(today).toBeInViewport();
    await expect(earlier).not.toBeInViewport();
    release();
  });

  test("the copy a reload draws of a whole season fits in Safari's storage", async ({ page }) => {
    await storeBeforeLoad(page, { lastTab: "games" });
    await openApp(page, { isWholeSeason: true });
    await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();

    await page.reload();

    await expect(page.locator("#seasonGames .game-day.is-today")).toBeInViewport();
    expect(await measureStoredBytes(page)).toBeLessThan(SAVED_COPY_BYTES);
  });

  test("a reload after a save that didn't fit opens on today, not on the copy it couldn't replace", async ({
    page,
  }) => {
    await storeBeforeLoad(page, { lastTab: "games" });
    await openApp(page, { isWholeSeason: true });
    const today = page.locator("#seasonGames .game-day.is-today");
    const earlier = page.locator('#seasonGames .listed-day[data-day="2026-09-20"]');
    await page.locator('#seasonGames .day-cell[data-day="2026-09-20"]').click();
    await expect(earlier).toBeInViewport();
    await page.reload();
    await expect(earlier).toBeInViewport();
    await page.evaluate(() => {
      const { setItem } = Storage.prototype;
      Storage.prototype.setItem = function (key, value) {
        if (key === "lastDrawn") throw new DOMException("Full", "QuotaExceededError");
        setItem.call(this, key, value);
      };
    });
    await page.locator("#seasonGames .go-today").click();
    await expect(today).toBeInViewport();

    await page.reload();

    await expect(today).toBeInViewport();
    await expect(earlier).not.toBeInViewport();
  });

  test("a reload without the season the page last showed keeps the day the page put back, though the store's first answer lists only the playoffs' days", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("lastTab", "games");
      if (sessionStorage.getItem("dropLastSeen")) localStorage.removeItem("lastSeen");
    });
    await openApp(page, { isWholeSeason: true });
    const today = page.locator("#seasonGames .game-day.is-today");
    await expect(today).toBeInViewport();
    await page.evaluate(() => sessionStorage.setItem("dropLastSeen", "true"));

    await page.reload();

    await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
      "data-day",
      /^2026-05-/,
    );
    await expect(today).toBeInViewport();
    await expect(page.locator("#seasonGames .day-cell.is-chosen")).toHaveAttribute(
      "data-day",
      "2026-09-30",
    );
  });

  test("a reload after a night away follows the Games list's start day to today once the store says the game it opened on has ended", async ({
    page,
  }) => {
    await storeBeforeLoad(page, { lastTab: "games" });
    const app = await openApp(page, { isWholeSeason: true });
    await app.changeSeason((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "live", status: "Q4 0:40", period: 4, clock: "0:40" });
      return season;
    });
    const chosen = page.locator("#seasonGames .day-cell.is-chosen");
    await expect(page.locator('[data-game="1042600132"] .clock')).toHaveText("Q4 0:40");
    await expect(chosen).toHaveAttribute("data-day", "2026-09-30");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward("12:00:00");
    await app.changeSeasonWhileAway((season) => {
      const game = season.games.find((each) => each.id === "1042600132");
      Object.assign(game, { state: "final", status: "Final", period: 4, clock: "" });
      return season;
    });

    await page.reload();

    await expect(page.locator('[data-game="1042600132"] .game-status')).toContainText("Final");
    await expect(chosen).toHaveAttribute("data-day", "2026-10-01");
    await expect(page.locator('#seasonGames .listed-day[data-day="2026-10-01"]')).toBeInViewport();
  });

  test("the standings sit as far under their pill before the page's code arrives as after", async ({
    page,
  }) => {
    await storeBeforeLoad(page, { lastTab: "standings" });
    await openApp(page);
    const readGap = async () => {
      const pill = await page.locator("#standingsPager [role=tablist]").boundingBox();
      const table = await page.locator("#standingsPager table").first().boundingBox();
      return table.y - (pill.y + pill.height);
    };
    await expect(page.locator("#standingsPager table").first()).toBeVisible();
    const placedGap = await readGap();
    const release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(page.locator("#standingsPager table").first()).toBeVisible();
    expect(await readGap()).toBeCloseTo(placedGap, 0);
    release();
  });

  test("the tab bar's pill rests on the last tab before the page's code arrives, where the code keeps it", async ({
    page,
  }) => {
    await storeBeforeLoad(page, { lastTab: "games" });
    await openApp(page);
    const pill = page.locator(".tab-pill");
    await expect(page.locator("#view-games")).toBeVisible();
    const placed = await pill.boundingBox();
    const release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(page.locator("#view-games")).toBeVisible();
    const resting = await pill.boundingBox();
    expect(resting.x).toBeCloseTo(placed.x, 0);
    expect(resting.width).toBeCloseTo(placed.width, 0);
    release();
  });
});
