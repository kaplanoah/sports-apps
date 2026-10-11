import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPlayerServer,
  describeRanks,
  describeRegularSeason,
  nameGameLogRequest,
  nameTeamGameLogRequest,
  nameTotalsRequest,
} from "../worker/src/player.js";
import { nameInjuriesRequest } from "../worker/src/injuries.js";
import {
  createRosterServer,
  nameLeagueRosterRequest,
  namePlayerListRequest,
} from "../worker/src/roster.js";
import { readTable } from "../worker/src/wnba.js";
import { addTurnovers } from "./player-fixtures.js";

// Every player's totals, every team's games, and the game logs of a few players, as the league
// answered the morning after the Liberty's last game, beside the rosters recorded that morning.
const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);
const ROSTERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-league-rosters.json`, "utf8"),
);
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);
const NOW = Date.parse(ROSTERS.recordedAt);
const STEWART = "1627668";
const SABALLY = "1630149";
const FIEBICH = "1630142";
const BALOGUN = "1641663";
const IONESCU = "1629477";
// Where Stewart's stand-in turnovers rank from the fewest among the 125 ranked players.
const TURNOVERS_RANK = 100;

// The current season's feeds carry turnovers, and the past season's are as the fixture recorded
// them, without.
const CURRENT = 2026;
/**
 * @param {number} season
 * @param {any} answer
 */
const withSeasonColumns = (season, answer) => (season === CURRENT ? addTurnovers(answer) : answer);

function listAnswers() {
  /** @type {Record<string, any>} */
  const answers = {};
  for (const [season, totals] of Object.entries(PLAYERS.totals))
    answers[nameTotalsRequest(Number(season))] = withSeasonColumns(Number(season), totals);
  for (const [key, games] of Object.entries(PLAYERS.teamGames)) {
    const [season, seasonType] = key.split(":");
    answers[nameTeamGameLogRequest(Number(season), seasonType)] = games;
  }
  for (const [key, games] of Object.entries(PLAYERS.gameLogs)) {
    const [id, season, seasonType] = key.split(":");
    answers[nameGameLogRequest(Number(season), seasonType, id)] = withSeasonColumns(
      Number(season),
      games,
    );
  }
  for (const [key, roster] of Object.entries(ROSTERS.rosters)) {
    const [team, season] = key.split(":");
    answers[nameLeagueRosterRequest(team, Number(season))] = roster;
    answers[namePlayerListRequest(Number(season))] = ROSTERS.playerList;
  }
  answers[nameInjuriesRequest()] = INJURIES.report;
  return answers;
}

/**
 * @param {Record<string, any>} answers
 * @param {string} query
 */
async function askForPlayer(answers, query) {
  /** @param {string} url */
  const fetchImpl = async (url) =>
    url in answers
      ? new Response(JSON.stringify(answers[url]))
      : new Response("Not found", { status: 404 });
  const now = () => NOW;
  const rosters = createRosterServer({ fetchImpl, now });
  const response = await createPlayerServer({
    loadRoster: rosters.loadRoster,
    fetchImpl,
    now,
  }).servePlayer(new URL(`https://wnba.test/player?${query}`));
  return { status: response.status, body: await response.json() };
}

/**
 * Each ranked stat as its key, her rank, and how many are ranked.
 * @param {any} regularSeason
 */
const listRanks = (regularSeason) =>
  regularSeason.stats.map((/** @type {any} */ stat) => [stat.key, stat.rank, stat.count]);

test("a player's sheet has her facts from her roster, her last game with its score, and her points in each playoff game", async () => {
  const { status, body } = await askForPlayer(listAnswers(), `id=${STEWART}&team=NYL&season=2026`);

  assert.equal(status, 200);
  assert.deepEqual([body.firstName, body.lastName], ["Breanna", "Stewart"]);
  assert.deepEqual(
    [body.facts.number, body.facts.college, body.facts.age],
    ["30", "Connecticut", 32],
  );
  assert.deepEqual(body.lastGame, {
    gameId: "1042600201",
    day: "2026-10-04",
    isPlayoffs: true,
    isWin: false,
    teamScore: 82,
    opponentScore: 92,
    points: 19,
    rebounds: 2,
    assists: 3,
    minutes: 40,
    steals: 3,
    blocks: 3,
    turnovers: 2,
    fieldGoalsMade: 6,
    fieldGoalsAttempted: 13,
    threesMade: 1,
    threesAttempted: 3,
    freeThrowsMade: 6,
    freeThrowsAttempted: 6,
  });
  assert.deepEqual(body.playoffPoints, { 1042600101: 34, 1042600102: 21, 1042600201: 19 });
});

