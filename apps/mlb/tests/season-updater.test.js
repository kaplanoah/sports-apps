import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { sortInScheduleOrder } from "../page/js/schedule-order.js";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { OFF_DAY_CHECK_MS } from "#shared/poll-schedule.js";
import { composeLog, createReading, sortParts } from "../worker/src/readings.js";
import { loadCurrentSnapshot } from "../worker/src/season-updater.js";
import { SeasonStore } from "../worker/src/store.js";
import {
  createDurableObjectContext,
  fireNextAlarm,
} from "../../../tests/durable-object-context.js";

const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const NOW = Date.parse(EVENING.now);
const SNAPSHOT = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });
const TODAY = SNAPSHOT.slate.today.date;

function createUpdatingStore({ stored = {}, snapshot = SNAPSHOT, now = NOW } = {}) {
  const context = createDurableObjectContext();
  for (const [key, data] of Object.entries(stored)) context.stored.set(key, data);
  const harness = { snapshot, failure: null, requestedSeasons: [] };
  const loadSnapshot = async (season) => {
    harness.requestedSeasons.push(season);
    if (harness.failure) throw harness.failure;
    return structuredClone(harness.snapshot);
  };
  const sent = [];
  context.ctx.acceptWebSocket({ send: (message) => sent.push(JSON.parse(message)) });
  const clock = { now };
  // MLB, whose pitchers the store also keeps, isn't what these tests follow.
  const fetchImpl = async () => new Response(null, { status: 404 });
  const store = new SeasonStore(context.ctx, {}, { loadSnapshot, now: () => clock.now, fetchImpl });
  return { store, context, clock, harness, sent, read: (key) => context.stored.get(key) ?? null };
}

test("the first request starts the updates, and later ones leave the alarm alone", async () => {
  const { store, context } = createUpdatingStore();
  assert.equal(context.alarm.at, null);
  await store.fetch(new Request("https://store/store/seasons/2026"));
  assert.equal(context.alarm.at, NOW);

  context.alarm.at = NOW + 5000;
  await store.fetch(new Request("https://store/store/seasons/2026"));
  assert.equal(context.alarm.at, NOW + 5000);
});

test("an update saves the whole season in its record, and a reading, and tells open pages", async () => {
  const { store, context, sent, read } = createUpdatingStore();
  await store.alarm();

  const season = read("seasons/2026");
  assert.deepEqual(season, {
    year: 2026,
    version: SNAPSHOT.version,
    updatedAt: SNAPSHOT.asOf,
    teams: SNAPSHOT.teams,
    series: SNAPSHOT.series,
    projected: SNAPSHOT.projected,
    springStart: SNAPSHOT.springStart,
    standings: SNAPSHOT.standings,
    slate: SNAPSHOT.slate,
    log: [],
  });
  assert.deepEqual(read(`readings-2026/${TODAY}-01`).start, createReading(SNAPSHOT));
  assert.deepEqual(read("live/status"), {
    error: "",
    detail: "",
    write: "",
    at: new Date(NOW).toISOString(),
  });
  assert.deepEqual(
    sent.map((message) => message.path),
    [`readings-2026/${TODAY}-01`, "seasons/2026", "live/current", "live/status"],
  );
  // A game is in the 9th inning, so the next update is fifteen seconds out.
  assert.equal(context.alarm.at, NOW + MLBSnapshot.POLL_CLOSING_MS);
});

test("an update writes nothing when nothing changed", async () => {
  const { store, sent, context, clock } = createUpdatingStore();
  await store.alarm();

  sent.length = 0;
  await fireNextAlarm(store, context, clock);
  assert.deepEqual(sent, []);
});

test("the season's record is all the Worker saves for the page, and only when more than its time changed", async () => {
  const { store, harness, sent, read, context, clock } = createUpdatingStore();
  await store.alarm();
  assert.equal(read("live/2026"), null);
  assert.equal(read("standings/2026"), null);

  sent.length = 0;
  harness.snapshot = { ...SNAPSHOT, asOf: "2026-09-25T00:45:13.489Z" };
  await fireNextAlarm(store, context, clock);
  assert.deepEqual(sent, []);

  harness.snapshot = { ...SNAPSHOT, missing: ["wildCardRank"] };
  await fireNextAlarm(store, context, clock);
  assert.deepEqual(
    sent.map((message) => message.path),
    ["live/status"],
  );
});

test("a read without the standings or the day's games leaves them in the record as they were", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore();
  await store.alarm();
  const saved = read("seasons/2026");

  const later = "2026-09-25T00:45:13.489Z";
  harness.snapshot = { ...SNAPSHOT, asOf: later, standings: null, slate: null, springStart: null };
  await fireNextAlarm(store, context, clock);

  assert.deepEqual(read("seasons/2026"), saved);
});

test("the record's updates are what the readings rebuild, so rebuilding them again changes nothing", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore();
  await store.alarm();
  const { PHI, ...teams } = SNAPSHOT.teams;
  harness.snapshot = { ...SNAPSHOT, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
  await fireNextAlarm(store, context, clock);

  const { log } = read("seasons/2026");
  const parts = sortParts([read(`readings-2026/${TODAY}-01`)]);
  assert.ok(log.some((entry) => entry.kind === "field" && entry.in === "NYM"));
  assert.deepEqual(composeLog(log, parts), log);
});

