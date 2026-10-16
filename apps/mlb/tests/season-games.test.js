import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sortInScheduleOrder } from "../page/js/schedule-order.js";
import { groupGamesByDay, listSeasonGames, nameGameKey } from "../page/js/season-games.js";
import { buildSnapshot } from "../page/js/snapshot.js";

// MLB's 2026 season as the store kept it on Friday, October 9.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-09-season.json`, "utf8"),
);
const SNAPSHOT = buildSnapshot(FIXTURE.responses, {
  season: FIXTURE.season,
  now: Date.parse(FIXTURE.now),
});
const SCHEDULE = Object.values(SNAPSHOT.schedule).flat();

/** @param {any[]} games */
const nameGames = (games) =>
  games.map(
    (game) => `${game.away}@${game.home}${game.doubleheader ? `#${game.doubleheader}` : ""}`,
  );

test("a doubleheader's games sit together where its first game starts, among the day's other games", () => {
  const day = SCHEDULE.filter((game) => game.date === "2026-04-04");
  assert.deepEqual(nameGames(day).slice(0, 5), [
    "STL@DET",
    "TOR@CWS",
    "MIL@KC#1",
    "MIL@KC#2",
    "LAD@WSH",
  ]);
});

test("a doubleheader MLB lists with its second game's start first still goes in game order", () => {
  const game = (away, start, doubleheader = null) => ({
    date: "2026-09-25",
    away,
    home: "NYY",
    start,
    doubleheader,
  });
  const listed = [
    game("TOR", "2026-09-25T23:05:00Z"),
    game("BAL", "2026-09-25T21:05:00Z", 1),
    game("BAL", "2026-09-25T17:05:00Z", 2),
    game("TB", "2026-09-25T19:05:00Z"),
  ];
  assert.deepEqual(nameGames(sortInScheduleOrder(listed)), [
    "BAL@NYY#1",
    "BAL@NYY#2",
    "TB@NYY",
    "TOR@NYY",
  ]);
});

test("each day lists its games in schedule order, the days in order", () => {
  const days = groupGamesByDay(Object.values(SNAPSHOT.schedule).reverse().flat());
  assert.deepEqual(
    days.map((day) => day.date),
    [...new Set(SCHEDULE.map((game) => game.date))],
  );
  assert.deepEqual(
    days.find((day) => day.date === "2026-04-04")?.games,
    SCHEDULE.filter((game) => game.date === "2026-04-04"),
  );
});

test("a game resumed on another day is listed on each, and every game of either day keeps its own key", () => {
  const games = listSeasonGames(SNAPSHOT.slate, SCHEDULE);
  const keys = games.map(nameGameKey);
  assert.equal(new Set(keys).size, keys.length);
  const resumedDay = games.filter((game) => game.date === "2026-06-17" && game.home === "ATL");
  assert.deepEqual(
    resumedDay.map((game) => game.id),
    ["824912", "824913"],
  );
});
