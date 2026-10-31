import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPostseasonAdapter,
  readPlayInAdvancement,
} from "../worker/src/adapters/postseason.js";
import { createPostseasonReader } from "../worker/src/postseason.js";
import { createIdentityLookup } from "../../../shared/worker/identity.js";
import { createSeasonStore } from "../../../shared/worker/season-store.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { FAILED_FEED_WAIT_MS } from "../../../shared/worker/feed-keeper.js";
import { createRequestBudget } from "../../../shared/worker/request-budget.js";
import { UPSTREAM_TIMEOUT_MS } from "../../../shared/worker/upstream.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/2024-${name}.json`, import.meta.url), "utf8"));
const fixtures = { playoffs: readFixture("bracket"), "play-in": readFixture("playin") };
const readKind = (input) =>
  new URL(String(input)).searchParams.get("State") === "2" ? "playoffs" : "play-in";

test("recorded NBA responses supply all 15 series and six Play-In games for the starting year", async () => {
  const reads = [];
  const read = createPostseasonAdapter(async (input, init) => {
    reads.push({ url: new URL(String(input)), init });
    return Response.json(fixtures[readKind(input)]);
  });
  const playoffs = await read(2024, "playoffs");
  assert.equal(playoffs.season, 2024);
  assert.equal(playoffs.series.length, 15);
  assert.deepEqual(
    playoffs.series.find((series) => series.round === 4),
    {
      id: "2024-4-Finals-0",
      round: 4,
      number: 0,
      conference: null,
      high: { team: "OKC", seed: 1, wins: 4 },
      low: { team: "IND", seed: 4, wins: 3 },
    },
  );
  const playIn = await read(2024, "play-in");
  assert.equal(playIn.matchups.length, 6);
  assert.deepEqual(
    playIn.matchups.find((matchup) => matchup.id === "2024-East-seven-eight"),
    {
      id: "2024-East-seven-eight",
      conference: "East",
      stage: "seven-eight",
      high: { team: "ORL", seed: 7 },
      low: { team: "ATL", seed: 8 },
      game: {
        id: "0052400101",
        season: 2024,
        competition: "play-in",
        round: 0,
        gameNumber: 1,
        isCupFinal: false,
        start: "2025-04-15T23:30:00Z",
      },
    },
  );
  assert.equal(reads.length, 2);
  for (const { url, init } of reads) {
    assert.equal(url.hostname, "stats.nba.com");
    assert.equal(url.searchParams.get("SeasonYear"), "2024");
    assert.equal(url.searchParams.get("LeagueID"), "00");
    assert.equal(init.headers.accept, "application/json");
    assert.equal(Object.keys(init.headers).length, 2);
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("Play-In advancement preserves both winner and loser paths", () => {
  assert.deepEqual(readPlayInAdvancement("seven-eight"), {
    winner: { seed: 7 },
    loser: { stage: "eighth-seed", side: "high" },
  });
  assert.deepEqual(readPlayInAdvancement("nine-ten"), {
    winner: { stage: "eighth-seed", side: "low" },
    loser: { eliminated: true },
  });
  assert.deepEqual(readPlayInAdvancement("eighth-seed"), {
    winner: { seed: 8 },
    loser: { eliminated: true },
  });
});

/** @type {[string, (answer: any) => void][]} */
const corruptions = [
  [
    "wrong returned season",
    (answer) => {
      answer.bracket.seasonYear = "2025";
    },
  ],
  [
    "wrong league",
    (answer) => {
      answer.bracket.leagueId = "10";
    },
  ],
  [
    "unknown team",
    (answer) => {
      answer.bracket.playoffBracketSeries[0].highSeedTricode = "UNKNOWN";
    },
  ],
  [
    "negative wins",
    (answer) => {
      answer.bracket.playoffBracketSeries[0].highSeedSeriesWins = -1;
    },
  ],
  [
    "missing wins",
    (answer) => {
      delete answer.bracket.playoffBracketSeries[0].highSeedSeriesWins;
    },
  ],
  [
    "invalid round",
    (answer) => {
      answer.bracket.playoffBracketSeries[0].roundNumber = 5;
    },
  ],
  [
    "duplicate series",
    (answer) => {
      answer.bracket.playoffBracketSeries[1] = answer.bracket.playoffBracketSeries[0];
    },
  ],
  [
    "overfull round",
    (answer) => {
      answer.bracket.playoffBracketSeries.push({
        ...answer.bracket.playoffBracketSeries[0],
        seriesNumber: 8,
      });
    },
  ],
];
for (const [name, change] of corruptions) {
  test(`the adapter rejects ${name} before persistence`, async () => {
    const answer = structuredClone(fixtures.playoffs);
    change(answer);
    const read = createPostseasonAdapter(async () => Response.json(answer));
    await assert.rejects(read(2024, "playoffs"), /Invalid/);
  });
}

test("HTML returned with HTTP 200 is a failed feed", async () => {
  const read = createPostseasonAdapter(async () => new Response("<html>Denied</html>"));
  await assert.rejects(read(2024, "playoffs"), /rather than data/);
});

test("invalid Play-In facts are rejected before persistence", async () => {
  for (const change of [
    (record) => {
      record.nextGameDateTimeUTC = "not-a-date";
    },
    (record) => {
      record.matchupType = "Unknown round";
    },
    (record) => {
      record.highSeedRank = -1;
    },
    (record) => {
      record.nextGameId = 123;
    },
    (record) => {
      record.nextGameDateTimeUTC = 0;
    },
  ]) {
    const answer = structuredClone(fixtures["play-in"]);
    change(answer.bracket.playInBracketSeries[8]);
    const read = createPostseasonAdapter(async () => Response.json(answer));
    await assert.rejects(read(2024, "play-in"), /Invalid/);
  }
});

test("duplicate Play-In game references are rejected", async () => {
  const answer = structuredClone(fixtures["play-in"]);
  answer.bracket.playInBracketSeries[9].nextGameId =
    answer.bracket.playInBracketSeries[8].nextGameId;
  const read = createPostseasonAdapter(async () => Response.json(answer));
  await assert.rejects(read(2024, "play-in"), /duplicates/);
});

test("a hung postseason read aborts at the shared upstream deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const read = createPostseasonAdapter(
    async (input, init) =>
      new Promise((resolve, reject) => {
        signal = init.signal;
        signal.addEventListener("abort", () => reject(signal.reason));
        markStarted();
      }),
  );
  const pending = assert.rejects(read(2024, "playoffs"), /No answer/);
  await started;
  context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);
  await pending;
  assert.equal(signal.aborted, true);
});

