import { identityPolicy as wnbaIdentityPolicy } from "../apps/wnba/worker/src/identity-policy.js";
import { trimNetworkAnswer, readIdentityGames } from "../shared/worker/espn-adapter.js";
import { normalizeGame as normalizeMlbGame } from "../apps/mlb/worker/src/adapters/feed-games.js";
import { describeEspnBoxScore } from "../apps/wnba/worker/src/adapters/espn-box-score.js";
import { readPlayerIndex } from "../apps/wnba/tests/player-fixtures.js";
import { RequestBudgetExhausted } from "../shared/worker/request-budget.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDENTITY_AUDIT_VERSION } from "../shared/worker/identity-backfill.js";
import { createIdentityLookup } from "../shared/worker/identity.js";
import { reconcileIdentities } from "../shared/worker/identity-matching.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { SeasonStore as MlbStore } from "../apps/mlb/worker/src/store.js";
import { SeasonStore as WnbaStore } from "../apps/wnba/worker/src/store.js";
import { buildSnapshot as buildMlb } from "../apps/mlb/worker/src/adapters/mlb.js";
import { buildSnapshot as buildWnba } from "../apps/wnba/worker/src/adapters/wnba.js";
import { createSeasonStore } from "../shared/worker/season-store.js";
import { identityPolicy } from "../apps/mlb/worker/src/identity-policy.js";

const createNative = (type, id, facts = {}) => ({
  type,
  vendor: "league",
  vendorId: id,
  internalId: id,
  facts,
  evidence: { method: "existing-id" },
});
const createGame = (id, extra = {}) => ({
  id,
  away: "A",
  home: "B",
  start: "2026-06-01T18:00:00Z",
  ...extra,
});

test("concurrent discovery is one atomic creation across independent lookup instances and retries", async () => {
  const { ctx } = createDurableObjectContext();
  const lookups = Array.from({ length: 12 }, () => createIdentityLookup(ctx.storage, "mlb"));
  const ids = await Promise.all(
    lookups.map((lookup) => lookup.discover({ type: "game", vendor: "espn", vendorId: "same" })),
  );
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^g_[A-Za-z0-9_-]{12}$/);
  assert.equal(await lookups[0].read("game", "espn", "same"), ids[0]);
  assert.equal((await lookups[0].readStatus()).games, 1);
  assert.notEqual(
    await lookups[0].discover({ type: "player", vendor: "espn", vendorId: "same" }),
    ids[0],
  );
  const wnba = createIdentityLookup(ctx.storage, "wnba");
  assert.notEqual(await wnba.discover({ type: "game", vendor: "espn", vendorId: "same" }), ids[0]);
  assert.equal(await lookups[0].read("game", "balldontlie", "same"), null);
});

test("a failed identity transaction rolls back its associations and counters", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "mlb");
  const put = ctx.storage.put;
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (callback) =>
    transaction((storage) =>
      callback({
        ...storage,
        put: async (key, value) => {
          if (key.startsWith("identity:vendor:")) throw new Error("disk full");
          await storage.put(key, value);
        },
      }),
    );
  await assert.rejects(lookup.save([createNative("game", "a")]), /disk full/);
  assert.equal(stored.size, 0);
  ctx.storage.put = put;
  ctx.storage.transaction = transaction;
  await lookup.save([createNative("game", "a")]);
  assert.equal((await lookup.readStatus()).games, 1);
});

test("identity consistency checks detect broken forward and reverse references", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "mlb");
  await lookup.save([createNative("game", "7")]);
  assert.equal(await lookup.countMappingConflicts("identity:entity:mlb:game:7"), 0);
  const key = "identity:vendor:league:mlb:game:7";
  const mapping = await ctx.storage.get(key);
  await ctx.storage.put(key, { ...mapping, internalId: "missing" });
  assert.equal(await lookup.countMappingConflicts("identity:entity:mlb:game:7"), 0);
  assert.equal(await lookup.countMappingConflicts(key), 1);
});

test("postponement and resume keep a game association even when its date and time move", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "wnba");
  const native = createGame("old-id");
  await lookup.save([createNative("game", native.id, native)]);
  await reconcileIdentities(lookup, {
    type: "game",
    vendor: "espn",
    natives: [native],
    records: [createGame("event")],
  });
  for (const start of ["2026-06-05T18:30:00Z", "2026-06-09T21:00:00Z"]) {
    await reconcileIdentities(lookup, {
      type: "game",
      vendor: "espn",
      natives: [{ ...native, start }],
      records: [createGame("event")],
    });
    assert.equal(await lookup.read("game", "espn", "event"), "old-id");
  }
  assert.equal((await lookup.readStatus()).disputed, 0);
  assert.equal((await lookup.readEntry("game", "old-id")).evidence.espn.method, "teams-day");
});

test("doubleheaders need explicit game numbers and corroborating teams and day; equal counts prove nothing", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "mlb");
  const natives = [createGame("one", { gameNumber: 1 }), createGame("two", { gameNumber: 2 })];
  await lookup.save(natives.map((game) => createNative("game", game.id, game)));
  await reconcileIdentities(lookup, {
    type: "game",
    vendor: "espn",
    natives,
    records: [createGame("e1"), createGame("e2")],
  });
  assert.equal(await lookup.read("game", "espn", "e1"), null);
  assert.equal((await lookup.readStatus()).unmatched, 2);
  const records = [
    createGame("e2", { gameNumber: 2, start: "2026-06-01T17:00:00Z" }),
    createGame("e1", { gameNumber: 1, start: "2026-06-01T22:00:00Z" }),
  ];
  await reconcileIdentities(lookup, { type: "game", vendor: "espn", natives, records });
  assert.equal(await lookup.read("game", "espn", "e1"), "one");
  assert.equal(await lookup.read("game", "espn", "e2"), "two");
  assert.equal((await lookup.readStatus()).unmatched, 0);
  await reconcileIdentities(lookup, {
    type: "game",
    vendor: "balldontlie",
    natives,
    records: [createGame("wrong", { gameNumber: 1, home: "C" })],
  });
  assert.equal(await lookup.read("game", "balldontlie", "wrong"), null);
});

test("decisive doubleheader evidence repairs a wrong swap atomically and uncertain evidence retains a dispute", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "mlb");
  const natives = [createGame("one", { gameNumber: 1 }), createGame("two", { gameNumber: 2 })];
  await lookup.save(natives.map((game) => createNative("game", game.id, game)));
  await lookup.save([
    { ...createNative("game", "one"), vendor: "espn", vendorId: "e2" },
    { ...createNative("game", "two"), vendor: "espn", vendorId: "e1" },
  ]);
  await lookup.save([
    {
      type: "game",
      vendor: "espn",
      vendorId: "e1",
      internalId: "one",
      evidence: { method: "teams-day" },
    },
  ]);
  assert.equal(await lookup.read("game", "espn", "e1"), "two");
  assert.equal((await lookup.readStatus()).disputed, 1);
  await reconcileIdentities(lookup, {
    type: "game",
    vendor: "espn",
    natives,
    records: [createGame("e1", { gameNumber: 1 }), createGame("e2", { gameNumber: 2 })],
  });
  assert.equal(await lookup.read("game", "espn", "e1"), "one");
  assert.equal(await lookup.read("game", "espn", "e2"), "two");
  assert.deepEqual((await lookup.readEntry("game", "one")).vendors, { league: "one", espn: "e1" });
  assert.equal((await lookup.readStatus()).disputed, 0);
  assert.equal((await lookup.readStatus()).unmatched, 0);
});

