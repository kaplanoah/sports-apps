import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonStore } from "../shared/worker/season-store.js";
import {
  createIdentityLookup,
  nameIdentityCandidatePrefix,
  IDENTITY_COVERAGE_KEY,
  IDENTITY_BACKFILL_KEY,
  IDENTITY_ERROR_PREFIX,
} from "../shared/worker/identity.js";
import { IDENTITY_WORK_PER_RUN } from "../shared/worker/identity-backfill.js";
import { createDurableObjectContext } from "./durable-object-context.js";

/** @type {import("../shared/worker/identity-documents.js").IdentityPolicy} */
const POLICY = {
  league: "nba",
  vendor: "nba",
  nativeIdMode: "internal",
  gameFactFields: ["season", "isCupFinal"],
  readGameFacts: (record, season) => ({
    ...((record.season ?? season) ? { season: record.season ?? season } : {}),
    ...(record.isCupFinal !== undefined && { isCupFinal: record.isCupFinal }),
  }),
  readSeriesFacts: () => ({}),
};

const Store = createSeasonStore({
  identity: POLICY,
  createLoadSnapshot: () => async () => ({ season: 2026 }),
  loadCurrentSnapshot: async () => ({ season: 2026 }),
  readUpdates: async () => null,
  saveSnapshot: async () => {},
  describeSnapshotStatus: () => ({}),
  choosePollDelay: () => 60_000,
  listNotifications: () => [],
});
const OPTIONS = { fetchImpl: async () => assert.fail("Unexpected vendor request") };
const createStore = (ctx, options = {}) => new Store(ctx, {}, { ...OPTIONS, ...options });
const createGame = (id) => ({
  id,
  season: 2026,
  isCupFinal: false,
  state: "pre",
  away: "NYK",
  home: "LAL",
  start: "2026-06-01T18:00:00Z",
});

async function finishBackfill(store) {
  for (let step = 0; step < 500; step++) {
    if ((await store.identities.readStatus()).backfill.complete) return;
    await store.identities.backfill(store.docs);
  }
  assert.fail("Backfill exceeded its bounded fixture steps");
}

test("actual opaque-ID document and detail writers preserve registered native associations", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const lookup = store.identities.lookup;
  const gameId = await lookup.discover({ type: "game", vendor: "nba", vendorId: "native-game" });
  const playerId = await lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "native-player",
  });
  const gameGuard = await lookup.readEligible("game", "nba", "native-game");
  const playerGuard = await lookup.readEligible("player", "nba", "native-player");
  const game = createGame(gameId);
  const player = { id: playerId, firstName: "Example", lastName: "Player", team: "NYK" };
  await store.docs.write("seasons/2026", { season: 2026, games: [game], players: [player] });
  await store.docs.write(`games/${gameId}`, {
    ...game,
    boxScore: { id: gameId, players: [player] },
  });
  await store.docs.write(`players/2026-${playerId}`, { ...player, season: 2026, games: [game] });
  await store.docs.write(`highlights/${gameId}`, { id: gameId, season: 2026, clips: [] });
  await store.createJobStorage("details").put("detail-answer:/players?season=2026", {
    body: { season: 2026, players: [player], games: [game] },
  });
  assert.equal(await lookup.read("game", "nba", gameId), null);
  assert.equal(await lookup.read("player", "nba", playerId), null);
  assert.deepEqual(await lookup.readEligible("game", "nba", "native-game"), gameGuard);
  assert.deepEqual(await lookup.readEligible("player", "nba", "native-player"), playerGuard);
  assert.equal((await lookup.readEntry("game", gameId)).facts.season, 2026);
  assert.equal((await lookup.readEntry("player", playerId)).facts.team, "NYK");
  await finishBackfill(store);
  const status = await store.identities.readStatus();
  assert.equal(status.games, 1);
  assert.equal(status.players, 1);
  assert.equal(status.disputed, 0);
  assert.equal(status.errors, 0);
  assert.equal(status.checks.verified, true);
  const before = structuredClone(stored);
  let announced = 0;
  let writes = 0;
  store.announceChange = () => announced++;
  const put = ctx.storage.put;
  ctx.storage.put = async (...args) => {
    writes++;
    return put(...args);
  };
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (change) =>
    transaction((inner) =>
      change({
        ...inner,
        put: async (...args) => {
          writes++;
          return inner.put(...args);
        },
      }),
    );
  await store.docs.write("seasons/2026", { season: 2026, games: [game], players: [player] });
  assert.equal(announced, 0);
  assert.equal(writes, 0);
  assert.deepEqual(stored, before);
});

