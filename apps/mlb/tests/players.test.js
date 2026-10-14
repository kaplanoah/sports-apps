import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeHitters,
  describeLastGames,
  describePlayer,
  indexPeople,
  listGameLogRequest,
  listPeopleRequest,
} from "../worker/src/players.js";
import {
  indexSeasonStats,
  listRosterRequest,
  listSeasonStatsRequest,
} from "../worker/src/rosters.js";

// What MLB answered early on Oct 8: the Guardians' and Dodgers' 40-man rosters, their players'
// seasons, the hitters MLB ranks, and the players' facts.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-08-rosters.json`, "utf8"),
);
const { season, answers } = FIXTURE;
const NUMBERS = {
  hitting: indexSeasonStats(answers[listSeasonStatsRequest(season, "hitting")]),
  pitching: indexSeasonStats(answers[listSeasonStatsRequest(season, "pitching")]),
  postseasonHitting: indexSeasonStats(
    answers[listSeasonStatsRequest(season, "hitting", { gameType: "P" })],
  ),
  postseasonPitching: indexSeasonStats(
    answers[listSeasonStatsRequest(season, "pitching", { gameType: "P" })],
  ),
};
const PEOPLE = indexPeople(answers[listPeopleRequest(season)]);

/**
 * @param {number} mlbTeamId
 * @param {string} club
 * @param {string} name
 */
function describeRostered(mlbTeamId, club, name) {
  const entry = answers[listRosterRequest(mlbTeamId, season)].roster.find(
    (/** @type {any} */ each) => each.person.fullName === name,
  );
  return describePlayer({ ...NUMBERS, entry, club, season, person: PEOPLE.get(entry.person.id) });
}

test("a hitter's sheet has his facts, and his regular season and postseason at the plate", () => {
  const kwan = describeRostered(114, "CLE", "Steven Kwan");

  assert.deepEqual(
    { id: kwan.id, club: kwan.club, name: kwan.name, number: kwan.number, position: kwan.position },
    { id: 680757, club: "CLE", name: "Steven Kwan", number: "38", position: "LF" },
  );
  assert.deepEqual(kwan.facts, {
    bats: "L",
    throws: "L",
    age: 29,
    height: `5'8"`,
    weight: 170,
    debut: 2022,
    birthplace: "Los Gatos, CA",
  });
  assert.equal(kwan.hitting?.hits, 152);
  assert.equal(kwan.hitting?.obp, ".382");
  assert.equal(kwan.postseasonHitting?.gamesPlayed, 3);
  assert.equal(kwan.pitching, null);
  assert.equal(kwan.postseasonPitching, null);
});

test("a two-way player's sheet has his seasons at the plate and on the mound, and one born abroad names his country", () => {
  const ohtani = describeRostered(119, "LAD", "Shohei Ohtani");
  assert.equal(ohtani.facts?.birthplace, "Oshu, Japan");
  assert.ok(ohtani.hitting && ohtani.pitching);
  assert.equal(ohtani.pitching?.gamesStarted, 14);
});

test("a player MLB's list doesn't have yet has no facts", () => {
  const entry = answers[listRosterRequest(114, season)].roster[0];
  const player = describePlayer({ ...NUMBERS, entry, club: "CLE", season, person: null });
  assert.equal(player.facts, null);
});

test("the ranked hitters each have the numbers a sheet ranks, walks and strikeouts as shares of plate appearances", () => {
  const { hitters } = describeHitters(
    answers[listSeasonStatsRequest(season, "hitting", { pool: "qualified" })],
  );
  assert.equal(hitters.length, 135);
  assert.deepEqual(
    hitters.find((hitter) => hitter.id === 680757),
    {
      id: 680757,
      avg: 0.282,
      obp: 0.382,
      slg: 0.349,
      ops: 0.731,
      homeRuns: 3,
      rbi: 32,
      runs: 80,
      stolenBases: 10,
      walkRate: 0.133,
      strikeoutRate: 0.097,
    },
  );
});

test("a player's last games are his five newest at the plate and on the mound, with whom he played and where", () => {
  const kwan = describeLastGames(FIXTURE.gameLogs[680757]);
  assert.equal(kwan.hitting.length, 5);
  assert.deepEqual(
    kwan.hitting.map((/** @type {any} */ game) => game.date),
    [...kwan.hitting.map((/** @type {any} */ game) => game.date)].sort().reverse(),
  );
  assert.deepEqual(
    { opponent: kwan.hitting[0].opponent, isHome: kwan.hitting[0].isHome },
    { opponent: "CWS", isHome: false },
  );
  assert.deepEqual(kwan.pitching, []);
  const bibee = describeLastGames(FIXTURE.gameLogs[676440]);
  assert.deepEqual(bibee.pitching[0], {
    date: "2026-09-26",
    opponent: "KC",
    isHome: false,
    inningsPitched: "6.0",
    numberOfPitches: 94,
    runs: 3,
    strikeOuts: 6,
  });
});

test("a player's game log asks MLB for each game's pitches", () => {
  const fields = new URL(
    listGameLogRequest(2026, [676440], "2026-10-08"),
    "https://mlb.test",
  ).searchParams.get("fields");
  assert.ok(fields?.split(",").includes("numberOfPitches"));
});
