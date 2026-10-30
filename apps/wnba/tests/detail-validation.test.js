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
  regularGames: joinGameLogs(PLAYERS.gameLogs, 2026, "Regular Season"),
  playoffGames: joinGameLogs(PLAYERS.gameLogs, 2026, "Playoffs"),
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
  assert.throws(() => describeRoster({ ...valid, season: Infinity }), /Invalid sports data/);
  assert.throws(() => describeRoster({ ...valid, leagueRoster: {} }), /Invalid sports table/);
  const empty = structuredClone(valid.leagueRoster);
  empty.resultSets[0].rowSet = [];
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
  assert.throws(() => describeSeasonPlayers(malformed), /Invalid sports table/);
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