test("her regular season has her averages and her rank in each stat among the players who meet the WNBA's rule for its leaders, with each of their numbers from the lowest", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${STEWART}&team=NYL&season=2026`);
  const season = body.regularSeason;

  assert.deepEqual([season.games, season.gamesNeeded], [42, 31]);
  assert.equal(season.averages.points.toFixed(1), "20.8");
  assert.deepEqual(listRanks(season), [
    ["points", 7, 125],
    ["rebounds", 10, 125],
    ["assists", 26, 125],
    ["steals", 18, 125],
    ["blocks", 9, 125],
    ["turnovers", TURNOVERS_RANK, 125],
    ["fieldGoalShare", 28, 71],
    ["threeShare", 76, 76],
    ["freeThrowShare", 27, 68],
  ]);
  const points = season.stats[0];
  assert.equal(points.values.length, 125);
  assert.ok(
    points.values.every(
      (/** @type {number} */ value, /** @type {number} */ index) =>
        index === 0 || value >= points.values[index - 1],
    ),
  );
});

test("her turnovers rank from the fewest, among the same players as her other averages", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${STEWART}&team=NYL&season=2026`);
  const turnovers = body.regularSeason.stats.find(
    (/** @type {any} */ stat) => stat.key === "turnovers",
  );

  assert.equal(turnovers.value.toFixed(2), "2.29");
  const fewer = turnovers.values.filter(
    (/** @type {number} */ each) => each < turnovers.value - 0.001,
  );
  assert.equal(turnovers.rank, 1 + fewer.length);
});

test("a season saved before the store kept turnovers shows none, and its other stats as before", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${IONESCU}&team=NYL&season=2025`);

  assert.equal(body.lastGame.turnovers, undefined);
  assert.ok(body.regularSeason.stats.every((/** @type {any} */ stat) => stat.key !== "turnovers"));
  assert.equal(body.regularSeason.stats.length, 8);
});

test("a player short of the rule's games has no rank, but where she made enough shots for a percentage", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${FIEBICH}&team=NYL&season=2026`);

  assert.equal(body.regularSeason.games, 21);
  assert.deepEqual(
    listRanks(body.regularSeason).filter(([, rank]) => rank !== null),
    [["threeShare", 7, 76]],
  );
});

test("part way through a season the rule asks for its share of the games the most played team has played", () => {
  const teamGames = structuredClone(PLAYERS.teamGames["2026:Regular Season"]);
  const table = teamGames.resultSets[0];
  const dateColumn = table.headers.indexOf("GAME_DATE");
  table.rowSet = table.rowSet.filter((/** @type {any[]} */ row) => row[dateColumn] < "2026-07-01");
  const stewart = readTable(PLAYERS.totals[2026], "LeagueDashPlayerStats").find(
    (row) => String(row.PLAYER_ID) === STEWART,
  );
  const before = describeRegularSeason(
    stewart,
    describeRanks(PLAYERS.totals[2026], PLAYERS.teamGames["2026:Regular Season"]),
  );
  const midway = describeRegularSeason(stewart, describeRanks(PLAYERS.totals[2026], teamGames));

  assert.ok(midway && before);
  assert.ok(midway.gamesNeeded < before.gamesNeeded);
  assert.ok(midway.stats[0].count > before.stats[0].count);
});

test("a player whose team made the playoffs without her has her last regular season game", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${SABALLY}&team=NYL&season=2026`);

  assert.deepEqual(
    [
      body.lastGame.day,
      body.lastGame.isPlayoffs,
      body.lastGame.teamScore,
      body.lastGame.opponentScore,
    ],
    ["2026-06-23", false, 87, 76],
  );
  assert.deepEqual(body.playoffPoints, {});
});

test("a player who hasn't played has her facts and no games", async () => {
  const { status, body } = await askForPlayer(listAnswers(), `id=${BALOGUN}&team=NYL&season=2026`);

  assert.equal(status, 200);
  assert.deepEqual([body.lastName, body.facts.college], ["Balogun", "Duke"]);
  assert.deepEqual([body.lastGame, body.regularSeason], [null, null]);
});

test("a past season's sheet has that season's roster, games, and ranks", async () => {
  const { body } = await askForPlayer(listAnswers(), `id=${IONESCU}&team=NYL&season=2025`);

  assert.deepEqual([body.season, body.facts.age, body.lastGame.day], [2025, 27, "2025-09-19"]);
  assert.equal(body.regularSeason.games, 38);
});

test("a player asked for with no id, team, or real season, or one the league doesn't know or answer, says why", async () => {
  const answers = listAnswers();
  assert.deepEqual(await askForPlayer(answers, "id=abc&team=NYL"), {
    status: 400,
    body: { error: "id must be a player's number in the WNBA's stats" },
  });
  assert.equal((await askForPlayer(answers, `id=${STEWART}&team=XYZ`)).status, 400);
  assert.equal((await askForPlayer(answers, `id=${STEWART}&team=NYL&season=1990`)).status, 400);
  const unknown = { ...answers };
  for (const seasonType of ["Regular Season", "Playoffs"])
    unknown[nameGameLogRequest(2026, seasonType, "1")] =
      PLAYERS.gameLogs[`${BALOGUN}:2026:Playoffs`];
  assert.equal((await askForPlayer(unknown, "id=1&team=NYL&season=2026")).status, 404);
  const failed = await askForPlayer({}, `id=${STEWART}&team=NYL&season=2026`);
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /^Couldn't read the WNBA: The WNBA answered 404/);
});
