import { test, expect } from "./harness.mjs";
import {
  ON_A_PHONE,
  PLAYER_INDEX,
  findGamesLine,
  findInput,
  findLine,
  findRows,
  findSearch,
  openSeasonGames,
  readTopDay,
  sendSearch,
  tapSearch,
} from "./search-page.mjs";
import { drag } from "../../../../tests/browser/touch.mjs";
import { expectShown } from "../../../../tests/browser/sheet-row.mjs";
import { listTapsOffButtons } from "../../../../tests/browser/tap-states.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listChipsOffCenter } from "../../../../tests/browser/chip-centering.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import {
  findSeasonPill,
  findSeasonTab,
  openSeasonPart,
} from "../../../../tests/browser/season-tab.mjs";
import { SETTINGS } from "../../../../tests/browser/settings.mjs";

// What Search finds and opens, on a phone.

test.use({ ...ON_A_PHONE, contextOptions: { reducedMotion: "reduce" } });

// Phosphor's film-strip at its Regular weight.
const FILM_STRIP =
  "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,88h80v80H40Zm96-16V56h32V72Zm-16,0H88V56h32Zm0,112v16H88V184Zm16,0h32v16H136Zm0-16V88h80v80Zm80-96H184V56h32ZM72,56V72H40V56ZM40,184H72v16H40Zm176,16H184V184h32v16Z";

/**
 * Checks that what the search shows keeps to its type roles and its periods, and that every tap
 * lands on a button.
 * @param {import("@playwright/test").Page} page
 */
async function expectReadableSearch(page) {
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listChipsOffCenter(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
  expect(await listTapsOffButtons(page)).toEqual([]);
}

/**
 * Whether Search's icon takes the app's accent, and what its circle draws inside it.
 * @param {import("@playwright/test").Page} page
 */
const readSearchTabLook = (page) =>
  page.locator("#tab-search").evaluate((tab) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      isAccent: getComputedStyle(tab).color === accent,
      inside: getComputedStyle(tab, "::before").content,
    };
  });

test("Search beside the tab bar opens its own view, an empty field ready to type with examples under it, its icon in the accent, and hides the bar's pill", async ({
  page,
}) => {
  await openSeasonGames(page);

  await tapSearch(page);

  await expect(page.locator("#view-search")).toBeVisible();
  await expect(page.locator("#view-games")).toBeHidden();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tabBar")).toHaveClass(/is-unselected/);
  await expect(page.locator("#tabBar .tab-pill")).toBeHidden();
  expect(await readSearchTabLook(page)).toEqual({ isAccent: true, inside: "none" });
  await expect(findInput(page)).toBeFocused();
  await expect(findInput(page)).toHaveValue("");
  await expect(findInput(page)).toHaveAttribute("placeholder", "Teams, players, and games");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .search-example")).toHaveText([
    "Dream at Valkyries",
    "Aces in New York",
    "Games this weekend",
    "Stewart",
    "Aces roster",
  ]);

  await openSeasonPart(page, "Standings");

  await expect(page.locator("#tabBar")).not.toHaveClass(/is-unselected/);
  await expect(page.locator("#tabBar .tab-pill")).toBeVisible();
  await expect(page.locator("#tab-search")).toHaveAttribute("aria-selected", "false");
  expect((await readSearchTabLook(page)).isAccent).toBe(false);
});

test("Search is the last of the Views tabs, which the arrow keys move through", async ({
  page,
}) => {
  await openSeasonGames(page);
  const tabs = page.getByRole("tablist", { name: "Views" }).getByRole("tab");
  await expect(tabs).toHaveCount(4);
  for (const [index, name] of ["Games", "News", "Search"].entries())
    await expect(tabs.nth(index + 1)).toHaveAccessibleName(name);

  await tabs.nth(2).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(3)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(3).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
});

test("the Games tab has no Search of its own", async ({ page }) => {
  await openSeasonGames(page);
  await expect(page.locator("#view-games .go-search")).toHaveCount(0);
});

test("an example tapped runs its search and puts the keyboard away", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await page.locator("#gameSearch .search-example", { hasText: "Dream at Valkyries" }).tap();

  await expect(findInput(page)).toHaveValue("Dream at Valkyries");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Dream @ Valkyries•2 games");
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(2);
});

test("while words are typed, two whole searches, then the team's pages in place of its name, then its games line sit over its games from today, and a suggestion tapped runs its search", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Lib");

  await expect(findRows(page)).toHaveText([
    "Liberty next game",
    "Liberty playoffs",
    "New York Liberty26-18",
    "RosterNew York Liberty",
  ]);
  await expect(findRows(page).first().locator(".search-typed")).toHaveText("Lib");
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");
  await expect(findLine(page)).toBeHidden();
  await expect(page.locator("#gameSearch .listed-day").first()).toHaveAttribute(
    "data-day",
    "2026-10-04",
  );

  await page.locator("#gameSearch .search-suggestion", { hasText: "Liberty next game" }).tap();

  await expect(findInput(page)).toHaveValue("Liberty next game");
  await expect(findInput(page)).not.toBeFocused();
  await expect(findLine(page)).toHaveText("Liberty•Next game");
});

