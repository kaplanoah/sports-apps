import test from "node:test";
import assert from "node:assert/strict";
import { SeasonStore as MlbStore } from "../apps/mlb/worker/src/store.js";
import { SeasonStore as WnbaStore } from "../apps/wnba/worker/src/store.js";
import { identityPolicy } from "../apps/wnba/worker/src/identity-policy.js";
import { createSeasonStore } from "../shared/worker/season-store.js";
import {
  IDENTITY_AUDIT_VERSION,
  IDENTITY_WORK_PER_RUN,
  IDENTITY_WORK_PER_DAY,
  IDENTITY_WORK_INTERVAL_MS,
} from "../shared/worker/identity-backfill.js";
import { reconcileIdentities } from "../shared/worker/identity-matching.js";
import { createIdentityLookup } from "../shared/worker/identity.js";
import { createDurableObjectContext } from "./durable-object-context.js";

function createMeasuredContext() {
  const context = createDurableObjectContext();
  const calls = { get: 0, put: 0, rows: 0, vendor: 0 };
  for (const method of ["get", "put"]) {
    const original = context.ctx.storage[method];
    context.ctx.storage[method] = async (...args) => {
      calls[method] += 1;
      return original(...args);
    };
  }
  const list = context.ctx.storage.list;
  context.ctx.storage.list = async (options) => {
    const entries = await list(options);
    calls.rows += entries.size;
    return entries;
  };
  const transaction = context.ctx.storage.transaction;
  context.ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          calls.get += 1;
          return inner.get(key);
        },
        put: async (key, value) => {
          calls.put += 1;
          return inner.put(key, value);
        },
      }),
    );
  return {
    ...context,
    calls,
    options: {
      fetchImpl: async () => {
        calls.vendor += 1;
        throw new Error("Unexpected vendor request");
      },
    },
    resetCalls: () => {
      calls.get = 0;
      calls.put = 0;
      calls.rows = 0;
    },
  };
}

const createGame = (id) => ({
  id: String(id),
  state: "final",
  season: 2026,
  away: { team: "NYL" },
  home: { team: "LVA" },
  start: "2026-06-01T18:00:00Z",
});

function createSavedNetworkMonth() {
  return {
    edition: 1,
    data: {
      events: [
        {
          id: "espn-event",
          date: "2026-06-01T18:00:00Z",
          competitions: [
            {
              competitors: [
                { id: "9", homeAway: "away" },
                { id: "17", homeAway: "home" },
              ],
            },
          ],
        },
      ],
    },
  };
}

async function finishBackfill(store, limit = 1000) {
  for (let step = 0; step < limit; step += 1) {
    if ((await store.identities.readStatus()).backfill.complete) return;
    await store.identities.backfill(store.docs);
  }
  assert.fail("Backfill did not finish within its bounded steps");
}

for (const [app, Store] of /** @type {const} */ ([
  ["mlb", MlbStore],
  ["wnba", WnbaStore],
])) {
  test(`${app}: a thousand nested identities stay within each storage-work slice and resume across evictions`, async () => {
    const harness = createMeasuredContext();
    const ids = Array.from({ length: 1000 }, (_, index) =>
      app === "wnba" ? `10226${String(index + 1).padStart(5, "0")}` : String(index + 1),
    );
    harness.stored.set("seasons/2026", { year: 2026, games: ids.map(createGame) });
    let store = new Store(harness.ctx, {}, harness.options);
    await store.identities.backfill(store.docs);
    assert.ok(harness.calls.get < IDENTITY_WORK_PER_RUN * 12 + 30);
    assert.ok((await store.identities.readStatus()).players === 0);
    assert.ok((await store.identities.readStatus()).games <= IDENTITY_WORK_PER_RUN);
    assert.equal((await store.identities.readStatus()).checks.verified, false);
    let completed = false;
    for (let step = 0; step < 1000; step += 1) {
      if (step % 3 === 0) store = new Store(harness.ctx, {}, harness.options);
      harness.resetCalls();
      await store.identities.backfill(store.docs);
      assert.ok(
        harness.calls.get < IDENTITY_WORK_PER_RUN * 12 + 30,
        `step ${step}: ${harness.calls.get} reads`,
      );
      assert.ok(harness.calls.rows <= IDENTITY_WORK_PER_RUN + 20);
      if ((await store.identities.readStatus()).backfill.complete) {
        completed = true;
        break;
      }
    }
    assert.equal(completed, true);
    const status = await store.identities.readStatus();
    assert.equal(status.games, ids.length);
    assert.equal(status.checks.verified, true);
    assert.deepEqual(
      harness.stored.get("seasons/2026").games.map((game) => game.id),
      ids,
    );
    assert.equal(harness.calls.vendor, 0);
  });
}