test("player matches need corroboration and survive trades, with unmatched and disputed counted separately", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "wnba");
  const native = { id: "native", firstName: "Alex", lastName: "Jones", team: "A", number: "12" };
  await lookup.save([createNative("player", "native", native)]);
  const match = (natives, records) =>
    reconcileIdentities(lookup, { type: "player", vendor: "espn", natives, records });
  await match([native], [{ ...native, id: "event", number: undefined }]);
  assert.equal(await lookup.read("player", "espn", "event"), null);
  await match([native], [{ ...native, id: "event" }]);
  await match([{ ...native, team: "B", number: "20" }], [{ ...native, id: "event" }]);
  assert.equal(await lookup.read("player", "espn", "event"), "native");
  await match(
    [{ ...native, id: "other" }],
    [
      { ...native, id: "event" },
      { id: "unknown", firstName: "Other", lastName: "Player" },
    ],
  );
  const status = await lookup.readStatus();
  assert.equal(status.unmatched, 1);
  assert.equal(status.disputed, 1);
});

/** @type {[string, typeof MlbStore | typeof WnbaStore][]} */
const STORES = [
  ["mlb", MlbStore],
  ["wnba", WnbaStore],
];
for (const [app, Store] of STORES) {
  test(`${app}: actual document writers add facts and register game and player identities on repeated concurrent writes`, async () => {
    const { ctx, stored } = createDurableObjectContext();
    const store = new Store(
      ctx,
      {},
      {
        fetchImpl: async () => {
          throw new Error("no network");
        },
      },
    );
    const id = app === "wnba" ? "1052600001" : "123";
    const game = {
      id,
      state: "pre",
      start: "2026-06-01T18:00:00Z",
      away: app === "wnba" ? { team: "A" } : "A",
      home: app === "wnba" ? { team: "B" } : "B",
      ...(app === "mlb" && { doubleheader: 2, series: "AL_DS1" }),
    };
    await Promise.all([
      store.docs.write("seasons/2026", { year: 2026, games: [game] }),
      store.docs.write("playerIndex/2026", {
        season: 2026,
        players: [{ id: "44", firstName: "Alex", lastName: "Jones", team: "A" }],
      }),
    ]);
    await store.docs.write("seasons/2026", { year: 2026, games: [game] });
    const saved = stored.get("seasons/2026").games[0];
    assert.equal(saved.id, id);
    assert.equal(saved.season, 2026);
    if (app === "wnba") assert.equal(saved.isCupFinal, true);
    else {
      assert.equal(saved.round, "DS");
      assert.equal(saved.doubleheader, 2);
      assert.equal((await store.identities.lookup.readEntry("game", id)).facts.gameNumber, 2);
    }
    assert.equal(await store.identities.lookup.read("game", app, id), id);
    assert.equal(await store.identities.lookup.read("player", app, "44"), "44");
    assert.equal((await store.identities.lookup.readStatus()).games, 1);
    assert.equal((await store.identities.lookup.readStatus()).players, 1);
  });
}

test("actual backfill resumes across restarts, fills all seasons and cached details without network or renaming references", async () => {
  const { ctx, stored } = createDurableObjectContext();
  let requests = 0;
  const options = {
    fetchImpl: async () => {
      requests += 1;
      throw new Error("no network");
    },
  };
  for (const year of [2024, 2025, 2026]) {
    const id = `105${String(year).slice(2)}00001`;
    stored.set(`seasons/${year}`, {
      year,
      games: [{ id, state: "final", start: `${year}-06-01T18:00:00Z` }],
    });
    stored.set(`games/${id}`, { boxScore: { id, state: "final", period: 4 } });
    stored.set(`players/${year}-44`, { playoffPoints: { [id]: 14 } });
  }
  const cachedKey = "job:details:detail-answer:/player?id=44&season=2025";
  stored.set(cachedKey, {
    at: 12,
    body: {
      id: "44",
      season: 2025,
      firstName: "Alex",
      lastName: "Jones",
      lastGame: { gameId: "1052500001", points: 14 },
    },
  });
  stored.set("push:reminder-games", {
    games: [{ id: "1052600001", season: 2026, start: 1234 }],
    verifiedAt: 111,
  });
  stored.set("push:subscription:example", {
    reminderReceipts: { 1052600001: { state: "pending" } },
    messages: [{ game: "1052600001", season: 2026 }],
  });
  const privateBefore = structuredClone(stored.get("push:subscription:example"));
  let store = new WnbaStore(ctx, {}, options);
  await store.identities.backfill(store.docs);
  store = new WnbaStore(ctx, {}, options);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).backfill.complete, true);
  for (const year of [2024, 2025, 2026]) {
    const id = `105${String(year).slice(2)}00001`;
    assert.equal(stored.get(`seasons/${year}`).games[0].isCupFinal, true);
    assert.equal(stored.get(`games/${id}`).boxScore.season, year);
    assert.equal(await store.identities.lookup.read("game", "wnba", id), id);
  }
  assert.equal(stored.get(cachedKey).body.lastGame.isCupFinal, true);
  assert.deepEqual(stored.get("push:subscription:example"), privateBefore);
  assert.equal(stored.get("push:reminder-games").verifiedAt, 111);
  const before = structuredClone([...stored]);
  await store.identities.backfill(store.docs);
  assert.deepEqual([...stored], before);
  assert.equal(requests, 0);
});

test("recorded adapters populate explicit facts without changing IDs", () => {
  const readFixture = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const mlb = readFixture("../apps/mlb/tests/fixtures/2026-10-09-season.json");
  const baseball = buildMlb(mlb.responses, { season: mlb.season, now: Date.parse(mlb.now) });
  const games = Object.values(baseball.schedule).flat();
  assert.ok(games.length > 2000);
  assert.ok(
    games.every(
      (game) =>
        game.season === 2026 &&
        (game.gameNumber === undefined || Number.isInteger(game.gameNumber)),
    ),
  );
  assert.equal(games.find((game) => game.series === "AL_DS1").round, "DS");
  const doubleheader = games.find((game) => game.doubleheader === 2);
  assert.ok(doubleheader);
  assert.equal(Object.hasOwn(doubleheader, "gameNumber"), false);
  const wnba = readFixture("../apps/wnba/tests/fixtures/2026-09-30-afternoon.json");
  const wholeSchedule = readFixture("../apps/wnba/tests/fixtures/2026-10-01-games.json").preview
    .schedule;
  const basketball = buildWnba(
    { ...wnba.responses, schedule: wholeSchedule },
    { season: wnba.season, now: Date.parse(wnba.now) },
  );
  assert.ok(basketball.schedule.some((game) => game.isCupFinal));
  assert.ok(
    basketball.schedule.every(
      (game) => game.season === 2026 && typeof game.isCupFinal === "boolean",
    ),
  );
});

