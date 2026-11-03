import test from "node:test";
import assert from "node:assert/strict";
import { createIdentityLookup } from "../shared/worker/identity.js";
import { SeasonStore } from "../apps/mlb/worker/src/store.js";
import { identityPolicy } from "../apps/mlb/worker/src/identity-policy.js";
import { createSeasonStore } from "../shared/worker/season-store.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { createDeferred } from "./deferred.js";
import { reconcileIdentities } from "../shared/worker/identity-matching.js";
import { createBrowserKeys } from "./push-reader.js";

const ASSOCIATION = {
  type: "game",
  vendor: "espn",
  vendorId: "vendor-game",
  internalId: "internal-game",
  evidence: { method: "game-number", gameNumber: 1 },
  facts: { season: 2026, away: "LAD", home: "NYY", gameNumber: 1 },
};

async function createMappedIdentity() {
  const context = createDurableObjectContext();
  const lookup = createIdentityLookup(context.ctx.storage, "mlb");
  await lookup.save([ASSOCIATION]);
  const guard = await lookup.readEligible("game", "espn", ASSOCIATION.vendorId);
  assert.ok(guard);
  return { ...context, lookup, guard };
}

const revokeIdentity = (lookup) => lookup.save([{ ...ASSOCIATION, disputed: true }]);
const restoreIdentity = (lookup) => lookup.save([{ ...ASSOCIATION, decisive: true }]);
const createPublishingStore = (ctx) =>
  new SeasonStore(ctx, {}, { fetchImpl: async () => assert.fail("Unexpected vendor request") });

test("ordinary agreeing, unmatched and missing observations cannot clear identity quarantine", async () => {
  const { lookup, guard } = await createMappedIdentity();
  await revokeIdentity(lookup);
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  assert.equal(await lookup.read("game", "espn", ASSOCIATION.vendorId), guard.internalId);
  await lookup.save([ASSOCIATION]);
  await lookup.save([{ ...ASSOCIATION, internalId: undefined }]);
  await lookup.save([]);
  await lookup.save([ASSOCIATION]);
  assert.equal((await lookup.readStatus()).disputed, 1);
  assert.equal((await lookup.readStatus()).unmatched, 0);
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  assert.equal(
    (await lookup.readEntry("game", guard.internalId)).vendors.espn,
    ASSOCIATION.vendorId,
  );
});

test("unnumbered games stay quarantined through agreeing reconciliation and accept an explicit decisive repair", async () => {
  const { ctx } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "wnba");
  const native = { id: "native-game", away: "NYL", home: "LVA", date: "2026-06-01" };
  const record = { ...native, id: "vendor-game" };
  const reconcile = (records) =>
    reconcileIdentities(lookup, { type: "game", vendor: "espn", natives: [native], records });
  await reconcile([record]);
  const guard = await lookup.readEligible("game", "espn", record.id);
  await reconcile([{ ...record, away: "SEA" }]);
  assert.equal((await lookup.readStatus()).disputed, 1);
  await reconcile([record]);
  assert.equal((await lookup.readStatus()).disputed, 1);
  assert.equal(await lookup.readEligible("game", "espn", record.id), null);
  await lookup.save([
    {
      type: "game",
      vendor: "espn",
      vendorId: record.id,
      internalId: native.id,
      decisive: true,
      evidence: { method: "existing-id", reconciled: true },
    },
  ]);
  assert.equal((await lookup.readStatus()).disputed, 0);
  const restored = await lookup.readEligible("game", "espn", record.id);
  assert.equal(restored.internalId, native.id);
  assert.notEqual(restored.associationToken, guard.associationToken);
  assert.equal((await lookup.readEntry("game", native.id)).evidence.espn.reconciled, true);
});

