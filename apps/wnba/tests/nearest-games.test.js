import test from "node:test";
import assert from "node:assert/strict";
import { findTeamNearestGames } from "../page/js/nearest-games.js";

/**
 * @param {string} id
 * @param {string} state
 * @param {[string | null, string | null]} teams away, then home
 * @param {string | null} [series]
 */
const makeGame = (id, state, [away, home], series = null) => ({
  id,
  state,
  series,
  away: { team: away },
  home: { team: home },
});

const SEASON = [
  makeGame("1", "final", ["SEA", "LVA"]),
  makeGame("2", "final", ["CHI", "SEA"]),
  makeGame("3", "final", ["LVA", "PHX"]),
  makeGame("4", "live", ["SEA", "GSV"]),
  makeGame("5", "pre", ["MIN", "SEA"]),
  makeGame("6", "pre", ["SEA", "DAL"]),
];

/** @param {{ last: any, now: any, next: any }} nearest */
const listIds = ({ last, now, next }) => [last?.id ?? null, now?.id ?? null, next?.id ?? null];

test("a team's nearest games are its latest final, the one it's playing, and its first still to come", () => {
  assert.deepEqual(listIds(findTeamNearestGames(SEASON, "SEA", new Set())), ["2", "4", "5"]);
  assert.deepEqual(listIds(findTeamNearestGames(SEASON, "PHX", new Set())), ["3", null, null]);
  assert.deepEqual(listIds(findTeamNearestGames(SEASON, "NYL", new Set())), [null, null, null]);
});

test("a team's next game is never one left over in a decided series, or one whose other team isn't known", () => {
  const playoffs = [
    makeGame("10", "final", ["ATL", "WAS"], "1-3"),
    makeGame("11", "pre", ["WAS", "ATL"], "1-3"),
    makeGame("12", "pre", [null, "ATL"], "2-1"),
    makeGame("13", "pre", ["NYL", "ATL"], "2-1"),
  ];
  assert.deepEqual(listIds(findTeamNearestGames(playoffs, "ATL", new Set(["1-3"]))), [
    "10",
    null,
    "13",
  ]);
  assert.deepEqual(listIds(findTeamNearestGames(playoffs, "ATL", new Set())), ["10", null, "11"]);
});

test("a team's next game is never one the league put off, whatever words its status uses", () => {
  for (const status of ["Postponed", "PPD", "Cancelled"]) {
    const putOff = { ...makeGame("5", "pre", ["MIN", "SEA"]), status };
    const season = SEASON.map((game) => (game.id === "5" ? putOff : game));
    assert.deepEqual(listIds(findTeamNearestGames(season, "SEA", new Set())), ["2", "4", "6"]);
  }
});