test("unresolved future Play-In slots retain no invented game or team", async () => {
  const answer = structuredClone(fixtures["play-in"]);
  const record = answer.bracket.playInBracketSeries.find(
    (row) => row.matchupType === "Play-In WvL",
  );
  record.highSeedId = 0;
  record.highSeedTricode = "";
  record.highSeedRank = 0;
  record.nextGameId = "";
  const read = createPostseasonAdapter(async () => Response.json(answer));
  const field = await read(2024, "play-in");
  assert.deepEqual(field.matchups.find((row) => row.id === "2024-East-eighth-seed").high, {
    team: null,
    seed: null,
  });
  assert.equal(field.matchups.find((row) => row.id === "2024-East-eighth-seed").game, null);
});

function createHarness() {
  const context = createDurableObjectContext();
  const clock = { now: Date.parse("2026-10-31T03:00:00Z") };
  const Store = createSeasonStore({
    createLoadSnapshot: () => async () => ({ season: 2024 }),
    loadCurrentSnapshot: (load) => load(2024),
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60_000,
    listNotifications: () => [],
  });
  const store = new Store(context.ctx, {}, { now: () => clock.now });
  const state = { reads: 0, mode: "valid", wait: Promise.resolve(), onRead: () => {} };
  const identities = createIdentityLookup(context.ctx.storage, "nba");
  const fetchImpl = async (input) => {
    state.reads += 1;
    state.onRead();
    await state.wait;
    if (state.mode === "failed") return new Response("Unavailable", { status: 503 });
    const answer = structuredClone(fixtures[readKind(input)]);
    if (state.mode === "wrong-season") answer.bracket.seasonYear = "2025";
    if (state.mode === "malformed" && readKind(input) === "playoffs")
      answer.bracket.playoffBracketSeries[0].highSeedSeriesWins = -1;
    return Response.json(answer);
  };
  const createReader = (fetchWith = fetchImpl) =>
    createPostseasonReader({
      storage: context.ctx.storage,
      docs: store.docs,
      identities,
      fetchImpl: fetchWith,
      now: () => clock.now,
    });
  return { ...context, clock, store, state, identities, createReader, fetchImpl };
}