test("registered fact refresh preserves quarantine, evidence and tokens through changed starts and trades", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const lookup = store.identities.lookup;
  const game = createGame("g_existing");
  const player = { id: "p_existing", firstName: "Example", lastName: "Player", team: "NYK" };
  const associations = [
    { type: "game", vendorId: "native-game", internalId: game.id },
    { type: "player", vendorId: "native-player", internalId: player.id },
  ].map((value) => ({ ...value, vendor: "nba", evidence: { method: "discovery" } }));
  await lookup.save(associations);
  await store.docs.write("seasons/2026", { season: 2026, games: [game], players: [player] });
  await lookup.save(associations.map((value) => ({ ...value, disputed: true })));
  const bindings = structuredClone(
    new Map(
      [...stored].filter(
        ([key]) => key.startsWith("identity:vendor:") || key.startsWith("identity:problem:"),
      ),
    ),
  );
  const changed = { ...game, start: "2026-06-02T18:00:00Z" };
  await store.docs.write("seasons/2026", {
    season: 2026,
    games: [changed],
    players: [{ ...player, team: "LAL" }],
  });
  assert.deepEqual(
    new Map(
      [...stored].filter(
        ([key]) => key.startsWith("identity:vendor:") || key.startsWith("identity:problem:"),
      ),
    ),
    bindings,
  );
  assert.equal((await lookup.readEntry("game", game.id)).facts.start, changed.start);
  assert.equal((await lookup.readEntry("player", player.id)).facts.team, "LAL");
  assert.equal((await lookup.readStatus()).disputed, 2);
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal((await store.identities.readStatus()).disputed, 2);
  assert.equal(await lookup.readEligible("game", "nba", "native-game"), null);
  assert.equal(
    (await ctx.storage.list({ prefix: nameIdentityCandidatePrefix("nba", "game", game) })).size,
    0,
  );
  assert.equal(
    (await ctx.storage.list({ prefix: nameIdentityCandidatePrefix("nba", "game", changed) })).size,
    1,
  );
});

test("missing registration remains visible without creating an identity or alias and later registration recovers", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const game = createGame("g_unregistered");
  await store.docs.write("seasons/2026", { season: 2026, games: [game] });
  const lookup = store.identities.lookup;
  assert.equal(await lookup.readEntry("game", game.id), undefined);
  assert.equal(await lookup.read("game", "nba", game.id), null);
  assert.equal((await store.identities.readStatus()).errors, 1);
  await finishBackfill(store);
  const incomplete = await store.identities.readStatus();
  assert.equal(incomplete.checks.verified, false);
  assert.ok(incomplete.checks.missingEntries > 0);
  await lookup.save([
    {
      type: "game",
      vendor: "nba",
      vendorId: "native-game",
      internalId: game.id,
      evidence: { method: "discovery" },
    },
  ]);
  await store.docs.write("seasons/2026", { season: 2026, games: [game] });
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal(await lookup.read("game", "nba", game.id), null);
  assert.equal(stored.get("seasons/2026").games[0].id, game.id);
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("inconsistent native registration cannot update facts or repair associations", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const lookup = createIdentityLookup(ctx.storage, "nba");
  await lookup.save([
    {
      type: "game",
      vendor: "nba",
      vendorId: "native-game",
      internalId: "g_existing",
      evidence: { method: "discovery" },
      facts: { season: 2025 },
    },
  ]);
  const key = "identity:vendor:nba:nba:game:native-game";
  stored.set(key, { ...stored.get(key), internalId: "another-game" });
  const before = structuredClone(stored);
  const saved = await lookup.updateRegisteredFacts([
    { type: "game", vendor: "nba", internalId: "g_existing", facts: { season: 2026 } },
  ]);
  assert.equal(saved.results[0].missing, true);
  assert.deepEqual(stored, before);
  await assert.rejects(
    lookup.updateRegisteredFacts([
      { type: "game", vendor: "nba", internalId: "g_existing", vendorId: "invented", facts: {} },
    ]),
  );
  assert.deepEqual(stored, before);
});

