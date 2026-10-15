import { test, expect, openApp, openGameSheet, findGameButton, matchPath } from "./harness.mjs";
import { holdRequests } from "../../../../tests/browser/hold-requests.mjs";
import { listLowContrastText } from "../../../../tests/browser/contrast.mjs";
import { listTextOffRoles } from "../../../../tests/browser/type-roles.mjs";
import { listStrayPeriods } from "../../../../tests/browser/stray-periods.mjs";
import { describeBoxScore } from "../../worker/src/box-score.js";
import {
  ACES_AT_FEVER,
  FEVER_AT_ACES,
  VALKYRIES_AT_WINGS,
  startValkyriesAtWings,
  liveBoxScore,
  countBoxScoreReads,
} from "./game-sheet-games.mjs";

const POLL_LIVE_MS = 15 * 1000;

// These tests are about what a sheet shows, so they skip the eased scrolling between the Games
// lists.
test.use({ contextOptions: { reducedMotion: "reduce" } });

/** @param {import("@playwright/test").Page} page */
const holdBoxScores = (page) => holdRequests(page, matchPath("/box-score"));

/** @param {import("@playwright/test").Page} page */
function countLeadReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/lead") reads.count += 1;
  });
  return reads;
}

test("a live game's sheet reads its box score and lead once, then takes what the Worker pushes", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const boxScoreReads = countBoxScoreReads(page);
  const leadReads = countLeadReads(page);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".lead-chart")).toBeVisible();
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");

  await page.clock.runFor(POLL_LIVE_MS * 2);
  expect([boxScoreReads.count, leadReads.count]).toEqual([1, 1]);

  const boxScore = describeBoxScore(liveBoxScore);
  boxScore.away.players[0].points = 41;
  boxScore.away.score += 2;
  await app.saveGameDetails("1042600112", { boxScore, lead: null });
  await expect(sheet.locator("table.players")).toContainText("41");
  await expect(sheet.locator(".lead-chart")).toBeVisible();
});

test("details saved before the sheet's own read don't take a live box score back", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const earlier = describeBoxScore(liveBoxScore);
  earlier.away.players[0].points = 41;
  earlier.away.score -= 10;
  await app.saveGameDetails("1042600112", { boxScore: earlier, lead: null });

  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");
  await page.clock.runFor(POLL_LIVE_MS);

  await expect(sheet.locator("table.players")).not.toContainText("41");
});

test("a live game's sheet shows its game as it goes, and stops watching it once it closes", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  await app.changeSeason(startValkyriesAtWings);
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);

  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
  await expect(sheet.locator(".faceoff-side.home .bonus")).toHaveText("Bonus");
  await expect(sheet.locator(".line-score th.now")).toHaveText("3");
  await expect(sheet.locator(".sheet-part-head", { hasText: "Team stats" })).toContainText(
    "So far",
  );
  await expect(sheet.locator(".foul-chip")).toHaveText([
    "Fouled out",
    "Fouled out",
    "5 fouls",
    "4 fouls",
  ]);
  await expect.poll(() => app.listWatchedPaths()).toContain("games/1042600112");

  await app.changeSeason((season) => {
    season.games.find((each) => each.id === "1042600112").away.score = 77;
    return season;
  });
  await expect(sheet.locator(".faceoff .score")).toHaveText(/77\s*72/);

  await sheet.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => app.listWatchedPaths()).not.toContain("games/1042600112");
});

test("a game that hasn't started previews the meetings, the season stats, and the leading scorers", async ({
  page,
}) => {
  await openApp(page);
  const sheet = await openGameSheet(page, FEVER_AT_ACES);

  await expect(sheet.getByRole("heading", { level: 2 })).toHaveText("First Round Game 3");
  await expect(sheet.locator(".faceoff .time")).toHaveText(/^9:00\sPM$/);
  await expect(sheet.locator(".sheet-part-head").first()).toHaveText(
    /Meetings\s*Fever won the season series 2-1/,
  );
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".meetings li").first()).toHaveText(/Aug 6\s*Aces\s*86-84\s*at Fever/);
  await expect(sheet.locator(".tape-label")).toHaveText([
    "Record",
    "PPG",
    "Opp PPG",
    "Margin",
    /^Road\s+Home$/,
    "Last 10",
  ]);
  await expect(sheet.locator(".tape-note")).toHaveCount(0);
  await expect(sheet.locator(".players tbody tr:not(.players-head)").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );
});