test("the actual store writer shares concurrent reads, keeps opaque mappings and publishes no unchanged documents", async () => {
  const { createReader, state, identities, stored, sockets, clock } = createHarness();
  const messages = [];
  sockets.push({ send: (message) => messages.push(JSON.parse(message)) });
  const reader = createReader();
  const [first, repeated] = await Promise.all([reader.read(2024), reader.read(2024)]);
  assert.deepEqual(first, repeated);
  assert.equal(state.reads, 2);
  assert.equal(first.playoffs.series.length, 15);
  for (const matchup of first.playIn.matchups) {
    assert.match(matchup.game.id, /^g_[a-z0-9]{12}$/);
    const entry = await identities.readEntry("game", matchup.game.id);
    assert.equal(entry.league, "nba");
    assert.equal(entry.facts.season, 2024);
    assert.equal(entry.facts.competition, "play-in");
    assert.equal(await identities.read("game", "nba", entry.vendors.nba), matchup.game.id);
  }
  assert.equal(stored.get("postseason/2024-play-in").matchups.length, 6);
  const count = messages.length;
  clock.now += 6000;
  await createReader().read(2024);
  assert.equal(state.reads, 2);
  assert.equal(messages.length, count);
});

for (const mode of ["failed", "wrong-season", "malformed"]) {
  test(`the actual writer preserves usable records across ${mode} reads, restarts and recovery`, async () => {
    const { createReader, clock, state, stored } = createHarness();
    const first = await createReader().read(2024);
    const previous = structuredClone(stored.get("postseason/2024-playoffs"));
    clock.now += 25 * 60 * 60 * 1000;
    state.mode = mode;
    const failed = await createReader().read(2024);
    assert.deepEqual(failed.playoffs, first.playoffs);
    assert.deepEqual(stored.get("postseason/2024-playoffs"), previous);
    assert.ok(failed.failures.playoffs);
    assert.equal(failed.nextReadAt, clock.now + FAILED_FEED_WAIT_MS);
    const count = state.reads;
    clock.now += 6000;
    await createReader().read(2024);
    assert.equal(state.reads, count);
    clock.now = failed.nextReadAt;
    state.mode = "valid";
    const recovered = await createReader().read(2024);
    assert.deepEqual(recovered.failures, {});
    assert.deepEqual(recovered.playIn, first.playIn);
    assert.equal(state.reads, count + (mode === "malformed" ? 1 : 2));
  });
}

test("cold failures remain visible and do not create identities or empty canonical documents", async () => {
  const { createReader, state, identities, stored } = createHarness();
  state.mode = "failed";
  const result = await createReader().read(2024);
  assert.equal(result.playoffs, null);
  assert.equal(result.playIn, null);
  assert.equal(Object.keys(result.failures).length, 2);
  assert.equal(stored.has("postseason/2024-playoffs"), false);
  assert.deepEqual(await identities.readStatus(), {
    games: 0,
    players: 0,
    unmatched: 0,
    disputed: 0,
  });
});

test("independent store readers discovering the same games concurrently retain one identity per game", async () => {
  const { createReader, identities, state } = createHarness();
  let release;
  state.wait = new Promise((resolve) => {
    release = resolve;
  });
  let allStarted;
  const started = new Promise((resolve) => {
    allStarted = resolve;
  });
  state.onRead = () => {
    if (state.reads === 4) allStarted();
  };
  const pending = Promise.all([createReader().read(2024), createReader().read(2024)]);
  await started;
  release();
  const [first, second] = await pending;
  assert.deepEqual(first.playIn, second.playIn);
  assert.equal((await identities.readStatus()).games, 6);
  assert.equal(state.reads, 4);
});

test("the reader obeys the store request budget without turning skipped work into feed failures", async () => {
  const { createReader, fetchImpl, state } = createHarness();
  const budget = createRequestBudget(fetchImpl, 1);
  const result = await createReader(budget.fetchImpl).read(2024);
  assert.equal(state.reads, 1);
  assert.equal(budget.remaining(), 0);
  assert.deepEqual(result.failures, {});
  assert.equal([result.playoffs, result.playIn].filter(Boolean).length, 1);
});

test("ingestion preserves a disputed mapping and its usable source document until reconciliation", async () => {
  const { createReader, clock, identities, stored } = createHarness();
  const first = await createReader().read(2024);
  const id = first.playIn.matchups[0].game.id;
  const entry = await identities.readEntry("game", id);
  await identities.save([
    {
      type: "game",
      vendor: "nba",
      vendorId: entry.vendors.nba,
      internalId: id,
      evidence: { method: "discovery" },
      disputed: true,
    },
  ]);
  clock.now += 25 * 60 * 60 * 1000;
  const result = await createReader().read(2024);
  assert.equal((await identities.readStatus()).disputed, 1);
  assert.match(result.failures["play-in"], /disputed/);
  assert.deepEqual(result.playIn, first.playIn);
  assert.deepEqual(stored.get("postseason/2024-play-in"), first.playIn);
});