test("an audit cannot clear inconsistent registered evidence or scope and verify coverage", async () => {
  for (const corruption of ["evidence", "association-league", "entity-type"]) {
    const { ctx, stored } = createDurableObjectContext();
    let store = createStore(ctx);
    const lookup = store.identities.lookup;
    const game = createGame("g_inconsistent");
    await lookup.save([
      {
        type: "game",
        vendor: "nba",
        vendorId: "native-game",
        internalId: game.id,
        evidence: { method: "discovery" },
        facts: { season: 2026 },
      },
    ]);
    const association = stored.get("identity:vendor:nba:nba:game:native-game");
    const entry = stored.get("identity:entity:nba:game:g_inconsistent");
    if (corruption === "evidence") association.evidence = { method: "teams-day" };
    if (corruption === "association-league") association.league = "wnba";
    if (corruption === "entity-type") entry.type = "player";
    await store.docs.write("seasons/2026", { season: 2026, games: [game] });
    assert.equal((await store.identities.readStatus()).errors, 1, corruption);
    await store.identities.backfill(store.docs);
    store = createStore(ctx);
    await finishBackfill(store);
    const status = await store.identities.readStatus();
    assert.equal(status.errors, 1, corruption);
    assert.equal(status.checks.verified, false, corruption);
  }
});

test("late player registration invalidates an incomplete coverage result and recovers without aliases", async () => {
  const { ctx } = createDurableObjectContext();
  const store = createStore(ctx);
  const player = { id: "p_unregistered", firstName: "Example", lastName: "Player", season: 2026 };
  const key = "players/2026-p_unregistered";
  await store.docs.write(key, player);
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  await store.identities.lookup.save([
    {
      type: "player",
      vendor: "nba",
      vendorId: "native-player",
      internalId: player.id,
      evidence: { method: "discovery" },
      facts: { season: 2026 },
    },
  ]);
  await store.docs.write(key, player);
  assert.equal((await store.identities.readStatus()).backfill.complete, false);
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal(await store.identities.lookup.read("player", "nba", player.id), null);
});

test("native registration restarts rejected historical documents and cached answers without rewriting them", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const clock = { now: Date.parse("2026-06-01T12:00:00Z") };
    const options = { now: () => clock.now };
    let store = createStore(ctx, options);
    const player = { id: "p_late", firstName: "Example", lastName: "Player", season: 2025 };
    const documentKey = "players/2025-p_late";
    const answerKey = "detail-answer:/players?season=2025";
    const sourceKey = cached ? `job:details:${answerKey}` : documentKey;
    if (cached) await store.createJobStorage("details").put(answerKey, { body: player });
    else await store.docs.write(documentKey, player);
    await finishBackfill(store);
    const before = structuredClone(stored.get(sourceKey));
    assert.equal((await store.identities.readStatus()).errors, 1);
    assert.equal((await store.identities.readStatus()).backfill.complete, true);
    await store.identities.lookup.save([
      {
        type: "player",
        vendor: "nba",
        vendorId: "native-late",
        internalId: player.id,
        evidence: { method: "discovery" },
        facts: { season: 2025 },
      },
    ]);
    assert.equal((await store.identities.readStatus()).backfill.complete, false);
    let sourceWrites = 0;
    const put = ctx.storage.put;
    ctx.storage.put = async (key, value) => {
      if (key === sourceKey) sourceWrites++;
      return put(key, value);
    };
    const transaction = ctx.storage.transaction;
    ctx.storage.transaction = (change) =>
      transaction((inner) =>
        change({
          ...inner,
          put: async (key, value) => {
            if (key === sourceKey) sourceWrites++;
            return inner.put(key, value);
          },
        }),
      );
    for (let step = 0; step < 100; step++) {
      store = createStore(ctx, options);
      await store.identities.backfillWhenDue(store.docs);
      if ((await store.identities.readStatus()).backfill.complete) break;
      clock.now += 60_000;
    }
    const status = await store.identities.readStatus();
    assert.equal(status.errors, 0);
    assert.equal(status.checks.verified, true);
    assert.equal(sourceWrites, 0);
    assert.deepEqual(stored.get(sourceKey), before);
    assert.equal(await store.identities.lookup.read("player", "nba", player.id), null);
  }
});