test("the season store wires identity validation into guarded reminder claims", async () => {
  const { ctx } = createDurableObjectContext();
  const clock = { now: Date.parse("2026-06-01T12:00:00Z") };
  const sent = [];
  const store = new SeasonStore(
    ctx,
    {},
    {
      now: () => clock.now,
      fetchImpl: async (_url, init) => {
        sent.push(init);
        return new Response(null, { status: 201 });
      },
    },
  );
  const keys = await createBrowserKeys();
  const response = await store.fetch(
    new Request("https://store/push/subscription", {
      method: "PUT",
      body: JSON.stringify({
        endpoint: "https://web.push.apple.com/reminder",
        keys,
        preferences: { updates: false, reminders: true, minutes: 60, timeZone: "America/New_York" },
      }),
    }),
  );
  assert.equal(response.status, 204);
  const games = [];
  for (const [index, id] of ["eligible-game", "revoked-game"].entries()) {
    await store.identities.lookup.save([{ ...ASSOCIATION, vendorId: id, internalId: id }]);
    const guard = await store.identities.lookup.readEligible("game", "espn", id);
    games.push({
      id,
      season: 2026,
      away: "LAD",
      home: "NYY",
      networks: [],
      start: clock.now + (61 + index) * 60_000,
      identityGuards: [guard],
    });
  }
  await store.reminders.saveGames(games, true);
  clock.now = games[0].start - 60 * 60_000;
  await store.reminders.checkDue();
  assert.equal(sent.length, 1);
  await store.identities.lookup.save([
    { ...ASSOCIATION, vendorId: games[1].id, internalId: games[1].id, disputed: true },
  ]);
  clock.now = games[1].start - 60 * 60_000;
  await store.reminders.saveGames(games, true);
  await store.reminders.checkDue();
  assert.equal(sent.length, 1);
  const device = [...(await store.push.listSubscriptions()).values()][0];
  assert.equal(device.reminderReceipts[games[1].id].attempts, 0);
});

test("decisive restoration changes the token across repeated revocation with the same internal ID", async () => {
  const { ctx, stored, lookup, guard } = await createMappedIdentity();
  await revokeIdentity(lookup);
  const revokedToken = stored.get("identity:vendor:espn:mlb:game:vendor-game").associationToken;
  assert.notEqual(revokedToken, guard.associationToken);
  await restoreIdentity(lookup);
  const restored = await lookup.readEligible("game", "espn", ASSOCIATION.vendorId);
  assert.equal(restored.internalId, guard.internalId);
  assert.notEqual(restored.associationToken, guard.associationToken);
  assert.notEqual(restored.associationToken, revokedToken);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [guard])), false);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [restored])), true);
  await revokeIdentity(lookup);
  await restoreIdentity(lookup);
  const repeated = await lookup.readEligible("game", "espn", ASSOCIATION.vendorId);
  assert.notEqual(repeated.associationToken, restored.associationToken);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [restored])), false);
});

test("unchanged observations and facts refreshes preserve an eligible association's token", async () => {
  const { lookup, guard } = await createMappedIdentity();
  await lookup.save([
    { ...ASSOCIATION, evidence: { method: "existing-id" }, facts: { number: "2" } },
  ]);
  assert.deepEqual(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), guard);
});

test("eligibility tokens and quarantine survive eviction of the lookup instance", async () => {
  const { ctx, lookup, guard } = await createMappedIdentity();
  const restarted = createIdentityLookup(ctx.storage, "mlb");
  assert.deepEqual(await restarted.readEligible("game", "espn", ASSOCIATION.vendorId), guard);
  await revokeIdentity(lookup);
  assert.equal(await restarted.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  await restarted.save([ASSOCIATION]);
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
});

test("legacy eligible associations are read without writes and old guards fail after restoration", async () => {
  const { ctx, stored, lookup } = await createMappedIdentity();
  const key = "identity:vendor:espn:mlb:game:vendor-game";
  const legacy = stored.get(key);
  delete legacy.associationToken;
  const before = structuredClone(stored);
  const guard = await lookup.readEligible("game", "espn", ASSOCIATION.vendorId);
  assert.ok(guard.associationToken);
  assert.deepEqual(stored, before);
  stored.set(key, Object.fromEntries(Object.entries(legacy).reverse()));
  assert.deepEqual(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), guard);
  await revokeIdentity(lookup);
  await restoreIdentity(lookup);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [guard])), false);
});

