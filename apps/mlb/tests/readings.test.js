import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../worker/src/adapters/mlb.js";
import * as Readings from "../worker/src/readings.js";

const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const SNAPSHOT = MLBSnapshot.buildSnapshot(EVENING.responses, {
  season: 2026,
  now: Date.parse(EVENING.now),
});

// The evening's snapshot, `minutes` later, with one club's standings row changed.
function changeSnapshot(minutes, id, fields, snapshot = SNAPSHOT) {
  const changed = JSON.parse(JSON.stringify(snapshot));
  changed.asOf = new Date(Date.parse(snapshot.asOf) + minutes * 60 * 1000).toISOString();
  for (const rows of Object.values(changed.standings.divisions)) {
    for (const row of rows) if (row.id === id) Object.assign(row, fields);
  }
  return changed;
}

const findRow = (snapshot, id) =>
  Object.values(snapshot.standings.divisions)
    .flat()
    .find((row) => row.id === id);

function recordParts(snapshots) {
  let parts = [];
  for (const snapshot of snapshots) {
    const day = Readings.readReadingDay(snapshot);
    const changed = Readings.addReading(parts, day, Readings.createReading(snapshot));
    if (changed)
      parts = Readings.sortParts([...parts.filter((kept) => kept.id !== changed.id), changed]);
  }
  return parts;
}

test("the first reading is the start, and a repeat adds nothing", () => {
  const reading = Readings.createReading(SNAPSHOT);
  const day = Readings.readReadingDay(SNAPSHOT);
  const first = Readings.addReading([], day, reading);
  assert.deepEqual(first, { id: `${day}-01`, day, number: 1, start: reading, changes: [] });
  assert.equal(Readings.addReading([first], day, reading), null);
  assert.deepEqual(Readings.rebuildLog([first]), []);
});

test("past midnight, a reading keeps the night's finals once the slate has moved on", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const lastNight = fixture.responses.schedule.dates.find((date) => date.date === "2026-09-24");
  const [firstGame] = lastNight.games;
  const secondGame = {
    ...structuredClone(firstGame),
    gamePk: 1,
    gameNumber: 2,
    gameDate: "2026-09-24T21:00:00Z",
  };
  Object.assign(firstGame, { doubleHeader: "Y", gameNumber: 1 });
  secondGame.doubleHeader = "Y";
  lastNight.games.push(secondGame);
  for (const game of lastNight.games) {
    game.status = { abstractGameState: "Final", codedGameState: "F", detailedState: "Final" };
    game.teams.away.score ??= 1;
    game.teams.home.score ??= 2;
  }
  const buildAt = (now) =>
    MLBSnapshot.buildSnapshot(fixture.responses, { season: 2026, now: Date.parse(now) });

  const pastMidnight = buildAt("2026-09-25T05:12:00Z");
  assert.equal(pastMidnight.slate.today.date, "2026-09-25");
  assert.equal(Readings.readReadingDay(pastMidnight), "2026-09-24");
  const reading = Readings.createReading(pastMidnight);
  assert.equal(Object.keys(reading.games).length, lastNight.games.length);
  assert.ok(String(firstGame.gamePk) in reading.games);
  assert.ok("1" in reading.games);

  const morning = buildAt("2026-09-25T10:00:00Z");
  assert.equal(Readings.readReadingDay(morning), "2026-09-25");
  assert.deepEqual(Readings.createReading(morning).games, {});
});

test("two of a day's finals between the same clubs, like a resumed game and the day's own, are each kept", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const lastNight = fixture.responses.schedule.dates.find((date) => date.date === "2026-09-24");
  const [firstGame] = lastNight.games;
  const resumed = { ...structuredClone(firstGame), gamePk: 2, gameDate: "2026-09-24T17:00:00Z" };
  lastNight.games.push(resumed);
  for (const game of [firstGame, resumed])
    game.status = { abstractGameState: "Final", codedGameState: "F", detailedState: "Final" };
  const pastMidnight = MLBSnapshot.buildSnapshot(fixture.responses, {
    season: 2026,
    now: Date.parse("2026-09-25T05:12:00Z"),
  });

  const { games } = Readings.createReading(pastMidnight);

  assert.ok(String(firstGame.gamePk) in games);
  assert.ok("2" in games);
});

test("a reading leaves out each club's schedule, and keeps only final scores", () => {
  const reading = Readings.createReading(SNAPSHOT);
  assert.equal("next" in reading.rows.TB, false);
  assert.equal(reading.rows.TB.div, "AL East");
  assert.ok(Object.values(reading.games).every((game) => game.state === "final"));
});