test("MLB backfill fills boxes, series and schedules across seasons without changing revision or progress keys", async () => {
  const { ctx, stored } = createDurableObjectContext();
  for (const year of [2025, 2026]) {
    stored.set(`games/${year}`, {
      id: String(year),
      state: "final",
      away: { batters: [{ id: 44, name: "Alex" }] },
      home: {},
    });
    stored.set(`schedules-${year}/${year}-10`, {
      year,
      games: [
        {
          id: String(year),
          state: "final",
          away: "A",
          home: "B",
          series: "AL_DS1",
          doubleheader: 2,
          start: `${year}-10-01T20:00:00Z`,
        },
      ],
    });
    stored.set(`seasons/${year}`, {
      year,
      series: { AL_DS1: { winsA: 1, winsB: 0 } },
      log: [{ series: "AL_DS1", kind: "game" }],
    });
    stored.set(`schedule-revisions/${year}`, { revision: 8, isWhole: true });
    stored.set(`job:highlights:filled:${year}:v2`, { revision: "8", ids: [String(year)] });
  }
  const untouched = [...stored].filter(
    ([key]) => key.startsWith("job:") || key.startsWith("schedule-revisions/"),
  );
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const store = new MlbStore(
      ctx,
      {},
      {
        fetchImpl: async () => {
          throw new Error("unexpected vendor read");
        },
      },
    );
    await store.identities.backfill(store.docs);
    if ((await store.identities.readStatus()).backfill.complete) break;
  }
  for (const year of [2025, 2026]) {
    assert.equal(stored.get(`games/${year}`).season, year);
    assert.equal(stored.get(`schedules-${year}/${year}-10`).games[0].doubleheader, 2);
    assert.deepEqual(stored.get(`seasons/${year}`).series.AL_DS1, {
      league: "AL",
      round: "DS",
      winsA: 1,
      winsB: 0,
    });
    assert.equal(stored.get(`seasons/${year}`).log[0].round, "DS");
  }
  for (const [key, value] of untouched) assert.deepEqual(stored.get(key), value);
  const store = new MlbStore(ctx, {});
  assert.equal(await store.identities.lookup.read("player", "mlb", "44"), "44");
  assert.deepEqual((await store.identities.readStatus()).checks, {
    verified: true,
    missingEntries: 0,
    missingFacts: 0,
    competingMappings: 0,
  });
});

test("live work and reminders precede storage-only backfill, and a superseding alarm stops it", async () => {
  const order = [];
  const { ctx, stored } = createDurableObjectContext();
  const Store = createSeasonStore({
    identity: identityPolicy,
    createLoadSnapshot: () => async () => ({ season: 2026 }),
    loadCurrentSnapshot: async () => {
      order.push("live");
      return { season: 2026 };
    },
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60_000,
    listNotifications: () => [],
    backgroundJobs: {
      example: {
        chooseDelay: () => 60_000,
        updateStore: async () => {
          order.push("job");
        },
        updateHistory: async () => {
          order.push("history");
          throw new RequestBudgetExhausted("history allowance used");
        },
      },
    },
  });
  let requests = 0;
  const store = new Store(
    ctx,
    {},
    {
      now: () => 100,
      fetchImpl: async () => {
        requests += 1;
        throw new Error("unexpected vendor read");
      },
    },
  );
  store.reminders.checkDue = async () => {
    order.push("reminders");
  };
  const backfill = store.identities.backfillWhenDue;
  store.identities.backfillWhenDue = async (...args) => {
    order.push("backfill");
    await backfill(...args);
  };
  await store.alarm();
  await store.historyRun;
  assert.deepEqual(order, ["live", "reminders", "job", "history", "backfill"]);
  assert.equal(requests, 0);
  const before = structuredClone([...stored]);
  await backfill(store.docs, () => false);
  assert.deepEqual([...stored], before);
});

test("a temporary detail writer registers a newly seen player even after backfill completed", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  await ctx.storage.put("identity:backfill", { complete: true });
  await store.createJobStorage("details").put("detail-answer:/player?id=44&season=2026", {
    at: 123,
    body: { id: "44", firstName: "Alex", lastName: "Jones", lastGame: { gameId: "1052600001" } },
  });
  assert.equal(await store.identities.lookup.read("player", "wnba", "44"), "44");
  assert.equal(await store.identities.lookup.read("game", "wnba", "1052600001"), "1052600001");
  const cached = await store
    .createJobStorage("details")
    .get("detail-answer:/player?id=44&season=2026");
  assert.equal(cached.body.lastGame.season, 2026);
});

for (const [app, Store] of STORES) {
  test(`${app}: operational job status documents never become games`, async () => {
    const { ctx, stored } = createDurableObjectContext();
    const store = new Store(ctx, {}, { now: () => 0 });
    const status = { error: "", reads: 2, failures: [] };
    await store.docs.write("games/status", status);
    await store.docs.write("highlights/status", status);
    assert.deepEqual(stored.get("games/status"), status);
    assert.deepEqual(stored.get("highlights/status"), status);
    assert.equal(await store.identities.lookup.read("game", app, "status"), null);
    assert.equal((await store.identities.lookup.readStatus()).games, 0);
  });
}

test("box scores and highlights cannot replace an established MLB doubleheader number without evidence", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new MlbStore(ctx, {}, { now: () => 0 });
  await store.docs.write("schedules-2026/2026-06", {
    year: 2026,
    games: [
      createGame("7", { state: "final", doubleheader: 2, gameNumber: 2 }),
      createGame("8", { state: "final", doubleheader: 1 }),
    ],
  });
  await store.docs.write("games/7", { id: "7", state: "final", innings: [] });
  await store.docs.write("highlights/7", { id: "7", plays: [] });
  assert.equal((await store.identities.lookup.readEntry("game", "7")).facts.gameNumber, 2);
  assert.notEqual(stored.get("games/7").gameNumber, 1);
  assert.notEqual(stored.get("highlights/7").gameNumber, 1);
  assert.equal((await store.identities.lookup.readEntry("game", "8")).facts.gameNumber, 1);
  assert.equal(
    stored.get("schedules-2026/2026-06").games.find((game) => game.id === "8").gameNumber,
    undefined,
  );
});