test("a change in the field is saved as a new change in today's reading", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore();
  await store.alarm();
  const { PHI, ...teams } = SNAPSHOT.teams;
  harness.snapshot = { ...SNAPSHOT, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
  await fireNextAlarm(store, context, clock);

  assert.equal(read(`readings-2026/${TODAY}-01`).changes.length, 1);
  assert.ok("NYM" in read("seasons/2026").teams);
  assert.ok(!("PHI" in read("seasons/2026").teams));
});

test("standings MLB sent empty leave the saved field, standings, and readings alone", async () => {
  const responses = structuredClone(EVENING.responses);
  responses.standings.records = [];
  const empty = MLBSnapshot.buildSnapshot(responses, { season: 2026, now: NOW });
  const { store, harness, read, context, clock } = createUpdatingStore();
  await store.alarm();
  const saved = read("seasons/2026");
  harness.snapshot = empty;
  await fireNextAlarm(store, context, clock);

  assert.deepEqual(read("seasons/2026"), saved);
  assert.deepEqual(read(`readings-2026/${TODAY}-01`).changes, []);
});

test("readings older than two weeks go, and their updates stay in the saved log", async () => {
  const reading = createReading(SNAPSHOT);
  const oldStart = {
    ...reading,
    at: "2026-09-01T20:00:00Z",
    rows: { ...reading.rows, BAL: { ...reading.rows.BAL, wce: "1" } },
    games: {},
  };
  const elimination = { at: "2026-09-01T23:00:00Z", rows: { BAL: { wce: reading.rows.BAL.wce } } };
  const lastStart = { ...reading, at: elimination.at, games: {} };
  const { store, read } = createUpdatingStore({
    stored: {
      "readings-2026/2026-09-01-01": {
        id: "2026-09-01-01",
        day: "2026-09-01",
        number: 1,
        start: oldStart,
        changes: [elimination],
      },
      "readings-2026/2026-09-20-01": {
        id: "2026-09-20-01",
        day: "2026-09-20",
        number: 1,
        start: lastStart,
        changes: [],
      },
    },
  });
  await store.alarm();

  assert.equal(read("readings-2026/2026-09-01-01"), null);
  assert.notEqual(read("readings-2026/2026-09-20-01"), null);
  assert.deepEqual(
    read("seasons/2026").log.map((entry) => [entry.kind, entry.team, entry.at]),
    [["elim", "BAL", "2026-09-01T23:00:00Z"]],
  );
});

test("when MLB can't be read, the status says why and the retries back off", async () => {
  const { store, context, harness, read, clock } = createUpdatingStore();
  harness.failure = new Error("MLB Stats API answered 503 for /api/v1/standings");
  await store.alarm();

  assert.equal(read("seasons/2026"), null);
  assert.deepEqual(read("live/status"), {
    error: "upstream_error",
    detail: "MLB Stats API answered 503 for /api/v1/standings",
    write: "",
    at: new Date(NOW).toISOString(),
  });
  assert.equal(context.alarm.at, NOW + 30e3);
  await fireNextAlarm(store, context, clock);
  assert.equal(context.alarm.at, clock.now + 60e3);

  harness.failure = null;
  await fireNextAlarm(store, context, clock);
  assert.equal(read("live/status").error, "");
  assert.equal(context.alarm.at, clock.now + MLBSnapshot.POLL_CLOSING_MS);
});

test("the status names the fields MLB stopped sending", async () => {
  const { store, read } = createUpdatingStore({ snapshot: { ...SNAPSHOT, missing: ["gb"] } });
  await store.alarm();
  assert.deepEqual(read("live/status"), {
    error: "mlb_fields_missing",
    detail: "gb",
    write: "",
    at: new Date(NOW).toISOString(),
  });
});

test("with no games to follow, the next update is a day out", async () => {
  const { store, context } = createUpdatingStore({ snapshot: { ...SNAPSHOT, slate: null } });
  await store.alarm();
  assert.equal(context.stored.get("poll:schedule").dueAt, NOW + OFF_DAY_CHECK_MS);
});

test("before April, the new season is followed once spring training has started", async () => {
  const february = Date.parse("2027-02-10T17:00:00Z");
  const requested = [];
  const loadSnapshot = (springStart) => async (season) => {
    requested.push(season);
    return { season, springStart };
  };

  const before = await loadCurrentSnapshot(loadSnapshot("2027-02-20"), february);
  assert.equal(before.season, 2026);
  assert.deepEqual(requested, [2027, 2026]);

  requested.length = 0;
  const after = await loadCurrentSnapshot(loadSnapshot("2027-02-05"), february);
  assert.equal(after.season, 2027);
  assert.deepEqual(requested, [2027]);
});