test("strict reads reject wrong namespaces, damaged reverse associations and unknown problem states", async () => {
  const { ctx, stored, lookup } = await createMappedIdentity();
  assert.equal(await lookup.readEligible("player", "espn", ASSOCIATION.vendorId), null);
  assert.equal(await lookup.readEligible("game", "mlb", ASSOCIATION.vendorId), null);
  const other = createIdentityLookup(ctx.storage, "wnba");
  assert.equal(await other.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  const entity = stored.get("identity:entity:mlb:game:internal-game");
  entity.vendors.espn = "another-vendor-game";
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  entity.vendors.espn = ASSOCIATION.vendorId;
  stored.set("identity:problem:identity:vendor:espn:mlb:game:vendor-game", "unknown");
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
  await lookup.save([ASSOCIATION]);
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
});

test("an unrelated association's dispute cannot revoke an eligible native association", async () => {
  const { lookup, guard } = await createMappedIdentity();
  await lookup.save([{ ...ASSOCIATION, vendor: "mlb", vendorId: "native-game" }]);
  const native = await lookup.readEligible("game", "mlb", "native-game");
  await revokeIdentity(lookup);
  assert.deepEqual(await lookup.readEligible("game", "mlb", "native-game"), native);
  assert.equal((await lookup.readStatus()).disputed, 1);
  assert.equal(await lookup.read("game", "espn", ASSOCIATION.vendorId), guard.internalId);
});

test("strict association guards reject mismatched stored scope, evidence and tokens", async () => {
  const { stored, lookup } = await createMappedIdentity();
  const key = "identity:vendor:espn:mlb:game:vendor-game";
  const original = structuredClone(stored.get(key));
  /** @type {[string, string | boolean][]} */
  const invalidFields = [
    ["league", "wnba"],
    ["type", "player"],
    ["vendor", "another-vendor"],
    ["vendorId", "another-game"],
    ["associationToken", ""],
    ["unexpected", true],
  ];
  for (const [field, value] of invalidFields) {
    stored.set(key, { ...original, [field]: value });
    assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null, field);
  }
  stored.set(key, original);
  const entry = stored.get("identity:entity:mlb:game:internal-game");
  entry.evidence.espn = { method: "teams-day" };
  assert.equal(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), null);
});

test("strict reads and validation make bounded point reads without scans, writes or vendor requests", async () => {
  const { ctx, stored, lookup, guard } = await createMappedIdentity();
  const before = structuredClone(stored);
  const transaction = ctx.storage.transaction;
  let reads = 0;
  ctx.storage.transaction = (change) =>
    transaction((tx) =>
      change({
        ...tx,
        get: async (key) => {
          reads += 1;
          return tx.get(key);
        },
        put: async () => assert.fail("Strict reads must not write"),
      }),
    );
  ctx.storage.list = async () => assert.fail("Strict reads must not scan");
  assert.deepEqual(await lookup.readEligible("game", "espn", ASSOCIATION.vendorId), guard);
  assert.equal(reads, 3);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [guard])), true);
  assert.equal(reads, 6);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, [])), false);
  assert.equal(await ctx.storage.transaction((tx) => lookup.validateGuards(tx, null)), false);
  assert.equal(
    await ctx.storage.transaction((tx) =>
      lookup.validateGuards(tx, [{ ...guard, league: "wnba" }]),
    ),
    false,
  );
  assert.deepEqual(stored, before);
});

test("canonical publication rejects revocation and old restored tokens without changing the saved document", async () => {
  const { ctx, stored, lookup, guard } = await createMappedIdentity();
  const store = createPublishingStore(ctx);
  const key = "games/canonical";
  const previous = { id: ASSOCIATION.internalId, state: "pre" };
  stored.set(key, previous);
  await revokeIdentity(lookup);
  assert.equal(
    await store.docs.replaceIfUnchanged(
      key,
      previous,
      { ...previous, state: "live" },
      { identityGuards: [guard] },
    ),
    false,
  );
  assert.deepEqual(stored.get(key), previous);
  await restoreIdentity(lookup);
  assert.equal(
    await store.docs.replaceIfUnchanged(
      key,
      previous,
      { ...previous, state: "live" },
      { identityGuards: [guard] },
    ),
    false,
  );
  const restored = await lookup.readEligible("game", "espn", ASSOCIATION.vendorId);
  assert.equal(
    await store.docs.replaceIfUnchanged(
      key,
      previous,
      { ...previous, state: "live" },
      { identityGuards: [restored] },
    ),
    true,
  );
  assert.equal(stored.get(key).state, "live");
});