test("an interrupted source restarts its own identities when the saved document changes", async () => {
  const harness = createMeasuredContext();
  const key = "seasons/2026";
  harness.stored.set(key, {
    year: 2026,
    games: Array.from({ length: 60 }, (_, index) => createGame(index + 1)),
  });
  let store = new MlbStore(harness.ctx, {}, harness.options);
  await store.identities.backfill(store.docs);
  assert.ok(harness.stored.get("identity:backfill").pending.offset > 0);
  const changed = structuredClone(harness.stored.get(key));
  changed.games[0] = createGame("changed");
  changed.kept = "a concurrent writer's value";
  harness.stored.set(key, changed);
  store = new MlbStore(harness.ctx, {}, harness.options);
  await finishBackfill(store);
  assert.equal(await store.identities.lookup.read("game", "mlb", "changed"), "changed");
  assert.equal(harness.stored.get(key).kept, changed.kept);
  assert.equal(harness.stored.get(key).games[0].id, "changed");
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal(harness.calls.vendor, 0);
});

test("candidate pages must be complete and record slices retain every competing vendor record", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  const observations = Array.from({ length: 60 }, (_, index) => ({
    type: "game",
    vendor: "wnba",
    vendorId: String(index),
    internalId: String(index),
    evidence: { method: "existing-id" },
    facts: {
      season: 2026,
      away: index === 0 || index === 59 ? "NYL" : "SEA",
      home: "LVA",
      start: "2026-06-01T18:00:00Z",
    },
  }));
  await store.identities.lookup.save(observations);
  harness.stored.set("feed:networks:202606", createSavedNetworkMonth());
  const list = harness.ctx.storage.list;
  const examined = new Set();
  harness.ctx.storage.list = async (options) => {
    const entries = await list(options);
    if (options.prefix === "identity:entity:wnba:game:")
      for (const key of entries.keys()) examined.add(key);
    return entries;
  };
  await finishBackfill(store);
  assert.equal(examined.size, observations.length);
  assert.equal(await store.identities.lookup.read("game", "espn", "espn-event"), null);
  assert.equal((await store.identities.readStatus()).unmatched, 1);

  const lookup = createIdentityLookup(createDurableObjectContext().ctx.storage, "wnba");
  const records = ["first", "second"].map((id) => ({
    id,
    away: "NYL",
    home: "LVA",
    start: "2026-06-01T18:00:00Z",
  }));
  for (let offset = 0; offset < records.length; offset += 1) {
    await reconcileIdentities(lookup, {
      type: "game",
      vendor: "espn",
      natives: [{ ...records[0], id: "native" }],
      records,
      offset,
      limit: 1,
    });
  }
  assert.equal(await lookup.read("game", "espn", "first"), null);
  assert.equal(await lookup.read("game", "espn", "second"), null);
  assert.equal((await lookup.readStatus()).unmatched, 2);
});