test("a sent team shows its pages over its games line, which opens its games alone on the first from today, and a tap on the field brings back what typing showed", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty");

  await expect(findInput(page)).not.toBeFocused();
  await expect(findRows(page)).toHaveText(["New York Liberty26-18", "RosterNew York Liberty"]);
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");

  await findGamesLine(page).tap();

  await expect(findRows(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
  await expect(page.locator("#gameSearch .search-bar")).toHaveClass(/stuck/);

  await findInput(page).tap();

  await expect(findRows(page).first()).toHaveText("Liberty next game");
  await expect(findRows(page).filter({ hasText: "New York Liberty" })).toHaveCount(2);
  await expect(findGamesLine(page)).toBeVisible();
});

test("while typing, the rows start just under the field, and the games line, reaching from the line above to just past the first game's border, opens the games it read with its words in the field, a half-typed team's finished", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await findInput(page).pressSequentially("Lib");
  await expect(findGamesLine(page)).toHaveText("Liberty•52 games");

  const edges = await page.evaluate(() => {
    const readBox = (/** @type {string} */ selector) =>
      /** @type {Element} */ (document.querySelector(selector)).getBoundingClientRect();
    const line = readBox("#gameSearch .search-games-line");
    const rows = [...document.querySelectorAll("#gameSearch .search-suggestions li")];
    return {
      firstRow:
        readBox("#gameSearch .search-suggestion").top - readBox("#gameSearch .search-input").bottom,
      lineTop: line.top - /** @type {Element} */ (rows.at(-1)).getBoundingClientRect().bottom,
      lineBottom: line.bottom - readBox("#gameSearch .listed-day").top,
    };
  });
  expect(edges.firstRow).toBeCloseTo(2.2, 1);
  expect(edges.lineTop).toBeCloseTo(0, 1);
  expect(edges.lineBottom).toBeCloseTo(1.5, 1);

  await findGamesLine(page).tap();

  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findLine(page)).toHaveText("Liberty•52 games");
  await expect.poll(() => readTopDay(page)).toBe("2026-10-04");
});

test("the Search key finishes a half-typed team, as the line read it while typing", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Lib");

  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findRows(page)).toHaveText(["New York Liberty26-18", "RosterNew York Liberty"]);
  await expect(findGamesLine(page)).toHaveText("Liberty\u202252 games");
});

test("words that ask only for games go straight to them, and one whose games are all past rests at its end", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty Dream");

  await expect(findRows(page)).toHaveCount(0);
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(findLine(page)).toHaveText("Liberty vs Dream•3 games");
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-06-11"]')).toBeInViewport();
  await expect(page.locator('#gameSearch .listed-day[data-day="2026-09-23"]')).toBeInViewport();
});

test("a city finds the games played there, with its team's games as another reading", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "New York");

  await expect(findRows(page)).toHaveText([
    "New York Liberty26-18",
    "RosterNew York Liberty",
    "Liberty52 games",
  ]);
  await expect(findGamesLine(page)).toHaveText("In New York\u202226 games");
  await expect(findRows(page).last().locator(".search-caret")).toHaveCount(0);

  await findRows(page).last().tap();

  await expect(findInput(page)).toHaveValue("Liberty");
  await expect(findGamesLine(page)).toHaveText("Liberty\u202252 games");
});

test("while typing, a finger dragging the list puts the keyboard away and leaves what typing showed", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await findInput(page).pressSequentially("Lib");
  await expect(findGamesLine(page)).toBeVisible();
  await expect(findInput(page)).toBeFocused();

  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await page.locator("#gameSearch .listed-day").first().boundingBox()
  );
  const lift = await drag(page, { x: box.x + box.width / 2, y: box.y + 10 }, { y: -120 });
  await lift();

  await expect(findInput(page)).not.toBeFocused();
  await expect(findInput(page)).toHaveValue("Lib");
  await expect(findGamesLine(page)).toHaveText("Liberty\u202252 games");
});

test("while typing, a team's first two letters suggest it but list none of its games, and its third lists them", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Li");

  await expect(findRows(page).first()).toContainText("Liberty");
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);

  await findInput(page).pressSequentially("b");

  await expect(findGamesLine(page)).toHaveText("Liberty\u202252 games");
});

test("while typing, a word that reads as nothing yet lists no games", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("zq");

  await expect(page.locator("#gameSearch .empty-note")).toBeAttached();
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);
  await expect(findLine(page)).toBeHidden();
});