test("contradictory evidence marks an established association disputed even without a replacement, and omission cannot clear it", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "mlb");
  const native = createGame("one", { gameNumber: 1 });
  await lookup.save([createNative("game", "one", native)]);
  const match = (record) =>
    reconcileIdentities(lookup, {
      type: "game",
      vendor: "espn",
      natives: [native],
      records: [record],
    });
  await match(createGame("event", { gameNumber: 1 }));
  for (const contradictory of [
    createGame("event", { gameNumber: 2 }),
    createGame("event", { away: "C" }),
  ]) {
    await match(contradictory);
    assert.equal(await lookup.read("game", "espn", "event"), "one");
    assert.equal((await lookup.readStatus()).disputed, 1);
    await match(createGame("event", { start: "2026-06-09T20:00:00Z" }));
    assert.equal((await lookup.readStatus()).disputed, 1);
    await match(createGame("event", { gameNumber: 1 }));
    assert.equal((await lookup.readStatus()).disputed, 0);
  }
});

test("redeployment after older writers ran invalidates completed coverage and rechecks preserved historical progress", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION - 1,
    complete: true,
    checkedDocuments: 123,
  });
  stored.set("poll:schedule", { release: "old-writer", dueAt: 9999 });
  stored.set("schedules-2025/2025-06", {
    year: 2025,
    games: [createGame("7", { state: "final" })],
  });
  stored.set("games/7", { id: "7", state: "final", innings: [] });
  stored.set("job:players:filled:2025", true);
  const store = new MlbStore(ctx, {}, { now: () => 0 });
  await store.startUpdating();
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  for (
    let iteration = 0;
    iteration < 60 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal(stored.get("games/7").season, 2025);
  assert.equal(stored.get("job:players:filled:2025"), true);
  assert.equal((await store.identities.readStatus()).checks.missingFacts, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("an alarm after older writers ran restarts incomplete coverage before replacing the poll release", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("identity:backfill", {
    complete: false,
    phase: "facts",
    cursor: "z",
    checkedDocuments: 123,
  });
  stored.set("poll:schedule", { release: "old-writer", dueAt: 0 });
  stored.set("schedules-2025/2025-06", {
    year: 2025,
    games: [createGame("7", { state: "final" })],
  });
  stored.set("games/7", { id: "7", state: "final", innings: [] });
  const Store = createSeasonStore({
    release: "current-writer",
    identity: identityPolicy,
    createLoadSnapshot: () => async () => ({ season: 2026 }),
    loadCurrentSnapshot: async () => ({ season: 2026 }),
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60_000,
    listNotifications: () => [],
  });
  const store = new Store(ctx, {}, { now: () => 0 });
  await store.alarm();
  await store.historyRun;
  for (
    let iteration = 0;
    iteration < 60 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal(stored.get("games/7").season, 2025);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

const readIdentityFixture = (app, file) =>
  JSON.parse(
    readFileSync(new URL(`../apps/${app}/tests/fixtures/${file}.json`, import.meta.url), "utf8"),
  );
const createEspnEvent = (id, gameNumber = undefined) => ({
  id,
  date: "2026-06-01T18:00:00Z",
  competitions: [
    {
      gameNumber,
      competitors: [
        { id: "1", homeAway: "away" },
        { id: "2", homeAway: "home" },
      ],
    },
  ],
});

const findIdentityTeam = (id) => ({ 1: "A", 2: "B" })[id] ?? null;

test("WNBA snapshot identityRecords register ESPN mappings and unchanged batches reuse native discovery", async () => {
  const fixture = readIdentityFixture("wnba", "2026-09-30-afternoon");
  const snapshot = buildWnba(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });
  const context = createDurableObjectContext();
  const store = new WnbaStore(context.ctx, {}, { now: () => Date.parse(fixture.now) });
  const game = {
    id: "1022600001",
    state: "pre",
    start: "2026-06-01T18:00:00Z",
    away: { team: "A" },
    home: { team: "B" },
  };
  await store.docs.write("seasons/2026", { year: 2026, games: [game] });
  const identityRecords = readIdentityGames(
    [{ events: [createEspnEvent("event")] }],
    findIdentityTeam,
  );
  const update = { ...snapshot, identityRecords };
  const saved = await store.saveSeason(update);
  assert.ok(saved.snapshot);
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), game.id);
  const original = context.ctx.storage.list;
  let nativeLists = 0;
  let vendorReads = 0;
  const read = store.identities.lookup.read;
  store.identities.lookup.read = (...args) => {
    vendorReads += 1;
    return read(...args);
  };
  context.ctx.storage.list = async (options) => {
    if (options.prefix === "identity:entity:wnba:game:") nativeLists += 1;
    return original(options);
  };
  await store.saveSeason(update);
  assert.equal(nativeLists, 0);
  assert.equal(vendorReads, 0);
});

test("saved feed:networks months backfill ESPN mappings through restarts and reject bad events independently", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("seasons/2026", {
    year: 2026,
    games: [
      {
        id: "1022600001",
        state: "pre",
        start: "2026-06-01T18:00:00Z",
        away: { team: "ATL" },
        home: { team: "NYL" },
      },
    ],
  });
  const event = createEspnEvent("event");
  event.competitions[0].competitors = [
    { id: "20", homeAway: "away" },
    { id: "9", homeAway: "home" },
  ];
  stored.set("feed:networks:202606", {
    edition: 1,
    data: trimNetworkAnswer({
      events: [
        event,
        { ...event, id: "", competitions: [{ ...event.competitions[0], gameNumber: 0 }] },
      ],
    }),
  });
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const store = new WnbaStore(ctx, {});
    if ((await store.identities.readStatus()).backfill.complete) break;
    await store.identities.backfill(store.docs);
  }
  const store = new WnbaStore(ctx, {});
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), "1022600001");
  const status = await store.identities.readStatus();
  assert.equal(status.backfill.complete, true);
  assert.equal(status.errors, 1);
  assert.equal(status.checks.verified, false);
});

test("identity failure preserves sports writes, season notifications and reminder verification", async () => {
  const fixture = readIdentityFixture("wnba", "2026-09-30-afternoon");
  const snapshot = buildWnba(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {}, { now: () => Date.parse(fixture.now) });
  const notified = [];
  const reminders = [];
  store.notifyUpdates = async (before, after) => {
    notified.push(after);
  };
  store.reminders.saveGames = async (games) => {
    reminders.push(games);
  };
  ctx.storage.transaction = async () => {
    throw new Error("identity storage unavailable");
  };
  const update = {
    ...snapshot,
    identityRecords: readIdentityGames(
      [{ events: [createEspnEvent(""), createEspnEvent("bad-number", 0)] }],
      findIdentityTeam,
    ),
  };
  let result;
  await assert.doesNotReject(async () => {
    result = await store.saveSeason(update);
  });
  assert.ok(result.snapshot);
  assert.ok(stored.get("seasons/2026"));
  assert.equal(notified.length, 1);
  assert.equal(reminders.length, 1);
  assert.ok(Array.isArray(reminders[0]));
  assert.ok((await store.identities.readStatus()).errors > 0);
});

