import { finishSemifinals, showFirstRoundFinished } from "./bracket-rounds.mjs";
import { test, expect, openApp, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { measureStoredBytes, SAVED_COPY_BYTES } from "../../../../tests/browser/saved-copy.mjs";
import { findSeasonPill, findSeasonTab } from "../../../../tests/browser/season-tab.mjs";
import { waitForLoadToSettle } from "../../../../tests/browser/at-rest.mjs";
import {
  holdHeaderStill,
  readPillHoldTop,
  readSeasonPartScroll,
  readSeasonRide,
  scrollSeasonPartToEnd,
} from "../../../../tests/browser/season-scroll.mjs";
import {
  MINUTE_MS,
  SHORT_PHONE,
  expectNewsAfterReloads,
  expectOpeningRoundAfterReload,
  expectSeasonTabAfterReload,
} from "../../../../tests/browser/start-over.mjs";
import { setHidden } from "../../../../tests/browser/visibility.mjs";
import { findRows, sendSearch, tapSearch } from "./search-page.mjs";

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
    lastDrawn: JSON.stringify({
      "view-bracket-standings": { markup: "<p>Old</p>", hidden: false },
    }),
  });

  await openApp(page);

  await expect(findFinalWinner(page)).toContainText("Liberty");
  await expect(page.locator("#view-bracket-standings")).not.toContainText("Old");
});

test("a reload puts back the colors a part's code gave it, but nothing else in its style, before its code arrives", async ({
  page,
}) => {
  await openApp(page);
  await expect(findFinalWinner(page)).toContainText("Liberty");
  await storeBeforeLoad(page, {
    lastDrawn: JSON.stringify({
      gameBody: {
        markup: "",
        hidden: false,
        style: "--away-light: #123456; position: relative; top: 56px; --home-light: #654321;",
      },
    }),
  });
  const release = await holdPageCode(page);

  await page.reload({ waitUntil: "commit" });

  const body = page.locator("#gameBody");
  await expect(body).toHaveCSS("top", "auto");
  expect(
    await body.evaluate((element) =>
      ["--away-light", "--home-light"].map((name) =>
        getComputedStyle(element).getPropertyValue(name).trim(),
      ),
    ),
  ).toEqual(["#123456", "#654321"]);
  release();
});

test("saved markup that can't be read leaves the page to open as it would", async ({ page }) => {
  await storeBeforeLoad(page, { lastDrawn: "{not json", lastTab: "games" });

  await openApp(page);

  await expect(page.locator("#view-games")).toBeVisible();
});

test("a search put back from an earlier release, with Clear in the field's label, is drawn again with Clear beside it", async ({
  page,
}) => {
  await storeBeforeLoad(page, {
    lastDrawn: JSON.stringify({
      gameSearch: {
        markup: `<div class="day-bar search-bar is-empty"><form class="search-row" role="search"><label class="search-field"><input type="search" class="search-input" value=""><button type="button" class="search-clear" aria-label="Clear" hidden></button></label><button type="button" class="search-cancel">Cancel</button></form><p class="search-read"></p></div><div class="day-list search-list"></div>`,
        hidden: true,
      },
    }),
  });

  await openApp(page);

  const search = page.locator("#gameSearch");
  await expect(search.locator("label .search-input")).toHaveCount(1);
  await expect(search.locator("label button")).toHaveCount(0);
  await expect(search.locator(".search-field > .search-clear")).toHaveCount(1);
});

