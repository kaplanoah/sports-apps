import { expect, openApp, openGameSheet, keepHighlights } from "./harness.mjs";

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

/** Each view, opened from the last, and what shows once it's drawn. */
const VIEWS = [
  {
    name: "Bracket",
    open: (page) => page.getByRole("tab", { name: "Bracket" }).click(),
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
    open: (page) => page.getByRole("tab", { name: "Standings" }).click(),
    shown: (page) => page.locator("#standings-league tr").nth(2),
  },
  {
    name: "a team's sheet",
    open: (page) =>
      page.getByRole("button", { name: "Team details: Minnesota Lynx" }).first().click(),
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
      await page.locator("#rosterSection").getByRole("button", { name: "Breanna Stewart" }).click();
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
  {
    name: "a final's Highlights",
    open: async (page) => {
      const sheet = await openGameSheet(page, FINAL_WITH_HIGHLIGHTS);
      await sheet.getByRole("tab", { name: "Highlights" }).click();
    },
    shown: (page) => page.locator("#highlightsBody .clip-row").first(),
    close: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "News",
    open: (page) => page.getByRole("tab", { name: "News" }).click(),
    shown: (page) => page.locator(".news-more").first(),
  },
  {
    name: "settings",
    open: (page) => page.getByRole("button", { name: "Settings", exact: true }).click(),
    shown: (page) => page.locator("#settingsDialog .appearance-row"),
    close: (page) => page.keyboard.press("Escape"),
  },
];

/**
 * Opens the page in Maple with a week of news and a final's highlights.
 * @param {import("@playwright/test").Page} page
 */
export async function openWithNews(page) {
  await page.emulateMedia({ colorScheme: "light" });
  const app = await openApp(page);
  const [withPhoto, withoutPhoto] = createStories(new URL("icon-180.png", page.url()).href);
  await app.writeDocument("news/cards", {
    cards: [
      { lead: withPhoto, more: [withoutPhoto] },
      { lead: { ...withoutPhoto, id: "alone" }, more: [] },
    ],
  });
  await keepHighlights(page, app, FINAL_WITH_HIGHLIGHTS);
}

/**
 * Opens each view in turn, checks it once it's drawn, and closes it.
 * @param {import("@playwright/test").Page} page
 * @param {(view: (typeof VIEWS)[number]) => Promise<void>} checkView
 */
export async function checkEachView(page, checkView) {
  for (const view of VIEWS) {
    await view.open(page);
    await expect(view.shown(page)).toBeVisible();
    // Past the tab bar's pill sliding to the tab, and any other motion, before the page is read.
    await page.clock.runFor(2000);
    await checkView(view);
    if (view.close) {
      await view.close(page);
      await expect(view.shown(page)).toBeHidden();
    }
  }
}