test("backfill records a failed document, advances past it, and never labels incomplete coverage verified", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("games/1022600001", { id: "1022600001", state: "final", period: 4 });
  stored.set("seasons/2026", {
    year: 2026,
    games: [{ id: "1022600002", state: "pre", start: "2026-06-01T18:00:00Z" }],
  });
  for (let year = 1997; year < 2026; year += 1) stored.set(`seasons/${year}`, { year, games: [] });
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        put: async (key, value) => {
          if (key === "identity:entity:wnba:game:1022600001")
            throw new Error("bad stored identity");
          return inner.put(key, value);
        },
      }),
    );
  const store = new WnbaStore(ctx, {});
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  const status = await store.identities.readStatus();
  assert.equal(status.backfill.complete, true);
  assert.ok(status.errors > 0);
  assert.equal(status.checks.verified, false);
  assert.equal(await store.identities.lookup.read("game", "wnba", "1022600002"), "1022600002");
  ctx.storage.transaction = transaction;
  await store.identities.backfill(store.docs);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("ESPN fallback identities reach the ledger but never stored or served box scores or detail answers", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const index = readPlayerIndex();
  const fixture = readIdentityFixture("wnba", "2026-10-29-espn-box-scores");
  const [id, { summary: original }] = Object.entries(fixture.games)[0];
  const summary = structuredClone(original);
  const athlete = summary.boxscore.players[0].statistics[0].athletes[0].athlete;
  athlete.id = "espn-player";
  athlete.jersey = "12";
  athlete.dateOfBirth = "1995-01-02T00:00Z";
  const box = describeEspnBoxScore(summary, id, index);
  const player =
    box.away.players.find((row) => row.espnIdentity?.id === athlete.id) ??
    box.home.players.find((row) => row.espnIdentity?.id === athlete.id);
  assert.ok(player.id);
  await store.docs.write("rosters/2026-" + box.away.team, {
    season: 2026,
    team: box.away.team,
    players: [{ ...player, espnIdentity: undefined, number: "12", birthdate: "1995-01-02" }],
  });
  await store.docs.write("games/" + id, { boxScore: box });
  await store
    .createJobStorage("details")
    .put("detail-answer:/box-score?id=" + id, { body: box, at: 1 });
  assert.equal(await store.identities.lookup.read("player", "espn", athlete.id), String(player.id));
  assert.ok(!JSON.stringify(stored.get("games/" + id)).includes("espnIdentity"));
  assert.ok(
    !JSON.stringify(stored.get("job:details:detail-answer:/box-score?id=" + id)).includes(
      "espnIdentity",
    ),
  );
  assert.ok(!(await (await store.readDoc("games/" + id)).text()).includes("espnIdentity"));
  ctx.storage.transaction = async () => {
    throw new Error("identity write failure");
  };
  await store.docs.write("games/" + id, { boxScore: box });
  assert.ok(!JSON.stringify(stored.get("games/" + id)).includes("espnIdentity"));
});

test("unchanged raw documents publish nothing after stored fact expansion for both actual stores", async () => {
  for (const [app, Store] of STORES) {
    const { ctx, sockets } = createDurableObjectContext();
    const messages = [];
    sockets.push({ send: (message) => messages.push(message) });
    const store = new Store(ctx, {});
    const id = app === "wnba" ? "1052600001" : "123";
    /** @type {[string, any][]} */
    const documents = [
      ["games/" + id, { boxScore: { id, state: "final", season: 2026 } }],
      ["highlights/" + id, { id, recap: null, story: null, plays: [] }],
    ];
    if (app === "wnba")
      documents.push([
        "espnMatches/" + id,
        { id, eventId: "event", away: "A", home: "B", start: "2026-06-01T18:00:00Z" },
      ]);
    for (const [key, value] of documents) {
      await store.docs.write(key, value);
      const before = messages.length;
      await store.docs.write(key, value);
      assert.equal(messages.length, before, app + " " + key);
    }
  }
});

test("network trimming retains real doubleheader evidence and MLB missing dates omit season", () => {
  const trimmed = trimNetworkAnswer({ events: [createEspnEvent("event", 2)] });
  assert.equal(trimmed.events[0].competitions[0].gameNumber, 2);
  assert.equal(readIdentityGames([trimmed], findIdentityTeam).records[0].gameNumber, 2);
  assert.ok(!Object.hasOwn(normalizeMlbGame({ gamePk: 1 }), "season"));
  assert.ok(!Object.hasOwn(normalizeMlbGame({ gamePk: 1, officialDate: "" }), "season"));
});

test("completed coverage requires zero missing entries, facts and competing mappings", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  for (const field of ["missingEntries", "missingFacts", "conflicts"]) {
    stored.set("identity:backfill", {
      version: IDENTITY_AUDIT_VERSION,
      complete: true,
      checkedDocuments: 1,
      [field]: 1,
    });
    assert.equal((await store.identities.readStatus()).checks.verified, false, field);
  }
  stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    complete: true,
    checkedDocuments: 1,
  });
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("narrowing candidate games still checks contradictory facts on an established association", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  await store.docs.write("seasons/2026", {
    year: 2026,
    games: [
      {
        id: "1022600001",
        state: "pre",
        start: "2026-06-01T18:00:00Z",
        away: { team: "A" },
        home: { team: "B" },
      },
    ],
  });
  await store.identities.saveVendorGames([createGame("event")]);
  await store.identities.saveVendorGames([createGame("event", { home: "C" })]);
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), "1022600001");
  assert.equal((await store.identities.readStatus()).disputed, 1);
});