test("a sheet open on a preview switches to the box score once the game starts", async ({
  page,
}) => {
  const app = await openApp(page, { league: { boxScores: { 1042600112: liveBoxScore } } });
  const sheet = await openGameSheet(page, VALKYRIES_AT_WINGS);
  await expect(sheet.locator(".meetings")).toBeVisible();

  await app.changeSeason(startValkyriesAtWings);

  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect(sheet.locator(".meetings")).toHaveCount(0);
  await expect(sheet.locator(".faceoff .clock")).toHaveText("Q3 4:32");
});

test("a game the league has no box score for says so, and a preview whose meetings can't load shows the rest", async ({
  page,
}) => {
  await openApp(page, { league: { isScheduleRefused: true } });
  const sheet = await openGameSheet(page, "Game details: Fever at Aces, First Round Game 1");
  await expect(sheet.locator(".sheet-message")).toHaveText(
    "The league hasn't posted a box score for this game yet",
  );
  await expect(sheet.locator("#gameSection [data-retry]")).toHaveCount(0);
  expect(await listStrayPeriods(page)).toEqual([]);
  await sheet.getByRole("button", { name: "Close" }).click();

  const preview = await openGameSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".retry-message")).toHaveText(
    "Couldn't load this season's meetings",
  );
  await expect(preview.locator(".tape-label")).toHaveCount(6);
  await expect(preview.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a preview's meetings that didn't load read again on a tap on Try again, holding their shape meanwhile", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 502, json: { error: "test" } });
  await page.route(matchPath("/preview"), refuse);
  const preview = await openGameSheet(page, FEVER_AT_ACES);
  const meetings = preview.locator(".sheet-part").first();
  await expect(meetings.locator(".retry-message")).toHaveText(
    "Couldn't load this season's meetings",
  );

  await page.unroute(matchPath("/preview"), refuse);
  const release = await holdRequests(page, matchPath("/preview"));
  await meetings.getByRole("button", { name: "Try again" }).click();
  await expect(meetings.locator(".placeholder").first()).toBeVisible();
  await expect(preview.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  release();
  await expect(preview.locator(".meetings li")).toHaveCount(3);
});

test("a final's box score and a preview's meetings open from what the store keeps, with the league down", async ({
  page,
}) => {
  await openApp(page, { isLeagueDownForPage: true });

  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await sheet.getByRole("button", { name: "Close" }).click();

  const preview = await openGameSheet(page, FEVER_AT_ACES);
  await expect(preview.locator(".meetings li")).toHaveCount(3);
  await expect(preview.locator(".meetings li").first()).toHaveText(
    /Aug 6\s*Aces\s*86-84\s*at Fever/,
  );
});

test("a preview takes the season stats and leading scorers from the store as it changes", async ({
  page,
}) => {
  const app = await openApp(page);
  const sheet = await openGameSheet(page, FEVER_AT_ACES);
  await expect(sheet.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);

  await app.changeSeason((season) => ({ ...season, leaders: [] }));

  await expect(sheet.locator(".sheet-message")).toHaveText("Couldn't load the players' averages");
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  expect(await listStrayPeriods(page)).toEqual([]);

  await app.changeSeason((season) => ({ ...season, standings: [] }));

  await expect(sheet.locator(".sheet-message")).toHaveText([
    "Couldn't load the standings",
    "Couldn't load the players' averages",
  ]);
  expect(await listStrayPeriods(page)).toEqual([]);
});