test("a candidate scan restarts on changed native evidence before any vendor association is saved", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  await store.identities.lookup.save(
    Array.from({ length: 50 }, (_, index) => ({
      type: "game",
      vendor: "wnba",
      vendorId: String(index),
      internalId: String(index),
      evidence: { method: "existing-id" },
      facts: {
        season: 2026,
        away: index === 0 ? "NYL" : "SEA",
        home: "LVA",
        start: "2026-06-01T18:00:00Z",
      },
    })),
  );
  harness.stored.set("feed:networks:202606", createSavedNetworkMonth());
  for (let step = 0; step < 20; step += 1) {
    await store.identities.backfill(store.docs);
    if (harness.stored.get("identity:backfill").pending?.candidateCursor) break;
  }
  assert.ok(harness.stored.get("identity:backfill").pending.candidateCursor);
  await store.identities.lookup.save([
    {
      type: "game",
      vendor: "wnba",
      vendorId: "late",
      internalId: "late",
      evidence: { method: "existing-id" },
      facts: { season: 2026, away: "NYL", home: "LVA", start: "2026-06-01T18:00:00Z" },
    },
  ]);
  await finishBackfill(store);
  assert.equal(await store.identities.lookup.read("game", "espn", "espn-event"), null);
  assert.equal((await store.identities.readStatus()).unmatched, 1);
});

test("the durable optional-work allowance survives eviction, simultaneous calls and the next day", async () => {
  const harness = createMeasuredContext();
  let now = 0;
  const options = { ...harness.options, now: () => now };
  const first = new MlbStore(harness.ctx, {}, options);
  const second = new MlbStore(harness.ctx, {}, options);
  await Promise.all([first, second].map((store) => store.identities.backfillWhenDue(store.docs)));
  assert.equal(harness.stored.get("identity:work").used, IDENTITY_WORK_PER_RUN);
  now = -24 * 60 * 60 * 1000;
  await second.identities.backfillWhenDue(second.docs);
  assert.equal(harness.stored.get("identity:work").day, 0);
  assert.equal(harness.stored.get("identity:work").used, IDENTITY_WORK_PER_RUN);
  now = 0;
  const progress = structuredClone(harness.stored.get("identity:backfill"));
  await new MlbStore(harness.ctx, {}, options).identities.backfillWhenDue(first.docs);
  assert.deepEqual(harness.stored.get("identity:backfill"), progress);
  now = IDENTITY_WORK_INTERVAL_MS;
  harness.stored.set("identity:work", {
    day: 0,
    nextAt: now,
    used: IDENTITY_WORK_PER_DAY - IDENTITY_WORK_PER_RUN,
  });
  await first.identities.backfillWhenDue(first.docs);
  assert.equal(harness.stored.get("identity:work").used, IDENTITY_WORK_PER_DAY);
  const limited = structuredClone(harness.stored.get("identity:backfill"));
  now += IDENTITY_WORK_INTERVAL_MS;
  await second.identities.backfillWhenDue(second.docs);
  assert.deepEqual(harness.stored.get("identity:backfill"), limited);
  now = 24 * 60 * 60 * 1000;
  await second.identities.backfillWhenDue(second.docs);
  assert.equal(harness.stored.get("identity:work").day, 1);
  assert.equal(harness.stored.get("identity:work").used, IDENTITY_WORK_PER_RUN);
  assert.equal(harness.calls.vendor, 0);
});

test("unrelated releases preserve current coverage while an older identity writer version cannot verify", async () => {
  const harness = createMeasuredContext();
  const createStore = (release) => {
    const Store = createSeasonStore({
      identity: identityPolicy,
      release,
      createLoadSnapshot: () => async () => ({ season: 2026 }),
      loadCurrentSnapshot: async () => ({ season: 2026 }),
      readUpdates: async () => null,
      saveSnapshot: async () => {},
      describeSnapshotStatus: () => ({}),
      choosePollDelay: () => 60_000,
      listNotifications: () => [],
    });
    return new Store(harness.ctx, {}, { ...harness.options, now: () => 0 });
  };
  const first = createStore("first");
  await finishBackfill(first);
  const progress = structuredClone(harness.stored.get("identity:backfill"));
  harness.stored.set("poll:schedule", { release: "first", dueAt: 10000 });
  const second = createStore("unrelated-release");
  await second.startUpdating();
  assert.deepEqual(harness.stored.get("identity:backfill"), progress);
  assert.equal((await second.identities.readStatus()).checks.verified, true);
  harness.stored.set("identity:backfill", { ...progress, version: IDENTITY_AUDIT_VERSION - 1 });
  assert.equal((await second.identities.readStatus()).checks.verified, false);
  await finishBackfill(second);
  assert.equal(harness.stored.get("identity:backfill").version, IDENTITY_AUDIT_VERSION);
  assert.equal((await second.identities.readStatus()).checks.verified, true);
});

