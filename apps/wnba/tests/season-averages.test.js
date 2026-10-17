import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeRanks, describeRegularSeason } from "../worker/src/player.js";
import { describeAverages, listLeaders } from "../worker/src/season-averages.js";
import { readTable } from "../worker/src/wnba.js";

// Every player's totals as the league answered the morning after the Liberty's last game.
const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);
const TOTALS = PLAYERS.totals[2026];

/**
 * @param {any} averages
 * @param {string} lastName
 */
const findPlayer = (averages, lastName) =>
  averages.find((/** @type {any} */ player) => player.lastName === lastName);

test("every player who has played has her averages a game, worked out from her season's totals", () => {
  const averages = describeAverages(TOTALS);
  const stewart = findPlayer(averages, "Stewart");

  assert.equal(averages.length, TOTALS.resultSets[0].rowSet.length);
  assert.deepEqual(
    {
      ...stewart,
      minutes: stewart.minutes.toFixed(1),
      points: stewart.points.toFixed(1),
      rebounds: stewart.rebounds.toFixed(1),
      assists: stewart.assists.toFixed(1),
      fieldGoalShare: stewart.fieldGoalShare.toFixed(3),
    },
    {
      team: "NYL",
      id: 1627668,
      firstName: "Breanna",
      lastName: "Stewart",
      games: 42,
      minutes: "32.9",
      points: "20.8",
      rebounds: "8.3",
      assists: "3.3",
      fieldGoalShare: "0.474",
    },
  );
});

test("each team's five leading scorers are those with the most points a game who played most of its games", () => {
  const leaders = listLeaders(describeAverages(TOTALS));

  assert.equal(leaders.length, 75);
  assert.deepEqual(
    leaders.filter((leader) => leader.team === "IND").map((leader) => leader.lastName),
    ["Mitchell", "Clark", "Boston", "Cunningham", "Billings"],
  );
  assert.equal(leaders.find((leader) => leader.team === "LVA")?.lastName, "Wilson");

  const fewGames = structuredClone(TOTALS);
  const table = fewGames.resultSets[0];
  const column = Object.fromEntries(
    table.headers.map((/** @type {string} */ header, /** @type {number} */ index) => [
      header,
      index,
    ]),
  );
  const mitchell = table.rowSet.find(
    (/** @type {any[]} */ row) => row[column.PLAYER_NAME] === "Kelsey Mitchell",
  );
  mitchell[column.PTS] = Math.round((mitchell[column.PTS] / mitchell[column.GP]) * 10);
  mitchell[column.GP] = 10;
  const withoutMitchell = listLeaders(describeAverages(fewGames));
  assert.ok(!withoutMitchell.some((leader) => leader.lastName === "Mitchell"));
  assert.equal(withoutMitchell.filter((leader) => leader.team === "IND").length, 5);
});

test("every player's averages on her team's Roster are the ones her sheet shows, from the same totals", () => {
  const ranks = describeRanks(TOTALS, PLAYERS.teamGames["2026:Regular Season"]);
  const averages = describeAverages(TOTALS);

  for (const row of readTable(TOTALS, "LeagueDashPlayerStats")) {
    const kept = averages.find(
      (player) =>
        player.id === row.PLAYER_ID && `${player.firstName} ${player.lastName}` === row.PLAYER_NAME,
    );
    const sheet = /** @type {any} */ (describeRegularSeason(row, ranks));
    const { minutes, points, rebounds, assists } = /** @type {any} */ (kept);
    assert.deepEqual({ minutes, points, rebounds, assists }, sheet.averages);
    const shooting = sheet.stats.find((/** @type {any} */ stat) => stat.key === "fieldGoalShare");
    assert.equal(kept?.fieldGoalShare, shooting.value);
  }
});

test("a feed with no totals has no averages and no leaders", () => {
  assert.deepEqual(describeAverages(null), []);
  assert.deepEqual(listLeaders([]), []);
});