test("a box score the Worker can't load says so over Try again, which holds the box score's shape as it reads it again", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) =>
    route.fulfill({ status: 502, json: { error: "Couldn't read the WNBA: test" } });
  await page.route(matchPath("/box-score"), refuse);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const block = sheet.locator("#gameBody .retry-block");
  await expect(block.locator(".retry-title")).toHaveText("The server had a problem");
  await expect(block.locator(".retry-next")).toHaveText("Try again to load box score");
  expect(await listTextOffRoles(page)).toEqual([]);
  expect(await listLowContrastText(page)).toEqual([]);
  expect(await listStrayPeriods(page)).toEqual([]);

  await page.unroute(matchPath("/box-score"), refuse);
  const release = await holdBoxScores(page);
  await block.getByRole("button", { name: "Try again" }).click();
  await expect(sheet.locator("#gameBody .placeholder").first()).toBeVisible();
  release();
  await expect(sheet.locator(".line-score")).toBeVisible();
  await expect(block).toHaveCount(0);
});

test("a box score that didn't load reads again as the phone comes back online", async ({
  page,
}) => {
  await openApp(page);
  /** @param {import("@playwright/test").Route} route */
  const refuse = (route) => route.fulfill({ status: 502, json: { error: "test" } });
  await page.route(matchPath("/box-score"), refuse);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  await expect(sheet.locator("#gameBody .retry-block")).toBeVisible();

  await page.unroute(matchPath("/box-score"), refuse);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(sheet.locator(".line-score")).toBeVisible();
});

test("while its box score loads, the sheet holds the box score's shape, then fills it in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdBoxScores(page);
  const sheet = await openGameSheet(page, ACES_AT_FEVER);
  const body = sheet.locator("#gameBody");

  await expect(body).toHaveAttribute("aria-busy", "true");
  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "By quarter",
    "Team stats",
    "Top scorers",
  ]);
  await expect(sheet.locator(".tape-label")).toHaveCount(8);
  await expect(sheet.locator(".line-score tbody th")).toHaveText(["Aces", "Fever"]);
  await expect(sheet.locator(".players tbody tr:not(.players-head)")).toHaveCount(10);
  await expect(sheet.locator(".tape-value .placeholder")).toHaveCount(16);

  release();
  await expect(sheet.locator(".line-score tbody tr").first()).toHaveText(
    /Aces\s*26\s*17\s*17\s*29\s*89/,
  );
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
  await expect(body).toHaveAttribute("aria-busy", "false");
});

test("while its meetings load, the sheet holds their shape, with the season stats and leading scorers already in", async ({
  page,
}) => {
  await openApp(page);
  const release = await holdRequests(page, matchPath("/preview"));
  const sheet = await openGameSheet(page, FEVER_AT_ACES);

  await expect(sheet.locator(".sheet-part-head h3")).toHaveText([
    "Meetings",
    "Season stats",
    "Leading scorers",
  ]);
  await expect(sheet.locator(".meetings .placeholder")).toHaveCount(9);
  await expect(sheet.locator(".placeholder")).toHaveCount(9);
  await expect(sheet.locator(".tape-label")).toHaveCount(6);
  await expect(sheet.locator(".players tbody tr:not(.players-head)").first()).toHaveText(
    /Kelsey Mitchell\s*24\.7\s*1\.7\s*2\.8/,
  );

  release();
  await expect(sheet.locator(".meetings li")).toHaveCount(3);
  await expect(sheet.locator(".placeholder")).toHaveCount(0);
});

test("a finger coming down on a game starts reading its box score, and the sheet the tap opens uses that read", async ({
  page,
}) => {
  await openApp(page);
  const reads = countBoxScoreReads(page);
  const button = await findGameButton(page, ACES_AT_FEVER);

  await button.dispatchEvent("pointerdown");
  await expect.poll(() => reads.count).toBe(1);

  await button.click();
  await expect(page.locator("#gameSheet .line-score")).toBeVisible();
  expect(reads.count).toBe(1);
});