test("canonical compare and identity validation use one transaction, including an unchanged document", async () => {
  const { ctx, stored, guard } = await createMappedIdentity();
  const key = "games/canonical";
  const document = { id: ASSOCIATION.internalId, state: "pre" };
  stored.set(key, document);
  const store = createPublishingStore(ctx);
  const transaction = ctx.storage.transaction;
  const readGroups = [];
  ctx.storage.transaction = (change) =>
    transaction((tx) => {
      const keys = [];
      readGroups.push(keys);
      return change({
        ...tx,
        get: async (key) => {
          keys.push(key);
          return tx.get(key);
        },
      });
    });
  assert.equal(
    await store.docs.replaceIfUnchanged(key, document, document, { identityGuards: [guard] }),
    true,
  );
  assert.equal(readGroups.length, 1);
  assert.deepEqual(readGroups[0], [
    key,
    "identity:vendor:espn:mlb:game:vendor-game",
    "identity:problem:identity:vendor:espn:mlb:game:vendor-game",
    "identity:entity:mlb:game:internal-game",
  ]);
  assert.equal(
    await store.docs.replaceIfUnchanged(key, document, document, { identityGuards: [] }),
    false,
  );
});

test("a dispute committed while canonical publication waits prevents the stale write", async () => {
  const { ctx, stored, lookup, guard } = await createMappedIdentity();
  const store = createPublishingStore(ctx);
  const key = "games/canonical";
  const previous = { id: ASSOCIATION.internalId, state: "pre" };
  stored.set(key, previous);
  const transaction = ctx.storage.transaction;
  const entered = createDeferred();
  const release = createDeferred();
  let waiting = true;
  ctx.storage.transaction = (change) => {
    if (!waiting) return transaction(change);
    waiting = false;
    entered.resolve(undefined);
    return release.promise.then(() => transaction(change));
  };
  const publishing = store.docs.replaceIfUnchanged(
    key,
    previous,
    { ...previous, state: "live" },
    { identityGuards: [guard] },
  );
  await entered.promise;
  await revokeIdentity(lookup);
  release.resolve(undefined);
  assert.equal(await publishing, false);
  assert.deepEqual(stored.get(key), previous);
});

for (const configured of [false, true]) {
  test(`store identity context is ${configured ? "shared" : "null"} for snapshots, details and background jobs`, async () => {
    const harness = createDurableObjectContext();
    const continuations = [];
    harness.ctx.waitUntil = (work) => continuations.push(work);
    const seen = {};
    const Store = createSeasonStore({
      ...(configured && { identity: identityPolicy }),
      createLoadSnapshot: (_storage, _fetchImpl, _readDoc, lookup) => {
        seen.snapshot = lookup;
        return async () => ({ season: 2026 });
      },
      loadCurrentSnapshot: async () => ({ season: 2026 }),
      readUpdates: async () => null,
      saveSnapshot: async () => {},
      describeSnapshotStatus: () => ({}),
      choosePollDelay: () => 60_000,
      listNotifications: () => [],
      createReadDetail: (context) => {
        seen.detail = context.identityLookup;
        return async () => null;
      },
      backgroundJobs: {
        fixture: {
          chooseDelay: () => 60_000,
          updateStore: async (context) => {
            seen.job = context.identityLookup;
          },
          updateHistory: async (context) => {
            seen.history = context.identityLookup;
          },
        },
      },
    });
    const store = new Store(
      harness.ctx,
      {},
      {
        now: () => 0,
        fetchImpl: async () => assert.fail("Unexpected vendor request"),
      },
    );
    await store.alarm();
    await Promise.all(continuations);
    const expected = store.identities?.lookup ?? null;
    for (const context of ["snapshot", "detail", "job", "history"])
      assert.equal(seen[context], expected, context);
    if (expected) {
      await seen.snapshot.save([ASSOCIATION]);
      const guard = await seen.detail.readEligible("game", "espn", ASSOCIATION.vendorId);
      assert.equal(guard.internalId, ASSOCIATION.internalId);
      assert.equal(
        await seen.job.discover({ type: "game", vendor: "espn", vendorId: ASSOCIATION.vendorId }),
        guard.internalId,
      );
    } else
      assert.equal(
        await store.docs.replaceIfUnchanged(
          "games/unknown",
          null,
          { id: "unknown" },
          { identityGuards: [] },
        ),
        false,
      );
  });
}
