import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      assert.equal(saved.gameNumber, 2);
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
  assert.ok(games.every((game) => game.season === 2026 && Number.isInteger(game.gameNumber)));
  assert.equal(games.find((game) => game.series === "AL_DS1").round, "DS");
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
    assert.equal(stored.get(`schedules-${year}/${year}-10`).games[0].gameNumber, 2);
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
  const backfill = store.identities.backfill;
  store.identities.backfill = async (...args) => {
    order.push("backfill");
    await backfill(...args);
  };
  await store.alarm();
  await store.historyRun;
  assert.deepEqual(order, ["live", "reminders", "job", "backfill"]);
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