test("a search put back open from an earlier release keeps its words and Clear when it's drawn again", async ({
  page,
}) => {
  await storeBeforeLoad(page, {
    lastDrawn: JSON.stringify({
      gameSearch: {
        markup: `<div class="day-bar search-bar"><form class="search-row" role="search"><label class="search-field"><input type="search" class="search-input" value="liberty"><button type="button" class="search-clear" aria-label="Clear"></button></label><button type="button" class="search-cancel">Cancel</button></form><p class="search-read"></p></div><div class="day-list search-list"></div>`,
        hidden: false,
      },
    }),
  });

  await openApp(page);

  const search = page.locator("#gameSearch");
  await expect(search.locator(".search-label .search-input")).toHaveValue("liberty");
  await expect(search.locator(".search-field > .search-clear")).not.toHaveAttribute("hidden");
  await expect(search.locator('.search-read[role="status"]')).toHaveCount(1);
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
    await setHidden(page, true);
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
    await setHidden(page, true);
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

  test("the tab's name, its pill on the part last chosen, and the standings under it, as far down as after, show before the page's code arrives", async ({
    page,
  }) => {
    await openApp(page);
    await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();
    const readGap = async () => {
      const pill = await findSeasonPill(page).boundingBox();
      const table = await page.locator("#standingsWrap table").first().boundingBox();
      return table.y - (pill.y + pill.height);
    };
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    const placedGap = await readGap();
    const release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(findSeasonTab(page)).toHaveAccessibleName("Bracket");
    await expect(findSeasonPill(page).getByRole("tab", { name: "Standings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await expect(page.locator("#bracketWrap")).toBeHidden();
    expect(await readGap()).toBeCloseTo(placedGap, 0);
    release();
  });

  test("the standings show as far down as they were left, with the header gone and the pill held at the top in its line, before the page's code arrives, and stay there once it runs", async ({
    page,
  }) => {
    await openApp(page);
    await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await scrollSeasonPartToEnd(page, "standings");
    const left = await readSeasonPartScroll(page, "standings");
    const pill = page.locator("#bracketStandingsPill");
    const release = await holdPageCode(page);

    await page.reload({ waitUntil: "commit" });

    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await expect.poll(() => readSeasonPartScroll(page, "standings")).toBe(left);
    await expect
      .poll(() => readSeasonRide(page))
      .toMatchObject({ pillTop: await readPillHoldTop(page) });
    await expect(pill).toHaveClass(/\bstuck\b/);
    // Only the page's code keeps when it was last current, so once that's back its code has drawn.
    await page.evaluate(() => localStorage.removeItem("syncedAt"));
    release();
    await page.waitForLoadState("domcontentloaded");
    await waitForLoadToSettle(page);
    expect(await readSeasonPartScroll(page, "standings")).toBe(left);
    expect(await readSeasonRide(page)).toMatchObject({ pillTop: await readPillHoldTop(page) });
    await expect(pill).toHaveClass(/\bstuck\b/);
  });

  /**
   * Leaves the standings far down, then the page from the Games tab, twice, the second time without
   * the standings shown since the first reload, and checks the standings show there again once
   * their tab shows.
   * @param {import("@playwright/test").Page} page
   */
  async function expectStandingsBackAfterReloadsFromGames(page) {
    await openApp(page);
    await findSeasonPill(page).getByRole("tab", { name: "Standings" }).click();
    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await scrollSeasonPartToEnd(page, "standings");
    const left = await readSeasonPartScroll(page, "standings");
    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#view-games")).toBeVisible();

    await page.reload();
    await expect(page.locator("#view-games")).toBeVisible();
    await page.reload();
    await expect(page.locator("#view-games")).toBeVisible();
    await findSeasonTab(page).click();

    await expect(page.locator("#standingsWrap table").first()).toBeVisible();
    await expect.poll(() => readSeasonPartScroll(page, "standings")).toBe(left);
  }

  test("the standings left far down show there again after reloads the page left from another tab, once their tab shows", async ({
    page,
  }) => {
    await expectStandingsBackAfterReloadsFromGames(page);
  });

  test("where the header stays put, the standings left far down show there again after reloads the page left from another tab, once their tab shows", async ({
    page,
  }) => {
    await holdHeaderStill(page);
    await expectStandingsBackAfterReloadsFromGames(page);
  });

  test("search's Bracket row opens the bracket at its top after a reload the page left from another tab with the bracket scrolled down", async ({
    page,
  }) => {
    // A screen short enough for the bracket to scroll.
    await page.setViewportSize({ width: 390, height: 480 });
    await openApp(page);
    await expect(page.locator("#bracketWrap .bracket")).toBeVisible();
    await scrollSeasonPartToEnd(page, "bracket");
    expect(await readSeasonPartScroll(page, "bracket")).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Games" }).click();
    await expect(page.locator("#view-games")).toBeVisible();
    await page.reload();
    await expect(page.locator("#view-games")).toBeVisible();
    await tapSearch(page);

    await sendSearch(page, "bracket");
    await findRows(page).filter({ hasText: "Bracket" }).first().tap();

    await expect(page.locator("#bracketWrap .round-name").first()).toBeInViewport();
    await expect.poll(() => readSeasonPartScroll(page, "bracket")).toBe(0);
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

  test.describe("on a short phone", () => {
    test.use({ viewport: SHORT_PHONE });

    const SIDEWAYS = "#bracketWrap .bracket";

    test("a reload two minutes or more after the page left starts the season tab over, on the part it's named for, each part at its top with the header back and the bracket on its opening round, before the page's code arrives and once it runs", async ({
      page,
    }) => {
      const app = await openApp(page);
      await showFirstRoundFinished(page, app);
      await expectSeasonTabAfterReload(page, { sideways: SIDEWAYS, awayMs: 2 * MINUTE_MS });
    });

    test("a reload two minutes or more after the page left opens the bracket on the round still playing, though another was when the page left, even once the page's saved season can't be read", async ({
      page,
    }) => {
      const app = await openApp(page);
      await showFirstRoundFinished(page, app);
      await expectOpeningRoundAfterReload(page, {
        sideways: SIDEWAYS,
        changeWhileAway: () => app.changeSeason(finishSemifinals),
      });
    });

    test("a reload under two minutes after the page left shows the season tab where it was left, the bracket sideways too", async ({
      page,
    }) => {
      await openApp(page);
      await expectSeasonTabAfterReload(page, { sideways: SIDEWAYS, awayMs: MINUTE_MS });
    });

    test("a reload shows News where it was left under two minutes after the page left, and at its top after two", async ({
      page,
    }) => {
      const app = await openApp(page);
      await expectNewsAfterReloads(page, app.writeDocument);
    });
  });
});