test("a search that finds nothing says so, and a word it can't use is named", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty in March");

  await expect(findLine(page)).toHaveText("Liberty•March•No games");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText("No Liberty games in March");

  await sendSearch(page, "Liberty fireworks");

  await expect(findLine(page)).toHaveText("Liberty•52 games•'fireworks' unrecognized, skipped");

  await sendSearch(page, "highest 3p%");

  await expect(findLine(page)).toHaveText("No results•'highest' and '3p' unrecognized, skipped");
  await expect(page.locator("#gameSearch .empty-note")).toHaveText(
    "Check the spelling or try a new search",
  );
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);
});

test("a team's row opens its sheet, and its Roster row the sheet on its Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty");

  await findSearch(page).getByRole("button", { name: "New York Liberty 26-18", exact: true }).tap();

  await expect(page.locator("#teamTitle")).toHaveText("New York Liberty");
  await expectShown(page.locator("#teamSection"));
  await page.keyboard.press("Escape");

  await findRows(page).filter({ hasText: "Roster" }).tap();

  await expect(page.locator("#teamTitle")).toHaveText("New York Liberty");
  await expectShown(page.locator("#rosterSection"));
});

test("a half-typed name finds the player, with her number and team and no games, and her row opens her sheet over her team's Roster", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await findInput(page).pressSequentially("Stew");

  await expect(findRows(page)).toHaveText(["Breanna Stewart30•Liberty"]);
  await expect(findGamesLine(page)).toHaveCount(0);
  await expect(page.locator("#gameSearch .listed-day")).toHaveCount(0);

  await findRows(page).tap();

  const sheet = page.locator("#playerSheet");
  await expect(sheet.locator("#playerTitle")).toHaveText("Breanna Stewart");
  await sheet.getByRole("button", { name: "Back to Team" }).click();
  await expectShown(page.locator("#rosterSection"));
});

test("while typing, a team's name and a number list the players whose numbers it starts, over the suggestions", async ({
  page,
}) => {
  const app = await openSeasonGames(page);
  await app.writeDocument("player-index/2026", {
    season: 2026,
    players: [
      { id: "1641656", team: "GSV", number: "1", firstName: "Gabby", lastName: "Williams" },
      { id: "1641695", team: "GSV", number: "11", firstName: "Ashten", lastName: "Prechtel" },
    ],
  });
  await tapSearch(page);

  await findInput(page).pressSequentially("valkyries 1");

  await expect(findRows(page)).toHaveText([
    "Gabby Williams1•Valkyries",
    "Ashten Prechtel11•Valkyries",
    "valkyries 1st Round",
  ]);
});

test("a standings list's words find it, and its row opens the standings at that list", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "standings");

  await expect(findRows(page)).toHaveText(["StandingsLeague", "StandingsEast", "StandingsWest"]);

  await findRows(page).filter({ hasText: "East" }).tap();

  await expect(findSeasonPill(page).getByRole("tab", { name: "Standings" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#standings-east")).toBeInViewport();
  const pillBottom = await findSeasonPill(page).evaluate(
    (pill) => pill.closest(".pager-bar").getBoundingClientRect().bottom,
  );
  const eastTop = await page
    .locator("#standings-east")
    .evaluate((list) => list.getBoundingClientRect().top);
  expect(Math.abs(eastTop - pillBottom)).toBeLessThanOrEqual(1);
});

test("highlights with a team finds its latest final, marked with a film strip, and its row opens that game's sheet on its Highlights", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "Liberty highlights");

  await expect(findRows(page)).toHaveText(["HighlightsLynx at Liberty\u2022Yesterday"]);
  await expect(findRows(page).locator(".search-mark path")).toHaveAttribute("d", FILM_STRIP);
  await expect(findGamesLine(page)).toHaveCount(0);

  await findRows(page).tap();

  await expect(page.locator("#gameSheet")).toBeVisible();
  await expect(page.locator("#gameTabHighlights")).toHaveAttribute("aria-selected", "true");
});

