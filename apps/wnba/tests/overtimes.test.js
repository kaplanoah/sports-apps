import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeOvertimes } from "../worker/src/overtimes.js";

const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);
const TEAM_GAMES = [PLAYERS.teamGames["2026:Regular Season"], PLAYERS.teamGames["2026:Playoffs"]];

test("a final went to overtime when its teams played past 200 minutes, 25 more for each overtime", () => {
  const { season, games } = describeOvertimes(2026, TEAM_GAMES);
  assert.equal(season, 2026);
  const counts = Object.values(games);
  assert.equal(counts.length, 13);
  assert.deepEqual(
    counts.toSorted((first, second) => first - second),
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4],
  );
});

test("a season whose log didn't answer has no finals past regulation", () => {
  assert.deepEqual(describeOvertimes(2026, [null, null]), { season: 2026, games: {} });
});