test("a change is saved field by field, and replays to the same news", () => {
  const baltimore = findRow(SNAPSHOT, "BAL");
  const before = changeSnapshot(0, "BAL", { wce: "1" });
  const parts = recordParts([before, SNAPSHOT]);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].changes, [
    { at: SNAPSHOT.asOf, rows: { BAL: { wce: baltimore.wce } } },
  ]);
  const [entry, ...rest] = Readings.rebuildLog(parts);
  assert.equal(rest.length, 0);
  assert.deepEqual([entry.kind, entry.team, entry.at], ["elim", "BAL", SNAPSHOT.asOf]);
});

test("a rebuild follows today's rules, not the ones the readings were saved under", () => {
  const playoffSpot = changeSnapshot(0, "CWS", { clinch: "x" });
  const wildCard = changeSnapshot(10, "CWS", { clinch: "w" });
  const bye = changeSnapshot(20, "ATL", { clinch: "z" }, wildCard);
  const log = Readings.rebuildLog(recordParts([playoffSpot, wildCard, bye]));
  assert.deepEqual(
    log.map((entry) => [entry.kind, entry.team, entry.what]),
    [["berth", "ATL", "bye"]],
  );
});

test("a new day starts from the last reading, without the day before's scores", () => {
  const nextDay = changeSnapshot(24 * 60, "BAL", { gb: "20.0" });
  nextDay.slate = { today: { date: "2026-09-25", games: [] } };
  const parts = recordParts([SNAPSHOT, nextDay]);
  assert.deepEqual(
    parts.map((part) => part.id),
    ["2026-09-24-01", "2026-09-25-01"],
  );
  assert.deepEqual(parts[1].start.games, {});
  assert.equal(parts[1].start.at, SNAPSHOT.asOf);
  assert.deepEqual(parts[1].changes, [{ at: nextDay.asOf, rows: { BAL: { gb: "20.0" } } }]);
});

test("a busy day moves on to a new part, which picks up where the last one ended", () => {
  const snapshots = [SNAPSHOT];
  for (let minute = 1; minute <= 60; minute++) {
    const changed = changeSnapshot(minute, "TB", {});
    for (const row of Object.values(changed.standings.divisions).flat())
      Object.assign(row, { gb: `${minute}.0`, wcgb: `${minute}.5`, elim: String(minute) });
    snapshots.push(changed);
  }
  const parts = recordParts(snapshots);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => JSON.stringify(part).length <= 40 * 1024));
  assert.deepEqual(parts.map((part) => part.id).slice(0, 2), ["2026-09-24-01", "2026-09-24-02"]);
  const firstEnd = parts[0].changes[parts[0].changes.length - 1].at;
  assert.equal(parts[1].start.at, firstEnd);
  assert.deepEqual(parts[1].start.games, parts[0].start.games);
  const replayed = parts.reduce((count, part) => count + part.changes.length, 0);
  assert.equal(replayed, 60);
});

test("the saved log gives way to the rebuild from the oldest reading on", () => {
  const parts = recordParts([changeSnapshot(0, "BAL", { wce: "1" }), SNAPSHOT]);
  const start = parts[0].start.at;
  const olderElimination = { at: "2026-09-20T01:00:00Z", kind: "elim", team: "SEA" };
  const staleBerth = { at: "2026-09-25T03:00:00Z", kind: "berth", team: "CWS", what: "wildcard" };
  const game = { at: "2026-09-25T03:00:00Z", kind: "game", series: "AL_WC1", game: 1, won: "TB" };
  const log = Readings.composeLog([olderElimination, staleBerth], parts, [game]);
  assert.ok(Date.parse(start) < Date.parse(staleBerth.at));
  assert.deepEqual(
    log.map((entry) => [entry.kind, entry.team || entry.won]),
    [
      ["elim", "SEA"],
      ["elim", "BAL"],
      ["game", "TB"],
    ],
  );
  assert.deepEqual(Readings.composeLog([staleBerth], null), [staleBerth]);
});

test("parts older than two weeks expire, except the newest", () => {
  const parts = ["2026-09-01", "2026-09-12", "2026-09-13", "2026-09-20"].map((day) => ({ day }));
  assert.deepEqual(
    Readings.findExpiredParts(parts, "2026-09-27").map((part) => part.day),
    ["2026-09-01", "2026-09-12"],
  );
  assert.deepEqual(Readings.findExpiredParts(parts.slice(0, 1), "2026-12-01"), []);
});
