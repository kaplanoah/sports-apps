import {
  expect,
  openApp,
  openSettings,
  buildSnapshotWithStarters,
  LIVE_BOX_SCORE,
  MATCHUP_STARTERS,
  PITCHER_SIDES,
  PLAYER_DOCS,
  RECORDED_HIGHLIGHTS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

// Highlights for a final on the evening's slate, Brewers at Phillies, as MLB cut them for another.
const SEP_23_HIGHLIGHTS = {
  823410: { ...RECORDED_HIGHLIGHTS["849826"], id: "823410" },
};

// News with a card that has a story under its lead, and one alone.
const NEWS_STORIES = [0, 1].map((index) => ({
  id: `story-${index}`,
  url: `https://example.com/story-${index}`,
  title: "A report on the Mets' rotation for the stretch",
  summary: "What happened, in a sentence or two.",
  author: "A Writer",
  outlet: index ? "ESPN" : "The Athletic",
  source: index ? "espn" : "athletic",
  publishedAt: `2026-09-24T1${4 - index}:00:00.000Z`,
  photo: null,
  teams: ["NYM"],
}));
const NEWS_DOCS = {
  "news/cards": {
    cards: [
      { lead: NEWS_STORIES[0], more: [NEWS_STORIES[1]] },
      { lead: { ...NEWS_STORIES[1], id: "alone" }, more: [] },
    ],
  },
};

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} club
 */
