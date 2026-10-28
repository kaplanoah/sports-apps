import { CONTACT_VIEWS } from "../../../../tests/browser/contact-views.mjs";
import { expect, openApp, openGameSheet, keepHighlights } from "./harness.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

// A week of news with a card of each shape: one with a photo and stories under its lead, and one
// with neither.
/** @param {string} photoUrl */
const createStories = (photoUrl) =>
  [photoUrl, null].map((url, index) => ({
    id: `story-${index}`,
    url: `https://example.com/story-${index}`,
    title: "A report on the Dream's approach against the Liberty",
    summary: "What happened, in a sentence or two.",
    author: "A Writer",
    outlet: index ? "ESPN" : "The IX",
    source: index ? "espn" : "ix",
    publishedAt: `2026-09-30T1${4 - index}:00:00.000Z`,
    photo: url && { url, credit: "Getty Images" },
    teams: ["NYL", "ATL"],
  }));

const FINAL_WITH_HIGHLIGHTS = "Game details: Aces at Fever, First Round Game 2";

/**
 * Opens a final's Highlights, on a page opened with them.
 * @param {import("@playwright/test").Page} page
 */
export async function openHighlights(page) {
  const sheet = await openGameSheet(page, FINAL_WITH_HIGHLIGHTS);
  await sheet.getByRole("tab", { name: "Highlights" }).click();
}

/** @typedef {import("../../../../tests/browser/view-walk.mjs").View} View */

// The pages settings opens, in the order its rows list them.
export const SETTINGS_PAGES = ["Contact"];

/**
 * Each view, opened from the last, and what shows once it's drawn, in groups that each check
 * within a test's time.
 * @type {Record<string, View[]>}
 */
export const VIEW_GROUPS = {
  "the settings pages": [
    ...CONTACT_VIEWS,
    {
      name: "settings",
      open: (page) => page.getByRole("button", { name: "Settings", exact: true }).click(),
      shown: (page) => page.locator(`${SETTINGS} .appearance-row`),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
  "the page's tabs": [
    {
      name: "Bracket",
      open: (page) => openSeasonPart(page, "Bracket"),
      shown: (page) => page.locator('[data-series="1-0"] .team-line.won'),
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
      close: (page) => page.locator("#gameSearch").getByRole("button", { name: "Cancel" }).click(),
    },
    {
      name: "the search's suggestions and pages",
      open: async (page) => {
        await page.locator("#tab-search").click();
        await page.locator("#gameSearch .search-input").fill("Lib");
      },
      shown: (page) => page.locator("#gameSearch .search-games-line"),
      close: (page) => page.locator("#gameSearch").getByRole("button", { name: "Cancel" }).click(),
    },
    {
      name: "a search's games",
      open: async (page) => {
        await page.locator("#tab-search").click();
        await page.locator("#gameSearch .search-input").fill("Liberty");
        await page.locator("#gameSearch .search-input").press("Enter");
        await page.locator("#gameSearch .search-games-line").click();
      },
      shown: (page) => page.locator("#gameSearch .search-list .game-row").first(),
      close: (page) => page.locator("#gameSearch").getByRole("button", { name: "Cancel" }).click(),
    },
    {
      name: "Standings",
      open: (page) => openSeasonPart(page, "Standings"),
      shown: (page) => page.locator("#standings-league tr").nth(2),
    },
    {
      name: "News",
      open: (page) => page.getByRole("tab", { name: "News" }).click(),
      shown: (page) => page.locator(".news-more").first(),
    },
  ],
  "a team's and a player's sheets": [
    {
      name: "a team's sheet",
      open: async (page) => {
        await openSeasonPart(page, "Standings");
        await page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click();
      },
      shown: (page) => page.locator("#teamSheet table.players"),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a team's roster",
      open: async (page) => {
        await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
        await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
      },
      shown: (page) => page.locator("#rosterSection .roster-coach"),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a player's sheet",
      open: async (page) => {
        await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
        await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
        await page
          .locator("#rosterSection")
          .getByRole("button", { name: "Breanna Stewart" })
          .click();
      },
      shown: (page) => page.locator("#playerSheet .player-curve b").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "the sheet of a player who is out",
      open: async (page) => {
        await page.getByRole("button", { name: "Team details: New York Liberty" }).first().click();
        await page.locator("#teamSheet").getByRole("tab", { name: "Roster" }).click();
        await page
          .locator("#rosterSection")
          .getByRole("button", { name: "Elizabeth Balogun" })
          .click();
      },
      shown: (page) => page.locator("#playerSheet .out-box"),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
  "a game's sheets": [
    {
      name: "a final's box score",
      open: (page) => openGameSheet(page, FINAL_WITH_HIGHLIGHTS),
      shown: (page) => page.locator("#gameSheet .line-score"),
      close: (page) => page.keyboard.press("Escape"),
    },
    {
      name: "a final's Highlights",
      open: openHighlights,
      shown: (page) => page.locator("#highlightsBody .clip-row").first(),
      close: (page) => page.keyboard.press("Escape"),
    },
  ],
};

// Tonight's game, in its second quarter.
const LIVE_GAME = "1042600132";

/**
 * Opens the page in Maple with a live game, a week of news, and a final's highlights.
 * @param {import("@playwright/test").Page} page
 */
export async function openWithEverything(page) {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  await app.changeSeason((season) => {
    const game = season.games.find((each) => each.id === LIVE_GAME);
    Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
    Object.assign(game.away, { score: 30 });
    Object.assign(game.home, { score: 27 });
    return season;
  });
  await expect(page.locator(`[data-game="${LIVE_GAME}"] .game-status .clock`).first()).toHaveText(
    "Q2 5:10",
  );
  const [withPhoto, withoutPhoto] = createStories(new URL("icon-180.png", page.url()).href);
  await app.writeDocument("news/cards", {
    cards: [
      { lead: withPhoto, more: [withoutPhoto] },
      { lead: { ...withoutPhoto, id: "alone" }, more: [] },
    ],
  });
  await keepHighlights(page, app, FINAL_WITH_HIGHLIGHTS);
}