test("only new or restored native registration resets internal-mode coverage", async () => {
  const { ctx, stored } = createDurableObjectContext();
  stored.set(`${IDENTITY_ERROR_PREFIX}rejected:players`, 1);
  const lookup = createStore(ctx).identities.lookup;
  const transaction = ctx.storage.transaction;
  let invalidations = 0;
  ctx.storage.transaction = (change) =>
    transaction((inner) => {
      const writes = [];
      const reads = [];
      return change({
        ...inner,
        get: async (key) => {
          reads.push(key);
          return inner.get(key);
        },
        list: async (options) => {
          assert.deepEqual(options, { prefix: `${IDENTITY_ERROR_PREFIX}rejected:`, limit: 1 });
          return inner.list(options);
        },
        put: async (key, value) => {
          writes.push(key);
          if (key === IDENTITY_COVERAGE_KEY) {
            invalidations++;
            assert.ok(writes.some((written) => written.startsWith("identity:vendor:nba:nba:")));
            assert.ok(reads.some((read) => read.startsWith("identity:entity:nba:")));
          }
          return inner.put(key, value);
        },
      });
    });
  const asked = { type: /** @type {const} */ ("player"), vendor: "nba", vendorId: "native-player" };
  const ids = await Promise.all([lookup.discover(asked), lookup.discover(asked)]);
  assert.equal(ids[0], ids[1]);
  assert.equal(invalidations, 1);
  const revision = stored.get(IDENTITY_COVERAGE_KEY);
  assert.ok(revision);
  const registration = { ...asked, internalId: ids[0], evidence: { method: "existing-id" } };
  await lookup.save([registration]);
  await lookup.updateRegisteredFacts([
    { type: "player", vendor: "nba", internalId: ids[0], facts: { team: "LAL" } },
  ]);
  await lookup.save([{ ...registration, vendor: "espn", vendorId: "espn-player" }]);
  assert.equal(stored.get(IDENTITY_COVERAGE_KEY), revision);
  assert.equal(invalidations, 1);
  await lookup.save([
    {
      type: "player",
      vendor: "espn",
      vendorId: "another-espn-player",
      internalId: "p_saved",
      evidence: { method: "discovery" },
    },
  ]);
  assert.equal(stored.get(IDENTITY_COVERAGE_KEY), revision);
  const added = {
    type: "player",
    vendor: "nba",
    vendorId: "late-native-player",
    internalId: "p_saved",
    evidence: { method: "discovery" },
  };
  await lookup.save([added]);
  const afterRegistration = stored.get(IDENTITY_COVERAGE_KEY);
  assert.notEqual(afterRegistration, revision);
  await lookup.save([{ ...added, disputed: true }]);
  assert.equal(stored.get(IDENTITY_COVERAGE_KEY), afterRegistration);
  stored.get("identity:vendor:nba:nba:player:late-native-player").evidence = {
    method: "teams-day",
  };
  await lookup.save([{ ...added, decisive: true }]);
  assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), afterRegistration);
  assert.equal(invalidations, 3);
  const legacy = createDurableObjectContext();
  await createIdentityLookup(legacy.ctx.storage, "nba").save([added]);
  assert.equal(legacy.stored.has(IDENTITY_COVERAGE_KEY), false);
});

test("native registration rolls back its mapping and entity if coverage invalidation fails", async () => {
  for (const discover of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const lookup = createStore(ctx).identities.lookup;
    stored.set(`${IDENTITY_ERROR_PREFIX}rejected:games`, 1);
    const before = structuredClone(stored);
    const transaction = ctx.storage.transaction;
    ctx.storage.transaction = (change) =>
      transaction((inner) =>
        change({
          ...inner,
          put: async (key, value) => {
            if (key === IDENTITY_COVERAGE_KEY) throw new Error("Coverage unavailable");
            return inner.put(key, value);
          },
        }),
      );
    const asked = { type: /** @type {const} */ ("game"), vendor: "nba", vendorId: "native-game" };
    await assert.rejects(
      discover
        ? lookup.discover(asked)
        : lookup.save([{ ...asked, internalId: "g_saved", evidence: { method: "discovery" } }]),
      /Coverage unavailable/,
    );
    assert.equal(await lookup.read("game", "nba", asked.vendorId), null);
    assert.equal((await lookup.readStatus()).games, 0);
    assert.deepEqual(stored, before);
    ctx.storage.transaction = transaction;
    assert.ok(await lookup.discover(asked));
    assert.ok(stored.get(IDENTITY_COVERAGE_KEY));
  }
});

test("new native identities preserve a finished healthy audit and its revision", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  stored.set(IDENTITY_COVERAGE_KEY, "healthy-generation");
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  const progress = structuredClone(stored.get(IDENTITY_BACKFILL_KEY));
  for (const type of /** @type {const} */ (["game", "player"])) {
    const id = await store.identities.lookup.discover({
      type,
      vendor: "nba",
      vendorId: `new-${type}`,
      facts: { season: 2026 },
    });
    assert.ok(id);
    assert.equal(stored.get(IDENTITY_COVERAGE_KEY), "healthy-generation");
    assert.deepEqual(stored.get(IDENTITY_BACKFILL_KEY), progress);
    assert.equal((await store.identities.readStatus()).backfill.complete, true);
    assert.equal((await store.identities.readStatus()).checks.verified, true);
  }
});