async function openRoster(page, club) {
  await openSeasonPart(page, "Standings");
  await page.locator(`.div-grid tr[data-team="${club}"] .team-open`).click();
  await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {string} day
 * @param {RegExp} game
 */
async function openGame(page, day, game) {
  await page.getByRole("tab", { name: "Games" }).click();
  await page.locator(`#seasonGames .day-cell[data-day="${day}"]`).click();
  await page.getByRole("button", { name: game }).click();
}

/**
 * Opens the Highlights of a final on the evening's slate, on a page opened with them.
 * @param {import("@playwright/test").Page} page
 */
export async function openHighlights(page) {
  await openGame(page, "2026-09-23", /^Game details: Brewers at Phillies, Wed, Sep 23/);
  await page.locator("#gameSheet").getByRole("tab", { name: "Highlights" }).click();
}

/**
 * @typedef {{
 *   name: string,
 *   open: (page: import("@playwright/test").Page) => Promise<unknown>,
 *   shown: (page: import("@playwright/test").Page) => import("@playwright/test").Locator,
 *   close?: (page: import("@playwright/test").Page) => Promise<unknown>,
 * }} View
 */

/**
 * Each view, opened from the last, and what shows once it's drawn, in groups that each check
 * within a test's time.
 * @type {Record<string, View[]>}
 */
export const VIEW_GROUPS = {
  "the page's tabs": [
    {
      name: "Bracket",
      open: (page) => openSeasonPart(page, "Bracket"),
      shown: (page) => page.locator("#bracketWrap .card-note").first(),
    },
    {
      name: "Games",
      open: (page) => page.getByRole("tab", { name: "Games" }).click(),
      shown: (page) => page.locator("#seasonGames .game-day.is-today .game-row").first(),
    },
    {
      name: "Search",
      open: (page) => page.locator("#tab-search").click(),
      shown: (page) => page.locator("#gameSearch .search-example").first(),
      close: (page) => page.locator("#gameSearch button.search-cancel").click(),
    },
    {
      name: "a search's games",
      open: async (page) => {
        await page.locator("#tab-search").click();
        await page.locator("#gameSearch .search-input").fill("Mets");
        await page.locator("#gameSearch .search-input").press("Enter");
      },
      shown: (page) => page.locator("#gameSearch .game-row").first(),
      close: (page) => page.locator("#gameSearch button.search-cancel").click(),
    },
    {
      name: "Standings",
      open: (page) => openSeasonPart(page, "Standings"),
      shown: (page) => page.locator("table.st tbody tr").first(),
    },
    {
      name: "News",
      open: (page) => page.getByRole("tab", { name: "News" }).click(),
      shown: (page) => page.locator(".news-more-title").first(),
    },
    {
      name: "settings",
      open: (page) => openSettings(page),
      shown: (page) => page.locator(`${SETTINGS} .appearance-row`),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
  "a game's sheets": [
    {
      name: "a game's sheet",
      open: (page) =>
        openGame(page, "2026-09-24", /^Game details: Astros at Athletics, Thu, Sep 24/),
      shown: (page) => page.locator("#gameSheet .meetings li").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a game's Matchup",
      open: async (page) => {
        await openGame(page, "2026-09-24", /^Game details: Astros at Athletics, Thu, Sep 24/);
        await page.locator("#gameSheet").getByRole("tab", { name: "Matchup" }).click();
      },
      shown: (page) => page.locator("#matchupBody .tape-dot").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a live game's Runs so far",
      open: (page) => openGame(page, "2026-09-24", /^Game details: Rays at Yankees, Thu, Sep 24/),
      shown: (page) => page.locator("#gameSheet .runs-field"),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a final's Highlights",
      open: openHighlights,
      shown: (page) => page.locator("#highlightsBody .clip-row").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
  "a club's and a player's sheets": [
    {
      name: "a club's sheet",
      open: async (page) => {
        await openSeasonPart(page, "Standings");
        await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
      },
      shown: (page) => page.locator("#teamSheet .leader-stat").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a club's roster",
      open: (page) => openRoster(page, "CLE"),
      shown: (page) => page.locator("#rosterBody .box-table").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a hitter's sheet",
      open: async (page) => {
        await openRoster(page, "CLE");
        await page.locator("#rosterBody").getByRole("button", { name: "Steven Kwan" }).click();
      },
      shown: (page) => page.locator("#playerBody .player-curve").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "the sheet of a player on the injured list",
      open: async (page) => {
        await openRoster(page, "LAD");
        await page.locator("#rosterBody").getByRole("button", { name: "Blake Treinen" }).click();
      },
      shown: (page) => page.locator("#playerBody .out-sentence"),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a starter's sheet",
      open: async (page) => {
        await openRoster(page, "CLE");
        await page.locator("#rosterBody").getByRole("button", { name: "Tanner Bibee" }).click();
      },
      shown: (page) => page.locator("#playerBody .pitch-usage").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
};

// Rays at Yankees, being played that evening, with someone on base.
const LIVE_BOX_SCORES = { 823493: { ...LIVE_BOX_SCORE, id: "823493" } };

/**
 * Opens the page in Ball with news, a club's roster and players, a live game's box score, a
 * final's highlights, and the season's whole schedule, once it has drawn the schedule's first day.
 * @param {import("@playwright/test").Page} page
 */
export async function openWithEverything(page) {
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, {
    snapshots: { 2026: buildSnapshotWithStarters() },
    store: { ...ROSTER_DOCS, ...PLAYER_DOCS, ...NEWS_DOCS },
    pitchers: { ...PITCHER_SIDES, ...MATCHUP_STARTERS },
    highlights: SEP_23_HIGHLIGHTS,
    boxScores: LIVE_BOX_SCORES,
    isWholeSeason: true,
  });
  // The schedule draws the Games strip's dates again, which would move a date out from under a tap.
  await expect(page.locator("#seasonGames .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-03-25",
  );
}

/**
 * Opens each view in turn, checks it once it's drawn, and closes it.
 * @param {import("@playwright/test").Page} page
 * @param {View[]} views
 * @param {(view: View) => Promise<void>} checkView
 */
export async function checkEachView(page, views, checkView) {
  for (const view of views) {
    await view.open(page);
    await expect(view.shown(page)).toBeVisible();
    await checkView(view);
    if (view.close) {
      await view.close(page);
      await expect(view.shown(page)).toBeHidden();
    }
  }
}