test("a source with hundreds of vendor references is checked in bounded slices", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  await store.docs.write("games/1022600001", createGame("1022600001"));
  const key = "identity:entity:wnba:game:1022600001";
  const entry = harness.stored.get(key);
  for (let index = 0; index < 200; index += 1)
    entry.vendors[`example-${index}`] = `missing-${index}`;
  harness.stored.set(key, entry);
  for (let step = 0; step < 100; step += 1) {
    harness.resetCalls();
    await store.identities.backfill(store.docs);
    assert.ok(harness.calls.get < IDENTITY_WORK_PER_RUN * 12 + 30);
    if ((await store.identities.readStatus()).backfill.complete) break;
  }
  assert.equal((await store.identities.readStatus()).checks.competingMappings, 200);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("a late failing identity transaction still spends its reserved work before the next source", async () => {
  const harness = createMeasuredContext();
  const transaction = harness.ctx.storage.transaction;
  harness.ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key.startsWith("identity:entity:") && key.endsWith("-fail"))
            throw new Error("Ledger unavailable");
          return inner.get(key);
        },
      }),
    );
  for (let season = 2020; season < 2026; season += 1) {
    harness.stored.set(`seasons/${season}`, {
      year: season,
      games: Array.from({ length: 19 }, (_, index) =>
        createGame(`${season}-${index === 18 ? "fail" : index}`),
      ),
    });
  }
  const store = new MlbStore(harness.ctx, {}, harness.options);
  await store.identities.backfill(store.docs);
  assert.ok(harness.calls.get < IDENTITY_WORK_PER_RUN * 12 + 30);
  assert.equal((await store.identities.readStatus()).errors, 1);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("an obsolete continuation cannot overwrite a checkpoint committed by another store instance", async () => {
  const harness = createMeasuredContext();
  harness.stored.set("seasons/2026", { year: 2026, games: [createGame("7")] });
  const store = new MlbStore(harness.ctx, {}, harness.options);
  const transaction = harness.ctx.storage.transaction;
  let begin;
  let release;
  const began = new Promise((resolve) => {
    begin = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  harness.ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key === "identity:backfill") {
            begin();
            await gate;
          }
          return inner.get(key);
        },
      }),
    );
  const pending = store.identities.backfill(store.docs);
  await began;
  const newer = {
    version: IDENTITY_AUDIT_VERSION,
    complete: false,
    checkedDocuments: 999,
    cursor: "newer",
  };
  harness.stored.set("identity:backfill", newer);
  release();
  await pending;
  assert.deepEqual(harness.stored.get("identity:backfill"), newer);
});