test("a recovered cached-detail identity write clears only its failure and permits coverage verification", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const transaction = ctx.storage.transaction;
  const key = "detail-answer:/player?id=44&season=2026";
  const value = { at: 1, body: { id: "44", firstName: "Alex", lastName: "Jones", season: 2026 } };
  ctx.storage.transaction = async () => {
    throw new Error("temporary identity failure");
  };
  await store.createJobStorage("details").put(key, value);
  assert.equal((await store.identities.readStatus()).errors, 1);
  ctx.storage.transaction = transaction;
  await store.createJobStorage("details").put(key, value);
  assert.equal((await store.identities.readStatus()).errors, 0);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  stored.set("identity:backfill", { version: IDENTITY_AUDIT_VERSION, complete: true });
  await store.docs.write("games/1022600001", {
    boxScore: { id: "1022600001", away: { players: [{ id: 44, espnIdentity: { id: "" } }] } },
  });
  assert.equal((await store.identities.readStatus()).errors, 1);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("rejected cached records keep health uncertain without restarting completed backfill", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("feed:networks:202606", { data: { events: [createEspnEvent("")] } });
  const store = new WnbaStore(ctx, {});
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  const progress = structuredClone(stored.get("identity:backfill"));
  assert.equal((await store.identities.readStatus()).errors, 1);
  for (let iteration = 0; iteration < 3; iteration += 1)
    await store.identities.backfill(store.docs);
  assert.deepEqual(stored.get("identity:backfill"), progress);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("backfill recovers a live cached-detail failure under the same physical source key", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const transaction = ctx.storage.transaction;
  const key = "detail-answer:/player?id=44&season=2026";
  ctx.storage.transaction = async () => {
    throw new Error("temporary identity failure");
  };
  await store
    .createJobStorage("details")
    .put(key, { at: 1, body: { id: "44", firstName: "Alex", lastName: "Jones", season: 2026 } });
  assert.equal((await store.identities.readStatus()).errors, 1);
  ctx.storage.transaction = transaction;
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("cached-detail rejections are per answer and eviction or document deletion clears only its errors", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const answers = store.createJobStorage("details");
  const bad = { at: 1, body: { season: 2026, players: [{ id: 44, espnIdentity: { id: "" } }] } };
  await answers.put("detail-answer:/roster?season=2026&team=ATL", bad);
  await answers.put("detail-answer:/roster?season=2026&team=NYL", {
    at: 1,
    body: { season: 2026, players: [] },
  });
  assert.equal((await store.identities.readStatus()).errors, 1);
  await store.docs.write("games/1022600001", { id: "1022600001", players: bad.body.players });
  assert.equal((await store.identities.readStatus()).errors, 2);
  await answers.delete("detail-answer:/roster?season=2026&team=ATL");
  assert.equal((await store.identities.readStatus()).errors, 1);
  await store.docs.remove("games/1022600001");
  assert.equal((await store.identities.readStatus()).errors, 0);
});

test("identity outages preserve prepared sports facts and never announce unchanged fallback copies", async () => {
  for (const [app, Store] of STORES) {
    const { ctx } = createDurableObjectContext();
    const store = new Store(ctx, {});
    const id = app === "wnba" ? "1052600001" : "44";
    const raw = {
      boxScore: { id, state: "final", season: 2026 },
      ...(app === "mlb" && { series: "AL_DS1" }),
    };
    await store.docs.write("games/" + id, raw);
    const previous = await store.docs.read("games/" + id);
    const transaction = ctx.storage.transaction;
    ctx.storage.transaction = async () => {
      throw new Error("identity unavailable");
    };
    const changed = [];
    store.announceChange = (key) => {
      changed.push(key);
    };
    await store.docs.write("games/" + id, raw);
    assert.deepEqual(await store.docs.read("games/" + id), previous);
    assert.deepEqual(changed, []);
    ctx.storage.transaction = transaction;
    await store.docs.write("games/" + id, raw);
    assert.deepEqual(changed, []);
  }
});

test("successful unchanged writes never put or delete identity-error keys", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const document = { id: "1022600001", season: 2026, state: "final", period: 4 };
  await store.docs.write("games/1022600001", document);
  const put = ctx.storage.put;
  const remove = ctx.storage.delete;
  const mutations = [];
  ctx.storage.put = async (key, value) => {
    if (String(key).startsWith("identity:error:")) mutations.push(key);
    return put(key, value);
  };
  ctx.storage.delete = async (key) => {
    if (String(key).startsWith("identity:error:")) mutations.push(key);
    return remove(key);
  };
  await store.docs.write("games/1022600001", document);
  await store.identities.saveVendorGames([], 0);
  assert.deepEqual(mutations, []);
});

test("raw and retained ESPN game numbers normalize identically and WNBA unique games still link", async () => {
  const game = {
    id: "1022600001",
    start: "2026-06-01T18:00:00Z",
    state: "pre",
    away: { team: "A" },
    home: { team: "B" },
  };
  for (const gameNumber of [null, "2", 0, -1, 1.5, 2]) {
    const { ctx } = createDurableObjectContext();
    const store = new WnbaStore(ctx, {});
    await store.docs.write("seasons/2026", { year: 2026, games: [game] });
    const answer = { events: [createEspnEvent("event", gameNumber)] };
    const live = readIdentityGames([answer], findIdentityTeam);
    assert.equal(live.rejected, 0);
    assert.equal(live.records.length, 1);
    assert.deepEqual(live, readIdentityGames([trimNetworkAnswer(answer)], findIdentityTeam));
    await store.identities.saveVendorGames(live.records, live.rejected, store.docs);
    assert.equal(await store.identities.lookup.read("game", "espn", "event"), game.id);
    const match = await store.docs.read("espnMatches/" + game.id);
    assert.ok(match);
    assert.equal(match.eventId, "event");
  }
});

test("one stored candidate set keeps postponed identities, ledger mappings and legacy ESPN links consistent", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const game = {
    id: "1022600001",
    start: "2026-06-01T18:00:00Z",
    state: "pre",
    away: { team: "A" },
    home: { team: "B" },
  };
  const postponed = { ...game, id: "1022600002" };
  await store.docs.write("seasons/2025", { year: 2025, games: [postponed] });
  await store.docs.write("seasons/2026", { year: 2026, games: [game] });
  const records = readIdentityGames([{ events: [createEspnEvent("event", 2)] }], findIdentityTeam);
  await store.identities.saveVendorGames(records.records, 0, store.docs);
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), null);
  assert.equal(await store.docs.read("espnMatches/" + game.id), null);
  assert.equal((await store.identities.readStatus()).unmatched, 1);
  await store.docs.write("seasons/2025", {
    year: 2025,
    games: [{ ...postponed, start: "2026-06-05T18:00:00Z" }],
  });
  await store.identities.saveVendorGames(records.records, 0, store.docs);
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), game.id);
  assert.equal((await store.docs.read("espnMatches/" + game.id)).eventId, "event");
  assert.equal((await store.identities.readStatus()).unmatched, 0);
});

test("bounded recovery passes advance past persistent failures instead of starving later sources", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key.startsWith("identity:entity:")) throw new Error("identity unavailable");
          return inner.get(key);
        },
      }),
    );
  for (let number = 1; number <= 25; number += 1) {
    const id = String(number).padStart(2, "0");
    await store.createJobStorage("details").put(`detail-answer:/player?id=${id}&season=2026`, {
      at: 1,
      body: { id, season: 2026, firstName: "Alex", lastName: "Jones" },
    });
  }
  for (
    let iteration = 0;
    iteration < 60 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).errors, 25);
  ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        put: async (key, value) => {
          if (key.startsWith("identity:entity:wnba:player:") && Number(key.split(":").at(-1)) <= 20)
            throw new Error("still unavailable");
          return inner.put(key, value);
        },
      }),
    );
  for (
    let iteration = 0;
    iteration < 60 && !(await store.identities.lookup.read("player", "wnba", "25"));
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal(await store.identities.lookup.read("player", "wnba", "25"), "25");
  assert.equal(await store.identities.lookup.read("player", "wnba", "01"), null);
  assert.equal((await store.identities.readStatus()).errors, 20);
});