test("native registration invalidates completed and pending missing-entry coverage without a rejection row", async () => {
  for (const pending of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const lookup = createStore(ctx).identities.lookup;
    stored.set(IDENTITY_COVERAGE_KEY, "missing-generation");
    stored.set(
      IDENTITY_BACKFILL_KEY,
      pending ? { pending: { missingEntries: 1 } } : { missingEntries: 1 },
    );
    await lookup.discover({ type: "player", vendor: "nba", vendorId: "missing-player" });
    assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), "missing-generation");
  }
});

test("coverage demand sees rejection inserts and deletions within the registration transaction", async () => {
  for (const inserting of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const lookup = createStore(ctx).identities.lookup;
    const key = `${IDENTITY_ERROR_PREFIX}rejected:players`;
    stored.set(IDENTITY_COVERAGE_KEY, "existing-generation");
    if (!inserting) stored.set(key, 1);
    const transaction = ctx.storage.transaction;
    ctx.storage.transaction = (change) =>
      transaction(async (inner) => {
        if (inserting) await inner.put(key, 1);
        else await inner.delete(key);
        return change(inner);
      });
    await lookup.discover({ type: "player", vendor: "nba", vendorId: "new-player" });
    assert.equal(stored.get(IDENTITY_COVERAGE_KEY) !== "existing-generation", inserting);
  }
});

test("registration queued after a missing-identity check cannot leave delayed rejection evidence stuck", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const clock = { now: Date.parse("2026-06-01T12:00:00Z") };
  const options = { now: () => clock.now };
  let store = createStore(ctx, options);
  await finishBackfill(store);
  const lookup = store.identities.lookup;
  const updateRegisteredFacts = lookup.updateRegisteredFacts;
  let registration;
  lookup.updateRegisteredFacts = async (...args) => {
    const result = await updateRegisteredFacts(...args);
    if (!registration && result?.results?.some((entry) => entry.missing))
      registration = lookup.save([
        {
          type: "player",
          vendor: "nba",
          vendorId: "native-racing-player",
          internalId: "p_racing",
          evidence: { method: "discovery" },
          facts: { season: 2025 },
        },
      ]);
    await registration;
    return result;
  };
  const key = "players/2025-p_racing";
  await store.docs.write(key, {
    id: "p_racing",
    firstName: "Example",
    lastName: "Player",
    season: 2025,
  });
  assert.ok(registration);
  await registration;
  const source = structuredClone(stored.get(key));
  for (let step = 0; step < 100; step++) {
    store = createStore(ctx, options);
    await store.identities.backfillWhenDue(store.docs);
    if ((await store.identities.readStatus()).checks.verified) break;
    clock.now += 60_000;
  }
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.deepEqual(stored.get(key), source);
});

test("native fact updates roll back if their source rejection evidence cannot persist", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const lookup = createStore(ctx).identities.lookup;
  await lookup.save([
    {
      type: "player",
      vendor: "nba",
      vendorId: "native-player",
      internalId: "p_saved",
      evidence: { method: "discovery" },
      facts: { team: "NYK" },
    },
  ]);
  const before = structuredClone(stored);
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = (change) =>
    transaction((inner) =>
      change({
        ...inner,
        put: async (key, value) => {
          if (key.startsWith(`${IDENTITY_ERROR_PREFIX}rejected:`))
            throw new Error("Evidence unavailable");
          return inner.put(key, value);
        },
      }),
    );
  await assert.rejects(
    lookup.updateRegisteredFacts(
      [{ type: "player", vendor: "nba", internalId: "p_saved", facts: { team: "LAL" } }],
      { key: "players/2025-p_saved", rejected: 1 },
    ),
    /Evidence unavailable/,
  );
  assert.deepEqual(stored, before);
});