test("a facts publication racing a live writer cannot replace that writer's newer document", async () => {
  const harness = createMeasuredContext();
  const key = "games/1022600001";
  harness.stored.set(key, { boxScore: { id: "1022600001", state: "final", period: 4 } });
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  let begin;
  let release;
  const began = new Promise((resolve) => {
    begin = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const replace = store.docs.replaceIfUnchanged;
  store.docs.replaceIfUnchanged = async (...args) => {
    begin();
    await gate;
    return replace(...args);
  };
  const pending = store.identities.backfill(store.docs);
  await began;
  const newer = { boxScore: { id: "1022600001", state: "final", period: 5 }, kept: "live writer" };
  harness.stored.set(key, newer);
  release();
  await pending;
  assert.equal(harness.stored.get(key).boxScore.period, 5);
  assert.equal(harness.stored.get(key).kept, "live writer");
  store.docs.replaceIfUnchanged = replace;
  await finishBackfill(store);
  assert.equal(harness.stored.get(key).boxScore.period, 5);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("a cancelled generation cannot publish after waiting for its checkpoint transaction", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  const transaction = harness.ctx.storage.transaction;
  let begin;
  let release;
  let active = true;
  const began = new Promise((resolve) => {
    begin = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  harness.ctx.storage.transaction = (callback) =>
    transaction((inner) =>
      callback({
        ...inner,
        get: async (key) => {
          if (key === "identity:backfill") {
            begin();
            await gate;
          }
          return inner.get(key);
        },
      }),
    );
  const pending = store.identities.backfill(store.docs, () => active);
  await began;
  active = false;
  release();
  await pending;
  assert.equal(harness.stored.has("identity:backfill"), false);
});

test("oversized candidate checkpoints remain errors instead of matching a truncated evidence set", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  await store.identities.lookup.save(
    Array.from({ length: 100 }, (_, index) => ({
      type: "game",
      vendor: "wnba",
      vendorId: String(index),
      internalId: String(index),
      evidence: { method: "existing-id" },
      facts: {
        season: 2026,
        away: "NYL",
        home: "LVA",
        start: "2026-06-01T18:00:00Z",
        extra: "x".repeat(6000),
      },
    })),
  );
  harness.stored.set("feed:networks:202606", createSavedNetworkMonth());
  await finishBackfill(store);
  const status = await store.identities.readStatus();
  assert.equal(status.errors, 1);
  assert.equal(status.checks.verified, false);
  assert.equal(await store.identities.lookup.read("game", "espn", "espn-event"), null);
  assert.ok(!JSON.stringify(status).includes("x".repeat(100)));
  assert.equal(harness.calls.vendor, 0);
});

test("legacy saved ESPN game links populate both sides of the ledger before coverage verifies", async () => {
  const harness = createMeasuredContext();
  const id = "1022600001";
  harness.stored.set(`espnMatches/${id}`, {
    id,
    eventId: "saved-event",
    away: "NYL",
    home: "LVA",
    start: "2026-06-01T18:00:00Z",
  });
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  await finishBackfill(store);
  assert.equal(await store.identities.lookup.read("game", "espn", "saved-event"), id);
  assert.equal((await store.identities.lookup.readEntry("game", id)).vendors.espn, "saved-event");
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal(harness.stored.get(`espnMatches/${id}`).eventId, "saved-event");
});

for (const cached of [false, true]) {
  test(`${cached ? "cached" : "canonical"} player evidence survives a failed documents pass until facts-pass reconciliation succeeds`, async () => {
    const harness = createMeasuredContext();
    const store = new WnbaStore(harness.ctx, {}, harness.options);
    await store.docs.write("rosters/2026-NYL", {
      season: 2026,
      team: "NYL",
      players: [{ id: "44", firstName: "Alex", lastName: "Jones", number: "7" }],
    });
    const box = {
      id: "1022600001",
      state: "final",
      period: 4,
      away: {
        team: "NYL",
        players: [
          {
            id: null,
            firstName: "Alex",
            lastName: "Jones",
            espnIdentity: {
              id: "espn-player",
              facts: { firstName: "Alex", lastName: "Jones", number: "7" },
            },
          },
        ],
      },
    };
    const key = cached
      ? "job:details:detail-answer:/box-score?id=1022600001&season=2026"
      : "games/1022600001";
    harness.stored.set(key, cached ? { at: 1, body: box } : { boxScore: box });
    const readEvidence = () =>
      (cached ? harness.stored.get(key).body : harness.stored.get(key).boxScore).away.players[0]
        .espnIdentity;
    const transaction = harness.ctx.storage.transaction;
    harness.ctx.storage.transaction = (callback) =>
      transaction((inner) =>
        callback({
          ...inner,
          get: async (path) => {
            if (path === "identity:entity:wnba:game:1022600001")
              throw new Error("Temporary game identity failure");
            return inner.get(path);
          },
        }),
      );
    for (let step = 0; step < 100; step += 1) {
      await store.identities.backfill(store.docs);
      if (harness.stored.get("identity:backfill").phase === "facts") break;
    }
    assert.ok(readEvidence());
    assert.equal(await store.identities.lookup.read("player", "espn", "espn-player"), null);
    harness.ctx.storage.transaction = transaction;
    for (let step = 0; step < 100 && readEvidence(); step += 1)
      await store.identities.backfill(store.docs);
    assert.equal(readEvidence(), undefined);
    assert.equal(await store.identities.lookup.read("player", "espn", "espn-player"), "44");
    await finishBackfill(store);
    await store.identities.backfill(store.docs);
    await finishBackfill(store);
    assert.equal((await store.identities.readStatus()).checks.verified, true);
    assert.equal(harness.calls.vendor, 0);
  });
}

test("native evidence changing after lookup begins cannot commit a stale confident association", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  await store.identities.lookup.save([
    {
      type: "game",
      vendor: "wnba",
      vendorId: "native",
      internalId: "native",
      evidence: { method: "existing-id" },
      facts: { season: 2026, away: "NYL", home: "LVA", start: "2026-06-01T18:00:00Z" },
    },
  ]);
  harness.stored.set("feed:networks:202606", createSavedNetworkMonth());
  const read = store.identities.lookup.read;
  let begin;
  let release;
  let held = false;
  const began = new Promise((resolve) => {
    begin = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.identities.lookup.read = async (...args) => {
    if (args[1] === "espn" && !held) {
      held = true;
      begin();
      await gate;
    }
    return read(...args);
  };
  const pending = finishBackfill(store);
  await began;
  await store.identities.lookup.save([
    {
      type: "game",
      vendor: "wnba",
      vendorId: "competing",
      internalId: "competing",
      evidence: { method: "existing-id" },
      facts: { season: 2026, away: "NYL", home: "LVA", start: "2026-06-01T18:00:00Z" },
    },
  ]);
  release();
  await pending;
  assert.equal(await store.identities.lookup.read("game", "espn", "espn-event"), null);
  assert.equal((await store.identities.readStatus()).unmatched, 1);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("empty and rejected retained months never scan the native game ledger", async () => {
  for (const data of [null, { events: [] }, { events: [null] }]) {
    const harness = createMeasuredContext();
    const store = new WnbaStore(harness.ctx, {}, harness.options);
    harness.stored.set("feed:networks:202606", { edition: 1, data });
    const list = harness.ctx.storage.list;
    let scans = 0;
    harness.ctx.storage.list = async (options) => {
      if (options.prefix === "identity:entity:wnba:game:") scans += 1;
      return list(options);
    };
    await finishBackfill(store);
    assert.equal(scans, 0);
    assert.equal((await store.identities.readStatus()).errors, data?.events?.[0] === null ? 1 : 0);
  }
});

test("live matching refreshes cached native candidates changed by another lookup instance", async () => {
  const harness = createMeasuredContext();
  const store = new WnbaStore(harness.ctx, {}, harness.options);
  const facts = { season: 2026, away: "NYL", home: "LVA", start: "2026-06-01T18:00:00Z" };
  await store.identities.lookup.save([
    {
      type: "game",
      vendor: "wnba",
      vendorId: "native",
      internalId: "native",
      evidence: { method: "existing-id" },
      facts,
    },
  ]);
  await store.identities.saveVendorGames([{ ...facts, id: "first-vendor" }]);
  assert.equal(await store.identities.lookup.read("game", "espn", "first-vendor"), "native");
  const other = createIdentityLookup(harness.ctx.storage, "wnba");
  await other.save([
    {
      type: "game",
      vendor: "wnba",
      vendorId: "competing",
      internalId: "competing",
      evidence: { method: "existing-id" },
      facts,
    },
  ]);
  await store.identities.saveVendorGames([{ ...facts, id: "second-vendor" }]);
  assert.equal(await store.identities.lookup.read("game", "espn", "second-vendor"), null);
  assert.equal(await store.identities.lookup.read("game", "espn", "first-vendor"), "native");
  assert.equal((await store.identities.readStatus()).unmatched, 1);
  assert.equal((await store.identities.readStatus()).disputed, 0);
});