test("a superseded in-flight backfill cannot overwrite a newer checkpoint", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("games/1022600001", { id: "1022600001", season: 2026, state: "final", period: 4 });
  const store = new WnbaStore(ctx, {});
  let release;
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const read = store.docs.read;
  store.docs.read = async (key) => {
    began();
    await delayed;
    return read(key);
  };
  let active = true;
  const pending = store.identities.backfill(store.docs, () => active);
  await started;
  active = false;
  const checkpoint = {
    complete: false,
    phase: "facts",
    cursor: "new-generation",
    checkedDocuments: 10,
  };
  stored.set("identity:backfill", checkpoint);
  release();
  await pending;
  assert.deepEqual(stored.get("identity:backfill"), checkpoint);
});

test("recovered backfill repeats dependent facts and audits before declaring coverage verified", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set("games/7", { id: "7", state: "final", innings: [] });
  stored.set("schedules-2026/2026-06", {
    year: 2026,
    games: [createGame("7", { state: "final" })],
  });
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key.startsWith("identity:entity:")) throw new Error("identity unavailable");
          return inner.get(key);
        },
      }),
    );
  const store = new MlbStore(ctx, {});
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  ctx.storage.transaction = transaction;
  await store.identities.backfill(store.docs);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal(stored.get("games/7").season, 2026);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("mapping coverage counts one broken vendor relation without scanning all entities per key", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new MlbStore(ctx, {});
  await store.identities.lookup.save([createNative("game", "7", { season: 2026 })]);
  const key = "identity:vendor:league:mlb:game:7";
  await ctx.storage.put(key, { ...(await ctx.storage.get(key)), internalId: "missing" });
  const list = ctx.storage.list;
  let fullEntityLists = 0;
  ctx.storage.list = async (options) => {
    if (options.prefix.startsWith("identity:entity:")) fullEntityLists += 1;
    return list(options);
  };
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).checks.competingMappings, 1);
  assert.equal(fullEntityLists, 0);
});

test("WNBA legacy series facts use the page-safe series contract during storage expansion", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  await store.docs.write("schedules/2026", {
    year: 2026,
    games: [{ id: "1042600201", state: "pre", start: "2026-10-01T18:00:00Z", series: "2-0" }],
  });
  assert.equal((await store.docs.read("schedules/2026")).games[0].round, 2);
});

test("actual feed-cache updates refresh their own rejection signal without reconciling before sports writes", async () => {
  const { ctx } = createDurableObjectContext();
  let feedStorage;
  const Store = createSeasonStore({
    identity: wnbaIdentityPolicy,
    createLoadSnapshot: (storage) => {
      feedStorage = storage;
      return async () => ({ season: 2026 });
    },
    loadCurrentSnapshot: async () => ({ season: 2026 }),
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60000,
    listNotifications: () => [],
  });
  const store = new Store(ctx, {});
  store.createLoadSnapshot(async () => Response.error());
  await feedStorage.put("networks:202606", { data: { events: [createEspnEvent("")] } });
  assert.equal((await store.identities.readStatus()).errors, 1);
  await feedStorage.put("networks:202606", { data: { events: [createEspnEvent("event")] } });
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal(await store.identities.lookup.read("game", "espn", "event"), null);
  await feedStorage.put("networks:202606", { data: { events: [createEspnEvent("")] } });
  await feedStorage.delete("networks:202606");
  assert.equal((await store.identities.readStatus()).errors, 0);
});

test("live-only vendor failures await a fresh observation instead of restarting or being cleared by backfill", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  await store.docs.write("seasons/2026", {
    year: 2026,
    games: [
      {
        id: "1022600001",
        start: "2026-06-01T18:00:00Z",
        state: "pre",
        away: { team: "A" },
        home: { team: "B" },
      },
    ],
  });
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  const read = store.identities.lookup.read;
  store.identities.lookup.read = async () => {
    throw new Error("transient vendor lookup failure");
  };
  await store.identities.saveVendorGames([createGame("event")]);
  assert.equal((await store.identities.readStatus()).errors, 1);
  const progress = structuredClone(stored.get("identity:backfill"));
  await store.identities.backfill(store.docs);
  assert.deepEqual(stored.get("identity:backfill"), progress);
  assert.equal((await store.identities.readStatus()).errors, 1);
  store.identities.lookup.read = read;
  await store.identities.saveVendorGames([createGame("event")]);
  assert.equal((await store.identities.readStatus()).errors, 0);
});

test("a new game without season facts cannot inherit an older completed coverage result", async () => {
  const { ctx } = createDurableObjectContext();
  const store = new MlbStore(ctx, {});
  for (
    let iteration = 0;
    iteration < 20 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  const box = { id: "7", state: "final", innings: [] };
  await store.docs.write("games/7", box);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  assert.equal((await store.identities.readStatus()).errors, 0);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.ok((await store.identities.readStatus()).checks.missingFacts > 0);
  await store.docs.write("schedules-2026/2026-06", {
    year: 2026,
    games: [createGame("7", { state: "final" })],
  });
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.docs.read("games/7")).season, 2026);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("completed backfill clears orphaned physical-source failures without restarting coverage", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const progress = {
    version: IDENTITY_AUDIT_VERSION,
    factsRevision: null,
    complete: true,
    checkedDocuments: 77,
    phase: "vendors",
    cursor: "z",
  };
  stored.set("identity:backfill", structuredClone(progress));
  const source = "job:details:detail-answer:/player?id=44&season=2026";
  stored.set("identity:error:failed:" + encodeURIComponent(source), 1);
  stored.set("identity:error:rejected:" + encodeURIComponent(source), 2);
  assert.equal((await store.identities.readStatus()).errors, 3);
  await store.identities.backfill(store.docs);
  assert.deepEqual(stored.get("identity:backfill"), progress);
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("persistent physical-source failures back off full recovery scans up to one hour", async () => {
  const { ctx, stored } = createDurableObjectContext();
  let now = 0;
  const store = new WnbaStore(ctx, {}, { now: () => now });
  await store.docs.write("players/2026-44", { id: "44", season: 2026, firstName: "Alex" });
  stored.set("identity:error:failed:" + encodeURIComponent("players/2026-44"), 1);
  stored.set("identity:backfill", { version: IDENTITY_AUDIT_VERSION, complete: true });
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key.startsWith("identity:entity:")) throw new Error("persistent failure");
          return inner.get(key);
        },
      }),
    );
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await store.identities.backfill(store.docs);
    for (
      let iteration = 0;
      iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
      iteration += 1
    )
      await store.identities.backfill(store.docs);
    const progress = structuredClone(stored.get("identity:backfill"));
    const delay = Math.min(3_600_000, 60_000 * 2 ** (attempt - 1));
    assert.equal(progress.retryAfter, now + delay);
    let reads = 0;
    const read = store.docs.read;
    store.docs.read = async (...args) => {
      reads += 1;
      return read(...args);
    };
    await store.identities.backfill(store.docs);
    assert.equal(reads, 0);
    assert.deepEqual(stored.get("identity:backfill"), progress);
    store.docs.read = read;
    now += delay;
  }
  ctx.storage.transaction = transaction;
  await store.identities.backfill(store.docs);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("policy-defined saved game facts survive writes during ledger outages", async () => {
  const { ctx } = createDurableObjectContext();
  const Store = createSeasonStore({
    identity: { ...identityPolicy, gameFactFields: [...identityPolicy.gameFactFields, "format"] },
    createLoadSnapshot: () => async () => ({ season: 2026 }),
    loadCurrentSnapshot: async () => ({ season: 2026 }),
    readUpdates: async () => null,
    saveSnapshot: async () => {},
    describeSnapshotStatus: () => ({}),
    choosePollDelay: () => 60000,
    listNotifications: () => [],
  });
  const store = new Store(ctx, {});
  await store.docs.write("games/7", { id: "7", season: 2026, format: "extra", state: "final" });
  ctx.storage.transaction = async () => {
    throw new Error("identity unavailable");
  };
  await store.docs.write("games/7", { id: "7", season: 2026, state: "final" });
  assert.equal((await store.docs.read("games/7")).format, "extra");
});