test("registration restored after a failed coverage check recovers without rewriting its source", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const clock = { now: Date.parse("2026-06-01T12:00:00Z") };
  const store = createStore(ctx, { now: () => clock.now });
  const lookup = store.identities.lookup;
  const association = {
    type: "player",
    vendor: "nba",
    vendorId: "native-player",
    internalId: "p_checked",
    evidence: { method: "discovery" },
    facts: { season: 2025 },
  };
  await lookup.save([association]);
  const key = "players/2025-p_checked";
  await store.docs.write(key, {
    id: "p_checked",
    firstName: "Example",
    lastName: "Player",
    season: 2025,
  });
  await finishBackfill(store);
  const source = structuredClone(stored.get(key));
  stored.set(IDENTITY_COVERAGE_KEY, "check-registration-again");
  const recordRegistrationCheck = lookup.recordRegistrationCheck;
  let restored = false;
  lookup.recordRegistrationCheck = async (...args) => {
    if (restored || args[2] !== association.internalId) return recordRegistrationCheck(...args);
    await lookup.save([{ ...association, internalId: "p_other", decisive: true }]);
    const registered = await recordRegistrationCheck(...args);
    assert.equal(registered, false);
    await lookup.save([{ ...association, decisive: true }]);
    restored = true;
    return registered;
  };
  for (let step = 0; step < 100; step++) {
    await store.identities.backfillWhenDue(store.docs);
    if (restored && (await store.identities.readStatus()).checks.verified) break;
    clock.now += 60_000;
  }
  assert.equal(restored, true);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.deepEqual(stored.get(key), source);
});

test("fact updates serialize with decisive reassociation without restoring a revoked native binding", async () => {
  for (const repairFirst of [false, true]) {
    const { ctx } = createDurableObjectContext();
    const lookup = createIdentityLookup(ctx.storage, "nba");
    const association = {
      type: "game",
      vendor: "nba",
      vendorId: "native-game",
      internalId: "g_old",
      evidence: { method: "discovery" },
    };
    await lookup.save([association]);
    const refresh = () =>
      lookup.updateRegisteredFacts([
        { type: "game", vendor: "nba", internalId: "g_old", facts: { season: 2026 } },
      ]);
    const repair = () => lookup.save([{ ...association, internalId: "g_new", decisive: true }]);
    const operations = repairFirst ? [repair(), refresh()] : [refresh(), repair()];
    const outcomes = await Promise.all(operations);
    assert.equal(await lookup.read("game", "nba", association.vendorId), "g_new");
    assert.equal(await lookup.read("game", "nba", "g_old"), null);
    assert.equal((await lookup.readEntry("game", "g_old")).vendors.nba, undefined);
    const refreshResult = outcomes[repairFirst ? 1 : 0];
    assert.equal(refreshResult.results[0].missing, repairFirst);
  }
});

test("opaque nested backfill stays sliced and resumes across store restarts without vendor aliases", async () => {
  const { ctx, stored } = createDurableObjectContext();
  let store = createStore(ctx);
  const lookup = store.identities.lookup;
  const games = [];
  for (let index = 0; index < 45; index++) {
    const id = await lookup.discover({ type: "game", vendor: "nba", vendorId: `native-${index}` });
    games.push(createGame(id));
  }
  stored.set("seasons/2026", { season: 2026, games });
  const revision = await lookup.readFactsRevision();
  const transaction = ctx.storage.transaction;
  let reads = 0;
  ctx.storage.transaction = (change) =>
    transaction((inner) =>
      change({
        ...inner,
        get: async (key) => {
          reads++;
          return inner.get(key);
        },
      }),
    );
  const first = store.identities.lookup.updateRegisteredFacts;
  let largestBatch = 0;
  store.identities.lookup.updateRegisteredFacts = async (updates) => {
    largestBatch = Math.max(largestBatch, updates.length);
    return first(updates);
  };
  await store.identities.backfill(store.docs);
  assert.ok(largestBatch > 0 && largestBatch < games.length);
  assert.ok(largestBatch <= IDENTITY_WORK_PER_RUN);
  assert.ok(reads < IDENTITY_WORK_PER_RUN * 12 + 30);
  assert.notEqual(await lookup.readFactsRevision(), revision);
  for (let step = 0; step < 500; step++) {
    store = createStore(ctx);
    if ((await store.identities.readStatus()).backfill.complete) break;
    await store.identities.backfill(store.docs);
  }
  const status = await store.identities.readStatus();
  assert.equal(status.backfill.complete, true);
  assert.equal(status.checks.verified, true);
  assert.equal(status.games, games.length);
  assert.equal(status.disputed, 0);
  assert.equal(
    [...stored.keys()].filter((key) => key.startsWith("identity:vendor:")).length,
    games.length,
  );
  for (const game of games) {
    assert.equal(await lookup.read("game", "nba", game.id), null);
    assert.equal((await lookup.readEntry("game", game.id)).facts.season, 2026);
  }
});