test("the Bracket tab's words find it, and its row opens it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "bracket");

  await expect(findRows(page)).toHaveText(["Bracket"]);

  await findRows(page).tap();

  await expect(page.locator("#bracketWrap")).toBeVisible();
  await expect(findSeasonTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(findSeasonPill(page).getByRole("tab", { name: "Bracket" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("a setting's words find it, and its row opens settings with the setting in sight", async ({
  page,
}) => {
  await openSeasonGames(page);
  await tapSearch(page);

  await sendSearch(page, "dark mode");

  await expect(findRows(page)).toHaveText(["SettingsAppearance"]);

  await findRows(page).tap();

  await expect(page.locator(SETTINGS)).toBeVisible();
  await expect(page.locator("#appearanceTitle")).toBeInViewport();
});

test("a found game's row opens its sheet wherever a finger lands on it", async ({ page }) => {
  await openSeasonGames(page);
  await tapSearch(page);
  await sendSearch(page, "Liberty Dream");
  const row = page.locator('#gameSearch .listed-day[data-day="2026-09-23"] .game-row');
  await expect(row).toBeInViewport();
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (
    await row.boundingBox()
  );
  const landing = { x: box.x + 30, y: box.y + box.height / 2 };
  const found = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.className ?? null,
    landing,
  );
  expect(found).toBe("game-open");

  await page.touchscreen.tap(landing.x, landing.y);

  await expect(page.locator("#gameSheet")).toBeVisible();
});

test("every search state keeps to its type roles and its periods, and every tap lands on a button", async ({
  page,
}) => {
  await openSeasonGames(page);
  const expectReadable = () => expectReadableSearch(page);
  await expectReadable();

  await tapSearch(page);
  await expect(page.locator("#gameSearch .search-example").first()).toBeVisible();
  await expectReadable();

  await findInput(page).pressSequentially("Dream in");
  await expect(findRows(page).first()).toBeVisible();
  await expectReadable();

  await sendSearch(page, "New York");
  await expect(findGamesLine(page)).toBeVisible();
  await expectReadable();

  await findGamesLine(page).tap();
  await expect(findGamesLine(page)).toHaveCount(0);
  await expectReadable();

  await sendSearch(page, "Stewart");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "settings");
  await expect(findRows(page).first()).toBeVisible();
  await expectReadable();

  await sendSearch(page, "highlights");
  await expect(findRows(page)).toHaveCount(1);
  await expectReadable();

  await sendSearch(page, "Liberty in March");
  await expect(page.locator("#gameSearch .empty-note")).toBeVisible();
  await expectReadable();
});

test("who's out lists each player out with why, a team its record, a team's news its stories as they arrive, each a link to it, and a channel its games, each answer saying what it lists in the line under the field", async ({
  page,
}) => {
  const app = await openSeasonGames(page);
  await app.writeDocument("player-index/2026", {
    ...PLAYER_INDEX,
    players: PLAYER_INDEX.players.map((player) => ({
      ...player,
      out: player.lastName === "Wilson" ? { reason: "Left ankle", isForSeason: false } : null,
    })),
  });
  await tapSearch(page);

  await sendSearch(page, "who is out");
  await expect(findRows(page)).toHaveCount(1);
  await expect(findRows(page)).toContainText("Wilson");
  await expect(findRows(page)).toContainText("Left ankle");
  await expect(findLine(page)).toHaveText(/^Who's out\W+1 player$/);
  await expectReadableSearch(page);

  await sendSearch(page, "Liberty record");
  await expect(findRows(page).first()).toContainText("New York Liberty");
  await expect(findRows(page).first().locator(".search-detail")).toHaveText(/^\d+-\d+$/);

  await sendSearch(page, "Liberty news");
  await expect(findRows(page)).toHaveCount(1);
  await expect(findRows(page).first()).toContainText("News");
  await expect(findRows(page).first()).toContainText("Liberty");
  await expect(findLine(page)).toHaveText(/^Liberty\W+News\W+No stories$/);
  await app.writeDocument("news/cards", {
    cards: [
      {
        lead: {
          id: "liberty",
          url: "https://example.com/liberty",
          title: "The Liberty rest their starters",
          summary: "",
          author: "",
          outlet: "ESPN",
          source: "espn",
          publishedAt: "2026-09-30T14:00:00.000Z",
          photo: null,
          teams: ["NYL"],
        },
        more: [],
      },
    ],
  });
  await expect(findRows(page)).toHaveCount(2);
  await expect(findLine(page)).toHaveText(/^Liberty\W+News\W+1 story$/);
  const story = findRows(page).nth(1);
  await expect(story).toContainText("The Liberty rest their starters");
  await expect(story).toHaveAttribute("href", "https://example.com/liberty");
  await expect(story).toHaveAttribute("target", "_blank");
  await expectReadableSearch(page);

  await sendSearch(page, "on ESPN");
  await expect(findLine(page)).toContainText("On ESPN");
  await expect(page.locator("#gameSearch .search-list .game-row").first()).toBeVisible();
  await expectReadableSearch(page);
});

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test("Search is a tab beside the others, named in words", async ({ page }) => {
    await openSeasonGames(page);
    const search = page.getByRole("tab", { name: "Search" });
    await expect(search).toBeVisible();
    await expect(search).toHaveText("Search");

    await search.click();

    await expect(search).toHaveAttribute("aria-selected", "true");
    await expect(findInput(page)).toBeFocused();
  });
});
