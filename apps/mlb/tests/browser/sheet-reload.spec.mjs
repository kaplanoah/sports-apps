import {
  test,
  expect,
  openApp,
  buildFixtureSnapshot,
  matchPath,
  BOX_SCORES,
  BROADCASTS_FIXTURE,
  PITCHER_SIDES,
  PLAYER_DOCS,
  ROSTER_DOCS,
} from "./harness.mjs";
import { openMatchup } from "./open-game-sheet.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { openSeasonPart } from "../../../../tests/browser/season-tab.mjs";

test.use({ contextOptions: { reducedMotion: "reduce" } });

// What a sheet reads from the Worker beside the season, which a reload reads again.
const SHEET_READS = [
  "/box-score",
  "/highlights",
  "/pitcher",
  "/rotation",
  "/store/rosters/",
  "/store/players/",
];

/**
 * Opens a final's sheet from the Games view, on the October day the Worker has its box score.
 * @param {import("@playwright/test").Page} page
 * @param {string} game
 */
async function openFinal(page, game) {
  await openApp(page, {
    now: BROADCASTS_FIXTURE.now,
    snapshots: { 2026: buildFixtureSnapshot(BROADCASTS_FIXTURE) },
    boxScores: BOX_SCORES,
  });
  await page.getByRole("tab", { name: "Games" }).click();
  await page
    .locator("#seasonGames")
    .getByRole("button", { name: new RegExp(`^Game details: ${game}`) })
    .click();
  const sheet = page.locator("#gameSheet");
  await expect(sheet.locator(".line-score")).toBeVisible();
  return sheet;
}

/**
 * Opens the Guardians' Roster, with every recorded player and starter the store keeps.
 * @param {import("@playwright/test").Page} page
 */
async function openGuardiansRoster(page) {
  await openApp(page, { store: { ...ROSTER_DOCS, ...PLAYER_DOCS }, pitchers: PITCHER_SIDES });
  await openSeasonPart(page, "Standings");
  await page.locator('.div-grid tr[data-team="CLE"] .team-open').click();
  const sheet = page.locator("#teamSheet");
  await sheet.getByRole("tab", { name: "Roster" }).click();
  await expect(sheet.locator("#rosterBody .box-name").first()).toHaveText("Jo Adell");
  return sheet;
}

// Each sheet, opened on what it reads from the Worker, and the read a reload starts again. A sheet
// the page holds joins this list, or the test that checks the list fails.
const SHEETS = [
  {
    id: "gameSheet",
    name: "a final's box score",
    read: "/box-score",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await openFinal(page, "Brewers at Padres, Tue, Oct 6");
    },
  },
  {
    id: "gameSheet",
    name: "a final's Highlights",
    read: "/highlights",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      const sheet = await openFinal(page, "Brewers at Padres, Tue, Oct 6");
      await sheet.getByRole("tab", { name: "Highlights" }).click();
      await expect(sheet.locator("#highlightsBody .clip-row")).toHaveCount(15);
    },
  },
  {
    id: "gameSheet",
    name: "a game's matchup",
    read: "/pitcher",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      const sheet = await openMatchup(page);
      await expect(sheet.locator(".pitch-mix")).toHaveCount(2);
    },
  },
  {
    id: "teamSheet",
    name: "a club's roster",
    read: "/store/rosters/",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      await openGuardiansRoster(page);
    },
  },
  {
    id: "playerSheet",
    name: "a player's numbers",
    read: "/store/players/",
    open: async (/** @type {import("@playwright/test").Page} */ page) => {
      const sheet = await openGuardiansRoster(page);
      await sheet.getByRole("button", { name: "Steven Kwan" }).click();
      await expect(page.locator("#playerSheet .player-curve svg")).toHaveCount(10);
    },
  },
];

/**
 * What the sheet shows, its sections each on its own line.
 * @param {import("@playwright/test").Page} page
 * @param {string} id
 */
const readSheetText = (page, id) =>
  page.locator(`#${id}`).evaluate((sheet) => /** @type {HTMLElement} */ (sheet).innerText);

test("every sheet is on the list of sheets a reload draws again", async ({ page }) => {
  await openApp(page);
  const ids = await page
    .locator(".sheet-page")
    .evaluateAll((sheets) => sheets.map((sheet) => sheet.id));
  expect(ids.toSorted()).toEqual([...new Set(SHEETS.map(({ id }) => id))].toSorted());
});

for (const { id, name, read, open } of SHEETS)
  test(`a reload draws ${name} as it was while it reads it again, never placeholders`, async ({
    page,
  }) => {
    await open(page);
    const before = await readSheetText(page, id);
    const releases = await Promise.all(
      SHEET_READS.map((path) => holdRequests(page, matchPath(path))),
    );
    const reread = page.waitForRequest(matchPath(read));

    await page.reload();
    await reread;

    await expect(page.locator(`#${id} .placeholder`)).toHaveCount(0);
    expect(await readSheetText(page, id)).toBe(before);
    for (const release of releases) release();
  });