test("mapping audit counts forward and reverse breaks once without a growing checkpoint list", async () => {
  for (const breakage of ["missing-owner", "wrong-owner", "missing-vendor", "stale-reverse"]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = new MlbStore(ctx, {});
    const lookup = store.identities.lookup;
    await lookup.save([
      createNative("game", "7", { season: 2026 }),
      createNative("game", "8", { season: 2026 }),
    ]);
    const key = "identity:vendor:league:mlb:game:7";
    const mapping = stored.get(key);
    if (breakage === "missing-owner") stored.set(key, { ...mapping, internalId: "missing" });
    if (breakage === "wrong-owner") stored.set(key, { ...mapping, internalId: "8" });
    if (breakage === "missing-vendor") stored.delete(key);
    if (breakage === "stale-reverse") {
      const entryKey = "identity:entity:mlb:game:8";
      stored.delete("identity:vendor:league:mlb:game:8");
      stored.set(entryKey, { ...stored.get(entryKey), vendors: { league: "7" } });
    }
    for (
      let iteration = 0;
      iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
      iteration += 1
    )
      await store.identities.backfill(store.docs);
    assert.equal((await store.identities.readStatus()).checks.competingMappings, 1, breakage);
    assert.equal(Object.hasOwn(stored.get("identity:backfill"), "conflictKeys"), false);
  }
});

test("WNBA new ESPN links wait for ledger recovery while established match documents survive", async () => {
  const fixture = readIdentityFixture("wnba", "2026-09-30-afternoon");
  const snapshot = buildWnba(fixture.responses, {
    season: fixture.season,
    now: Date.parse(fixture.now),
  });
  const game = snapshot.games[0];
  const { ctx } = createDurableObjectContext();
  const store = new WnbaStore(ctx, {});
  const previous = {
    id: "old",
    eventId: "old-event",
    season: 2025,
    away: "A",
    home: "B",
    start: "2025-06-01T18:00:00Z",
  };
  await store.docs.write("espnMatches/old", previous);
  const kept = await store.docs.read("espnMatches/old");
  const update = {
    ...snapshot,
    identityRecords: {
      records: [{ id: "new-event", away: game.away.team, home: game.home.team, start: game.start }],
      rejected: 0,
    },
  };
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = async () => {
    throw new Error("identity unavailable");
  };
  assert.ok((await store.saveSeason(update)).snapshot);
  assert.equal(await store.docs.read("espnMatches/" + game.id), null);
  assert.deepEqual(await store.docs.read("espnMatches/old"), kept);
  assert.ok(await store.docs.read("seasons/2026"));
  ctx.storage.transaction = transaction;
  assert.ok((await store.saveSeason(update)).snapshot);
  const recoveredMatch = await store.docs.read("espnMatches/" + game.id);
  assert.ok(recoveredMatch);
  assert.equal(recoveredMatch.eventId, "new-event");
  assert.deepEqual(await store.docs.read("espnMatches/old"), kept);
});

test("a seasonless game arriving during an active audit invalidates its generation through completion", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new MlbStore(ctx, {});
  stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    factsRevision: null,
    complete: false,
    phase: "vendors",
    cursor: "",
    checkedDocuments: 1,
    conflicts: 0,
    missingEntries: 0,
    missingFacts: 0,
  });
  await store.docs.write("games/7", { id: "7", state: "final", innings: [] });
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  const status = await store.identities.readStatus();
  assert.equal(status.checks.verified, false);
  assert.ok(status.checks.missingFacts > 0);
  assert.equal(status.errors, 0);
  await store.docs.write("schedules-2026/2026-06", {
    year: 2026,
    games: [createGame("7", { state: "final" })],
  });
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  await store.identities.backfill(store.docs);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.equal((await store.docs.read("games/7")).season, 2026);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("unchanged game observations do not restart a completed audit with a permanent fact gap", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new MlbStore(ctx, {});
  const box = { id: "7", state: "final", innings: [] };
  await store.docs.write("games/7", box);
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  const progress = structuredClone(stored.get("identity:backfill"));
  assert.ok(progress.missingFacts > 0);
  const revision = stored.get("identity:coverage-revision");
  await store.docs.write("games/7", box);
  await store.docs.write("schedules-2026/2026-06", {
    year: 2026,
    games: [createGame("8", { state: "final" })],
  });
  assert.equal(stored.get("identity:coverage-revision"), revision);
  await store.identities.backfill(store.docs);
  assert.deepEqual(stored.get("identity:backfill"), progress);
});

test("a superseded coverage revision cannot verify when its in-flight pass finishes", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = new MlbStore(ctx, {});
  stored.set("identity:backfill", {
    version: IDENTITY_AUDIT_VERSION,
    factsRevision: null,
    complete: false,
    phase: "vendors",
    cursor: "z",
    conflicts: 0,
    checkedDocuments: 1,
  });
  const list = ctx.storage.list;
  let begin;
  let release;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  ctx.storage.list = async (options) => {
    const result = await list(options);
    if (options.prefix === "" && options.startAfter === "z") {
      begin();
      await delayed;
    }
    return result;
  };
  const pending = store.identities.backfill(store.docs);
  await started;
  await store.docs.write("games/7", { id: "7", state: "final", innings: [] });
  release();
  await pending;
  assert.equal(stored.get("identity:backfill").complete, true);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  assert.equal((await store.identities.readStatus()).backfill.complete, false);
  ctx.storage.list = list;
  for (
    let iteration = 0;
    iteration < 40 && !(await store.identities.readStatus()).backfill.complete;
    iteration += 1
  )
    await store.identities.backfill(store.docs);
  assert.ok((await store.identities.readStatus()).checks.missingFacts > 0);
});