const SEASON_GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-09-season.json`, "utf8"),
);
const SEASON_NOW = Date.parse(SEASON_GAMES.now);
const WHOLE_SEASON = MLBSnapshot.buildSnapshot(SEASON_GAMES.responses, {
  season: 2026,
  now: SEASON_NOW,
});

// On an off day the store's own jobs come due before its next update.
async function updateSeasonAgain(store, context, clock) {
  clock.now = context.stored.get("poll:schedule").dueAt;
  await store.alarm();
}

test("each month of the season's games is saved apart from its record, and only a month whose games changed is saved again", async () => {
  const { store, harness, sent, read, context, clock } = createUpdatingStore({
    snapshot: WHOLE_SEASON,
    now: SEASON_NOW,
  });
  await store.alarm();
  assert.deepEqual(read("schedules-2026/2026-07"), {
    version: WHOLE_SEASON.version,
    edition: MLBSnapshot.SCHEDULE_EDITION,
    year: 2026,
    month: "2026-07",
    games: WHOLE_SEASON.schedule["2026-07"],
    updatedAt: WHOLE_SEASON.asOf,
  });
  assert.equal(read("seasons/2026").schedule, undefined);

  sent.length = 0;
  const october = WHOLE_SEASON.schedule["2026-10"].map((game) =>
    game.id === "849831" ? { ...game, state: "final", score: [2, 5] } : game,
  );
  harness.snapshot = {
    ...WHOLE_SEASON,
    asOf: "2026-10-10T23:40:00.000Z",
    schedule: { ...WHOLE_SEASON.schedule, "2026-10": october },
  };
  await updateSeasonAgain(store, context, clock);
  assert.deepEqual(
    sent.map((message) => message.path),
    ["schedules-2026/2026-10"],
  );
  assert.deepEqual(read("schedules-2026/2026-10").games, october);
});

test("a read without the standings during the playoffs leaves the playoff games' months and each club's last and next games as they were", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore({
    snapshot: WHOLE_SEASON,
    now: SEASON_NOW,
  });
  await store.alarm();
  const october = read("schedules-2026/2026-10");
  const september = read("schedules-2026/2026-09");
  assert.ok(september.games.some((game) => game.postseason));
  const { previous, next } = read("seasons/2026").slate;
  assert.ok(next.some((game) => game.postseason));

  const responses = { ...SEASON_GAMES.responses, standings: null };
  harness.snapshot = MLBSnapshot.buildSnapshot(responses, { season: 2026, now: SEASON_NOW });
  await updateSeasonAgain(store, context, clock);
  assert.deepEqual(read("schedules-2026/2026-10"), october);
  assert.deepEqual(read("schedules-2026/2026-09"), september);
  const slate = read("seasons/2026").slate;
  assert.deepEqual([slate.previous, slate.next], [previous, next]);
});

test("a read without the standings on the next day keeps each club's last and next games only where they still come before or after it, and the day before's finals among the last", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore();
  await store.alarm();
  const saved = read("seasons/2026").slate;
  const nextDay = NOW + 24 * 60 * 60 * 1000;
  const responses = { ...EVENING.responses, standings: null };
  harness.snapshot = MLBSnapshot.buildSnapshot(responses, { season: 2026, now: nextDay });
  const today = harness.snapshot.slate.today.date;
  assert.ok(saved.next.some((game) => game.date === today));
  const dayBefore = saved.today.games
    .filter((game) => game.state === "final")
    .map((game) => ({ date: saved.today.date, ...game }));
  assert.ok(dayBefore.length > 0);
  await updateSeasonAgain(store, context, clock);

  const slate = read("seasons/2026").slate;
  assert.equal(slate.today.date, today);
  assert.deepEqual(
    slate.next,
    saved.next.filter((game) => game.date > today),
  );
  assert.ok(slate.previous.every((game) => game.date < today));
  for (const game of dayBefore)
    assert.ok(slate.previous.some((kept) => isDeepStrictEqual(kept, game)));
  assert.deepEqual(slate.previous, sortInScheduleOrder(slate.previous));
});

test("a read without the season's whole schedule keeps each club's season's games as the record has them", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore({
    snapshot: WHOLE_SEASON,
    now: SEASON_NOW,
  });
  await store.alarm();
  const responses = { ...SEASON_GAMES.responses, seasonGames: null };
  harness.snapshot = MLBSnapshot.buildSnapshot(responses, { season: 2026, now: SEASON_NOW });
  const yankees = (standings) => standings.divisions["AL East"].find((row) => row.id === "NYY");
  assert.equal(yankees(harness.snapshot.standings).scheduled, undefined);
  await updateSeasonAgain(store, context, clock);

  assert.equal(yankees(read("seasons/2026").standings).scheduled, 161);
  assert.deepEqual(read("seasons/2026").standings, WHOLE_SEASON.standings);
});

test("a read without the season's whole schedule leaves its months as they were", async () => {
  const { store, harness, read, context, clock } = createUpdatingStore({
    snapshot: WHOLE_SEASON,
    now: SEASON_NOW,
  });
  await store.alarm();
  const saved = read("schedules-2026/2026-10");

  harness.snapshot = { ...WHOLE_SEASON, asOf: "2026-10-10T23:40:00.000Z", schedule: null };
  await updateSeasonAgain(store, context, clock);
  assert.deepEqual(read("schedules-2026/2026-10"), saved);
});
