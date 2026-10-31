import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameInjuriesRequest } from "../worker/src/injuries.js";
import { createRosterServer } from "../worker/src/roster.js";
import {
  describeRoster,
  nameLeagueRosterRequest,
  namePlayerListRequest,
} from "../worker/src/adapters/roster.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";

// The league's rosters of the Liberty, Dream, Aces, Fever, and Wings this season and the Liberty's
// last, and its list of every player trimmed to theirs, as they were.
const ROSTERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-league-rosters.json`, "utf8"),
);
// ESPN's injury report, which says who is out and why.
const INJURIES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-espn-injuries.json`, "utf8"),
);
const NOW = Date.parse(ROSTERS.recordedAt);

/**
 * The answers to a team's reads for a season.
 * @param {string} team
 * @param {number} season
 */
const listAnswers = (team, season) => ({
  [nameLeagueRosterRequest(team, season)]: ROSTERS.rosters[`${team}:${season}`],
  [namePlayerListRequest(season)]: ROSTERS.playerList,
  [nameInjuriesRequest()]: INJURIES.report,
});

/** @param {Record<string, any>} answers */
function createFetch(answers) {
  /** @type {string[]} */
  const asked = [];
  /** @param {string} url */
  const fetchImpl = async (url) => {
    asked.push(url);
    return url in answers
      ? new Response(JSON.stringify(answers[url]))
      : new Response("Not found", { status: 404 });
  };
  return { fetchImpl, asked };
}

/**
 * @param {Record<string, any>} answers
 * @param {string} query
 */
async function askForRoster(answers, query) {
  const response = await createRosterServer({
    fetchImpl: createFetch(answers).fetchImpl,
    now: () => NOW,
  }).serveRoster(new URL(`https://wnba.test/roster?${query}`), async () => null);
  return { status: response.status, body: await response.json() };
}

/**
 * @param {any} roster
 * @param {string} lastName
 */
const findPlayer = (roster, lastName) =>
  roster.players.find((/** @type {any} */ player) => player.lastName === lastName);

test("a team's roster lists each player by the league's id, with her number, position, height, age, college or country, why she's out, and her first season, and the head coach", async () => {
  const { status, body } = await askForRoster(listAnswers("NYL", 2026), "team=NYL&season=2026");

  assert.equal(status, 200);
  assert.equal(body.team, "NYL");
  assert.equal(body.season, 2026);
  assert.equal(body.coach, "Chris DeMarco");
  assert.equal(body.players.length, 15);
  assert.deepEqual(findPlayer(body, "Stewart"), {
    id: "1627668",
    number: "30",
    firstName: "Breanna",
    lastName: "Stewart",
    position: "F",
    height: `6'4"`,
    age: 32,
    college: "Connecticut",
    country: "USA",
    out: null,
    debut: 2016,
  });
  assert.deepEqual(findPlayer(body, "Sabally").out, {
    reason: "Concussion",
    isForSeason: true,
    sentence: null,
    updated: "2026-10-11T18:00:00.000Z",
  });
  assert.deepEqual(findPlayer(body, "Balogun").out, {
    reason: "Not injury related",
    isForSeason: false,
    sentence: "Balogun (not with team) is out for Wednesday's game against the Dream.",
    updated: "2026-09-22T21:05:00.000Z",
  });
});

test("only the team's own players are out, matched by name to ESPN's report", async () => {
  const { body } = await askForRoster(listAnswers("IND", 2026), "team=IND&season=2026");
  assert.deepEqual(
    body.players
      .filter((/** @type {any} */ player) => player.out)
      .map((/** @type {any} */ player) => [player.lastName, player.out.reason]),
    [["Harris", "Left leg"]],
  );
});

test("a player who skipped college has her country, as the league lists every player's", async () => {
  const { body } = await askForRoster(listAnswers("NYL", 2026), "team=NYL&season=2026");

  assert.deepEqual(
    [findPlayer(body, "Astier").college, findPlayer(body, "Astier").country],
    [null, "France"],
  );
  assert.equal(findPlayer(body, "Astier").debut, 2026);
});

test("a past season's roster is that season's, with each player's age then, and no one out, since who is out is today's news", async () => {
  const { fetchImpl, asked } = createFetch(listAnswers("NYL", 2025));
  const response = await createRosterServer({ fetchImpl, now: () => NOW }).serveRoster(
    new URL("https://wnba.test/roster?team=NYL&season=2025"),
    async () => null,
  );
  const body = await response.json();

  assert.equal(body.season, 2025);
  assert.ok(body.players.length > 0);
  assert.ok(body.players.every((/** @type {any} */ player) => !player.out));
  assert.equal(findPlayer(body, "Ionescu").age, 27);
  assert.ok(!asked.includes(nameInjuriesRequest()));
});

test("today's roster still shows when ESPN doesn't answer, with no one out", async () => {
  /** @type {Record<string, any>} */
  const answers = listAnswers("NYL", 2026);
  delete answers[nameInjuriesRequest()];

  const { status, body } = await askForRoster(answers, "team=NYL&season=2026");

  assert.equal(status, 200);
  assert.equal(body.players.length, 15);
  assert.ok(body.players.every((/** @type {any} */ player) => !player.out));
});

test("a roster asked for no team or no real season, or one the league doesn't answer, says why", async () => {
  assert.deepEqual(await askForRoster(listAnswers("NYL", 2026), "team=XYZ"), {
    status: 400,
    body: { error: { code: "invalid_argument", message: "team must name a WNBA team" } },
  });
  await assertErrorAnswer(
    await askForRoster(listAnswers("NYL", 2026), "team=NYL&season=1990"),
    400,
    "invalid_argument",
  );
  const failed = await askForRoster({}, "team=NYL&season=2026");
  assert.match(
    await assertErrorAnswer(failed, 502, "upstream_error"),
    /^Couldn't read the WNBA: The WNBA answered 404/,
  );
});

test("a roster read again soon reuses the one just read", async () => {
  const { fetchImpl, asked } = createFetch(listAnswers("NYL", 2026));
  const server = createRosterServer({ fetchImpl, now: () => NOW });
  await server.loadRoster("NYL:2026");
  const reads = asked.length;
  await server.loadRoster("NYL:2026");
  assert.equal(asked.length, reads);
});

test("a player the list doesn't have yet keeps her roster name, with no college, country, or first season", () => {
  const described = describeRoster({
    onPlayerFailure: () => {},
    team: "NYL",
    season: 2026,
    leagueRoster: ROSTERS.rosters["NYL:2026"],
    playerList: { resultSets: [{ name: "PlayerIndex", headers: ["PERSON_ID"], rowSet: [] }] },
    outPlayers: [],
    now: NOW,
  });
  const stewart = findPlayer(described, "Stewart");
  assert.deepEqual(
    [stewart.firstName, stewart.college, stewart.country, stewart.debut],
    ["Breanna", null, null, null],
  );
});
