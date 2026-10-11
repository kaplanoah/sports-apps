import test from "node:test";
import assert from "node:assert/strict";
import {
  describePlayoffField,
  describeTeamGames,
  formatMargin,
  listFieldRows,
  listSeasonRankRows,
  readWinShare,
} from "../shared/page/team-numbers.js";

/** @type {import("../shared/page/team-numbers.js").Measure[]} */
const MEASURES = [
  { label: "Pts", key: "scored", format: (value) => value.toFixed(1) },
  { label: "Opp", key: "allowed", format: (value) => value.toFixed(1), isFewestFirst: true },
  { label: "Home", key: "home" },
];
const TEAMS = [
  { record: "10-2", scored: 90, allowed: 80, margin: 10, home: "6-0", road: "4-2" },
  { record: "6-6", scored: 80, allowed: 82, margin: -2, home: "3-3", road: "3-3" },
  { record: "2-10", scored: 70, allowed: 95, margin: -25, home: "1-5", road: "1-5" },
];

/** @param {unknown} markup */
const readRow = (markup) =>
  String(markup)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("a record reads as the share of its games won, and a margin carries its sign unless it rounds to nothing", () => {
  assert.equal(readWinShare("6-2"), 0.75);
  assert.equal(readWinShare("0-0"), null);
  assert.equal(readWinShare(null), null);
  assert.equal(formatMargin(1.234, 2), "+1.23");
  assert.equal(formatMargin(-0.004, 2), "0.00");
  assert.equal(formatMargin(-3.1, 1), "-3.1");
});

test("a team's games give its record, what it scored and allowed a game, its margin, and its records home and away", () => {
  assert.deepEqual(
    describeTeamGames([
      { own: 5, theirs: 3, isHome: true },
      { own: 2, theirs: 3, isHome: true },
      { own: 3, theirs: 1, isHome: false },
    ]),
    { record: "2-1", scored: 10 / 3, allowed: 7 / 3, margin: 1, home: "1-1", road: "1-0" },
  );
  assert.equal(describeTeamGames([]), null);
});

test("the playoff field scores what its games average a team, has no margin, and its home and road records mirror each other", () => {
  assert.deepEqual(
    describePlayoffField([
      { home: 5, away: 3 },
      { home: 2, away: 4 },
      { home: 6, away: 0 },
    ]),
    { record: null, scored: 20 / 6, allowed: 20 / 6, margin: 0, home: "2-1", road: "1-2" },
  );
  assert.equal(describePlayoffField([]), null);
});

test("a team's season ranks each measure it has a number in, a measure where fewer is better from the fewest", () => {
  const rows = listSeasonRankRows(MEASURES, TEAMS[1], TEAMS).map(readRow);
  assert.deepEqual(rows, ["Pts 80.0 2nd of 3", "Opp 82.0 2nd of 3", "Home 3-3 2nd of 3"]);
  const best = listSeasonRankRows(MEASURES, TEAMS[0], TEAMS).map(readRow);
  assert.deepEqual(best, ["Pts 90.0 1st of 3", "Opp 80.0 1st of 3", "Home 6-0 1st of 3"]);
  assert.equal(listSeasonRankRows(MEASURES, { ...TEAMS[1], scored: null }, TEAMS).length, 2);
});

test("a team's playoffs place it and the field on each regular season range, its better end on the right", () => {
  const playoffs = {
    record: "2-1",
    scored: 85,
    allowed: 95,
    margin: -10,
    home: "1-1",
    road: "1-0",
  };
  const field = describePlayoffField([{ home: 80, away: 80 }]);
  const rows = listFieldRows(MEASURES, playoffs, field, TEAMS).map(String);
  assert.match(
    rows[0],
    /<i class="other" style="left: 50%"><\/i><i class="own" style="left: 75%"><\/i>/,
  );
  assert.match(rows[1], /<i class="own" style="left: 0%"><\/i>/);
  assert.match(
    rows[2],
    /<i class="other" style="left: 0%"><\/i><i class="own" style="left: 50%"><\/i>/,
  );
});
