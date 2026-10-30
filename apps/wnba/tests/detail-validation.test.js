import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeRoster } from "../worker/src/adapters/roster.js";
import {
  describeSeasonPlayers,
  describeRanks,
  validatePlayerFeed,
} from "../worker/src/adapters/player.js";
import { joinGameLogs } from "./player-fixtures.js";

const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);
const ROSTERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-13-every-roster.json`, "utf8"),
);
const NOW = Date.parse(ROSTERS.recordedAt);
const readAnswers = () => ({
  totals: structuredClone(PLAYERS.totals[2026]),
  regularGames: structuredClone(joinGameLogs(PLAYERS.gameLogs, 2026, "Regular Season")),
  playoffGames: structuredClone(joinGameLogs(PLAYERS.gameLogs, 2026, "Playoffs")),
  teamRegularGames: structuredClone(PLAYERS.teamGames["2026:Regular Season"]),
  teamPlayoffGames: structuredClone(PLAYERS.teamGames["2026:Playoffs"]),
});

function corruptColumn(answer, column, value) {
  const table = answer.resultSets[0];
  table.rowSet[0][table.headers.indexOf(column)] = value;
}

test("all recorded WNBA rosters validate and malformed identities and nested facts fail", () => {
  for (const [key, leagueRoster] of Object.entries(ROSTERS.rosters)) {
    const team = key.split(":")[0];
    assert.ok(
      describeRoster({
        team,
        season: 2026,
        leagueRoster,
        playerList: ROSTERS.playerList,
        outPlayers: [],
        now: NOW,
      }).players.length,
    );
  }
  const leagueRoster = structuredClone(ROSTERS.rosters["NYL:2026"]);
  corruptColumn(leagueRoster, "PLAYER_ID", "invalid");
  const parts = {
    team: "NYL",
    season: 2026,
    leagueRoster,
    playerList: ROSTERS.playerList,
    outPlayers: [],
    now: NOW,
  };
  assert.throws(() => describeRoster(parts), /Invalid sports data/);
  const valid = { ...parts, leagueRoster: ROSTERS.rosters["NYL:2026"] };

  assert.throws(() => describeRoster({ ...valid, leagueRoster: {} }), /Invalid sports table/);
  const empty = structuredClone(valid.leagueRoster);
  empty.resultSets[0].rowSet = [];
  assert.throws(
    () => describeRoster({ ...valid, leagueRoster: empty, season: Infinity }),
    /Invalid sports data/,
  );
  assert.deepEqual(describeRoster({ ...valid, leagueRoster: empty }).players, []);
});

test("recorded WNBA player numbers reject malformed counts, identities and nested games", () => {
  assert.ok(describeSeasonPlayers(readAnswers()).players.size > 200);
  for (const [feed, column, value] of [
    ["totals", "GP", -1],
    ["totals", "PTS", Infinity],
    ["totals", "PLAYER_ID", null],
    ["regularGames", "REB", 1.5],
    ["playoffGames", "GAME_ID", ""],
    ["teamPlayoffGames", "PTS", -1],
    ["teamRegularGames", "TEAM_ID", 0],
  ]) {
    const answers = readAnswers();
    corruptColumn(answers[feed], column, value);
    assert.throws(() => describeSeasonPlayers(answers), /Invalid sports data/);
  }
  const nameless = readAnswers();
  for (const answer of [nameless.regularGames, nameless.playoffGames])
    answer.resultSets[0].rowSet = [];
  corruptColumn(nameless.totals, "PLAYER_NAME", " ");
  assert.throws(() => describeSeasonPlayers(nameless), /Invalid sports data/);
  const malformed = readAnswers();
  malformed.totals.resultSets[0].rowSet[0].pop();
  assert.throws(() => describeSeasonPlayers(malformed), /Invalid sports/);
});

test("rank construction validates every row before qualification can hide a malformed value", () => {
  const answers = readAnswers();
  assert.ok(describeRanks(answers.totals, answers.teamRegularGames).values.points.length);
  corruptColumn(answers.totals, "FGM", -1);
  assert.throws(
    () => describeRanks(answers.totals, answers.teamRegularGames),
    /Invalid sports data/,
  );
  const empty = readAnswers();
  for (const answer of Object.values(empty))
    for (const table of answer.resultSets) table.rowSet = [];
  assert.equal(describeSeasonPlayers(empty).players.size, 0);
  assert.equal(describeRanks(empty.totals, empty.teamRegularGames).seasonGames, 0);
  assert.throws(() => validatePlayerFeed({}, "PlayerGameLogs"), /Invalid sports table/);
});

test("WNBA records allow mononyms and null optional columns without checking unused all-time names", () => {
  const answers = readAnswers();
  corruptColumn(answers.totals, "PLAYER_NAME", "Mononym");
  for (const column of ["STL", "BLK", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA"])
    corruptColumn(answers.totals, column, null);
  assert.ok(describeSeasonPlayers(answers).players.size > 0);
  const leagueRoster = structuredClone(ROSTERS.rosters["NYL:2026"]);
  const playerList = structuredClone(ROSTERS.playerList);
  const table = playerList.resultSets[0];
  const id =
    leagueRoster.resultSets[0].rowSet[0][leagueRoster.resultSets[0].headers.indexOf("PLAYER_ID")];
  const used = table.rowSet.find((row) => row[table.headers.indexOf("PERSON_ID")] === id);
  used[table.headers.indexOf("PLAYER_FIRST_NAME")] = "Mononym";
  used[table.headers.indexOf("PLAYER_LAST_NAME")] = "";
  used[table.headers.indexOf("FROM_YEAR")] = "0";
  corruptColumn(leagueRoster, "PLAYER", null);
  const unused = [...used];
  unused[table.headers.indexOf("PERSON_ID")] = 999999999;
  unused[table.headers.indexOf("PLAYER_FIRST_NAME")] = null;
  unused[table.headers.indexOf("FROM_YEAR")] = "bad";
  table.rowSet.push(unused);
  const roster = describeRoster({
    team: "NYL",
    season: 2026,
    leagueRoster,
    playerList,
    outPlayers: [],
    now: NOW,
  });
  assert.equal(roster.players[0].firstName, "Mononym");
  assert.equal(roster.players[0].lastName, "");
  assert.equal(roster.players[0].debut, null);
});
