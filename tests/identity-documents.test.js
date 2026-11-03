import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonStore } from "../shared/worker/season-store.js";
import {
  createIdentityLookup,
  nameIdentityCandidatePrefix,
  IDENTITY_COVERAGE_KEY,
  IDENTITY_BACKFILL_KEY,
  IDENTITY_ERROR_PREFIX,
  IDENTITY_UNREGISTERED_PREFIX,
  readIdentitySourceRejections,
} from "../shared/worker/identity.js";
import { IDENTITY_WORK_PER_RUN } from "../shared/worker/identity-backfill.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { createDeferred } from "./deferred.js";

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
  stored.set(`${IDENTITY_UNREGISTERED_PREFIX}players`, 1);
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
          assert.deepEqual(options, { prefix: IDENTITY_UNREGISTERED_PREFIX, limit: 1 });
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
    stored.set(`${IDENTITY_UNREGISTERED_PREFIX}games`, 1);
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
      pending ? { pending: { nativeMissingEntries: 1 } } : { nativeMissingEntries: 1 },
    );
    await lookup.discover({ type: "player", vendor: "nba", vendorId: "missing-player" });
    assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), "missing-generation");
  }
});

test("unrelated vendor rejection and vendor-only missing coverage do not restart native audits", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  stored.set(IDENTITY_COVERAGE_KEY, "vendor-uncertainty");
  await finishBackfill(store);
  await store.identities.saveVendorGames([], 1);
  const progress = stored.get(IDENTITY_BACKFILL_KEY);
  progress.missingEntries = 2;
  const before = structuredClone(progress);
  for (const type of /** @type {const} */ (["game", "player"])) {
    await store.identities.lookup.discover({ type, vendor: "nba", vendorId: `new-${type}` });
    assert.equal(stored.get(IDENTITY_COVERAGE_KEY), "vendor-uncertainty");
    assert.deepEqual(stored.get(IDENTITY_BACKFILL_KEY), before);
    const status = await store.identities.readStatus();
    assert.equal(status.backfill.complete, true);
    assert.equal(status.checks.verified, false);
    assert.equal(status.errors, 1);
  }
});

test("partial source checks preserve later missing registration demand and restore its facts", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const clock = { now: Date.parse("2026-06-01T12:00:00Z") };
  const store = createStore(ctx, { now: () => clock.now });
  const lookup = store.identities.lookup;
  const players = Array.from({ length: 30 }, (_, index) => ({
    id: `p_${index}`,
    firstName: "Example",
    lastName: `Player${index}`,
    team: "NYK",
  }));
  await lookup.save(
    players.slice(0, -1).map((player) => ({
      type: "player",
      vendor: "nba",
      vendorId: `native-${player.id}`,
      internalId: player.id,
      evidence: { method: "discovery" },
      facts: { season: 2025 },
    })),
  );
  const key = "seasons/2025";
  await store.docs.write(key, { season: 2025, players });
  const before = structuredClone(stored.get(key));
  const marker = `${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`;
  const check = lookup.recordRegistrationCheck;
  let checked = 0;
  let registered = false;
  lookup.recordRegistrationCheck = async (...args) => {
    const result = await check(...args);
    if (++checked === 19) {
      assert.equal(stored.get(marker), 1);
      const revision = stored.get(IDENTITY_COVERAGE_KEY);
      const player = players.at(-1);
      await lookup.save([
        {
          type: "player",
          vendor: "nba",
          vendorId: `native-${player.id}`,
          internalId: player.id,
          evidence: { method: "discovery" },
          facts: { season: 2025 },
        },
      ]);
      assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), revision);
      registered = true;
    }
    return result;
  };
  for (let step = 0; step < 100; step++) {
    await store.identities.backfillWhenDue(store.docs);
    if (registered && (await store.identities.readStatus()).checks.verified) break;
    clock.now += 60_000;
  }
  assert.equal(registered, true);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal(stored.has(marker), false);
  assert.deepEqual(stored.get(key), before);
  const player = players.at(-1);
  assert.deepEqual((await lookup.readEntry("player", player.id)).facts, {
    season: 2025,
    firstName: player.firstName,
    lastName: player.lastName,
    team: player.team,
  });
  assert.ok(
    [
      ...(
        await ctx.storage.list({ prefix: nameIdentityCandidatePrefix("nba", "player", player) })
      ).values(),
    ].includes(player.id),
  );
});

test("deleting a missing native source clears its demand without restarting healthy coverage", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  stored.set(IDENTITY_COVERAGE_KEY, "healthy-generation");
  await finishBackfill(store);
  const job = store.createJobStorage("details");
  const key = "detail-answer:/players?season=2025";
  await job.put(key, {
    body: {
      season: 2025,
      players: [{ id: "p_missing", firstName: "Example", lastName: "Player" }],
    },
  });
  assert.equal((await ctx.storage.list({ prefix: IDENTITY_UNREGISTERED_PREFIX })).size, 1);
  assert.equal((await store.identities.readStatus()).errors, 1);
  await job.delete(key);
  assert.equal((await ctx.storage.list({ prefix: IDENTITY_UNREGISTERED_PREFIX })).size, 0);
  assert.equal((await store.identities.readStatus()).errors, 0);
  await store.identities.lookup.discover({ type: "player", vendor: "nba", vendorId: "new-player" });
  assert.equal(stored.get(IDENTITY_COVERAGE_KEY), "healthy-generation");
  assert.equal((await store.identities.readStatus()).checks.verified, true);
});

test("replacing a source with no native observations clears its missing registration demand", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    stored.set(IDENTITY_COVERAGE_KEY, "healthy-generation");
    await finishBackfill(store);
    const write = cached
      ? (document) =>
          store
            .createJobStorage("details")
            .put("detail-answer:/players?season=2025", { body: document })
      : (document) => store.docs.write("seasons/2025", document);
    await write({
      season: 2025,
      players: [{ id: "p_missing", firstName: "Example", lastName: "Player" }],
    });
    assert.equal((await ctx.storage.list({ prefix: IDENTITY_UNREGISTERED_PREFIX })).size, 1);
    await write({ season: 2025, players: [] });
    assert.equal((await ctx.storage.list({ prefix: IDENTITY_UNREGISTERED_PREFIX })).size, 0);
    assert.equal((await store.identities.readStatus()).errors, 0);
    await store.identities.lookup.discover({
      type: "player",
      vendor: "nba",
      vendorId: "new-player",
    });
    assert.equal(stored.get(IDENTITY_COVERAGE_KEY), "healthy-generation");
    assert.equal((await store.identities.readStatus()).checks.verified, true);
  }
});

test("a source changed before finalizing its check retains newly missing native demand", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const lookup = store.identities.lookup;
  const player = { id: "p_registered", firstName: "Example", lastName: "Player" };
  await lookup.save([
    {
      type: "player",
      vendor: "nba",
      vendorId: "native-player",
      internalId: player.id,
      evidence: { method: "discovery" },
    },
  ]);
  const key = "seasons/2025";
  await store.docs.write(key, { season: 2025, players: [player] });
  const check = lookup.recordRegistrationCheck;
  let changeBeforeFinalizing = false;
  let changed = false;
  lookup.recordRegistrationCheck = async (...args) => {
    const result = await check(...args);
    if (!changed) changeBeforeFinalizing = true;
    return result;
  };
  const transaction = ctx.storage.transaction;
  ctx.storage.transaction = async (callback) => {
    if (changeBeforeFinalizing) {
      changeBeforeFinalizing = false;
      changed = true;
      await store.docs.write(key, {
        season: 2025,
        players: [player, { id: "p_missing", firstName: "Missing", lastName: "Player" }],
      });
    }
    return transaction(callback);
  };
  for (let step = 0; step < 100 && !changed; step++) await store.identities.backfill(store.docs);
  assert.equal(changed, true);
  assert.equal(stored.get(`${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`), 1);
  assert.equal((await store.identities.readStatus()).errors, 1);
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("a recreated source keeps its rejection and native demand until it is actually deleted", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    const key = cached ? "job:details:detail-answer:/players?season=2025" : "seasons/2025";
    const job = store.createJobStorage("details");
    const write = (player) =>
      cached
        ? job.put("detail-answer:/players?season=2025", {
            body: { season: 2025, players: [player] },
          })
        : store.docs.write(key, { season: 2025, players: [player] });
    await write({ id: "p_missing", firstName: "Missing", lastName: "Player" });
    const remove = ctx.storage.delete;
    let recreate = true;
    ctx.storage.delete = async (asked) => {
      const removed = await remove(asked);
      if (asked === key && recreate) {
        recreate = false;
        await write({ id: "p_other_missing", firstName: "Other", lastName: "Player" });
      }
      return removed;
    };
    const deleteSource = () =>
      cached ? job.delete("detail-answer:/players?season=2025") : store.docs.remove(key);
    await deleteSource();
    const marker = `${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`;
    assert.ok(stored.has(key));
    assert.equal(stored.get(marker), 1);
    assert.equal((await store.identities.readStatus()).errors, 1);
    await deleteSource();
    assert.equal(stored.has(key), false);
    assert.equal(stored.has(marker), false);
    assert.equal((await store.identities.readStatus()).errors, 0);
  }
});

for (const interruption of ["audit", "delete", "register"]) {
  test(`native publication preserves demand when ${interruption} runs after preparation`, async () => {
    for (const cached of [false, true]) {
      const { ctx, stored } = createDurableObjectContext();
      const store = createStore(ctx);
      const key = cached ? "job:details:detail-answer:/players?season=2025" : "seasons/2025";
      const answerKey = "detail-answer:/players?season=2025";
      const job = store.createJobStorage("details");
      const write = (document) =>
        cached ? job.put(answerKey, { body: document }) : store.docs.write(key, document);
      await write({ season: 2025, players: [] });
      await finishBackfill(store);
      const player = { id: "p_later", firstName: "Later", lastName: "Player", team: "NYK" };
      const document = { season: 2025, players: [player] };
      const publish = store.identities.publishDocument;
      const entered = createDeferred();
      const release = createDeferred();
      store.identities.publishDocument = async (...args) => {
        entered.resolve(undefined);
        await release.promise;
        return publish(...args);
      };
      const writing = write(document);
      assert.equal(
        await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
        true,
        "The writer bypassed native publication",
      );
      const marker = `${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`;
      assert.equal(stored.get(marker), 1);
      if (interruption === "delete") {
        if (cached) await job.delete(answerKey);
        else await store.docs.remove(key);
      } else {
        stored.set(IDENTITY_COVERAGE_KEY, "recheck-old-source");
        await finishBackfill(store);
      }
      assert.equal(stored.has(marker), false);
      const registration = {
        type: "player",
        vendor: "nba",
        vendorId: "native-later",
        internalId: player.id,
        evidence: { method: "discovery" },
        facts: { season: 2025 },
      };
      if (interruption === "register") await store.identities.lookup.save([registration]);
      release.resolve(undefined);
      await writing;
      assert.deepEqual(cached ? stored.get(key).body : stored.get(key), document);
      if (interruption !== "register") {
        assert.equal(stored.get(marker), 1);
        assert.equal((await store.identities.readStatus()).checks.verified, false);
        const revision = stored.get(IDENTITY_COVERAGE_KEY);
        await store.identities.lookup.save([registration]);
        assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), revision);
      }
      await finishBackfill(store);
      assert.equal((await store.identities.readStatus()).checks.verified, true);
      const entry = await store.identities.lookup.readEntry("player", player.id);
      assert.equal(entry.facts.firstName, player.firstName);
      assert.equal(entry.facts.team, player.team);
      assert.equal(await store.identities.lookup.read("player", "nba", player.id), null);
    }
  });
}

test("an unchanged prepared write cannot overwrite a concurrent source change", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const id = await store.identities.lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "native-player",
  });
  const key = "seasons/2025";
  const original = {
    season: 2025,
    players: [{ id, firstName: "Example", lastName: "Player", team: "NYK" }],
  };
  await store.docs.write(key, original);
  const entered = createDeferred();
  const release = createDeferred();
  const publish = store.identities.publishDocument;
  let paused = false;
  store.identities.publishDocument = async (...args) => {
    if (!paused) {
      paused = true;
      entered.resolve(undefined);
      await release.promise;
    }
    return publish(...args);
  };
  const writing = store.docs.write(key, original);
  assert.equal(
    await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
    true,
    "The writer bypassed native publication",
  );
  const changed = { ...original, players: [{ ...original.players[0], team: "LAL" }] };
  await store.docs.write(key, changed);
  release.resolve(undefined);
  await writing;
  assert.deepEqual(stored.get(key), changed);
  assert.equal((await store.identities.lookup.readEntry("player", id)).facts.team, "LAL");
});

for (const replacement of ["delete", "empty", "missing"]) {
  test(`superseded preparation restores counts for ${replacement} source`, async () => {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    stored.set(IDENTITY_COVERAGE_KEY, "healthy-generation");
    await finishBackfill(store);
    const key = "seasons/2025";
    const original = {
      season: 2025,
      players: [{ id: "p_abandoned", firstName: "Old", lastName: "Player" }],
    };
    await store.docs.write(key, original);
    const update = store.identities.lookup.updateRegisteredFacts;
    const entered = createDeferred();
    const release = createDeferred();
    let paused = false;
    store.identities.lookup.updateRegisteredFacts = async (...args) => {
      if (!paused && args[1]?.partial) {
        paused = true;
        entered.resolve(undefined);
        await release.promise;
      }
      return update(...args);
    };
    const writing = store.docs.write(key, original);
    assert.equal(
      await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
      true,
    );
    const current = {
      season: 2025,
      players:
        replacement === "missing"
          ? [{ id: "p_current", firstName: "Current", lastName: "Player" }]
          : [],
    };
    if (replacement === "delete") await store.docs.remove(key);
    else await store.docs.write(key, current);
    release.resolve(undefined);
    await writing;
    assert.deepEqual(stored.get(key), replacement === "delete" ? undefined : current);
    const count = replacement === "missing" ? 1 : 0;
    assert.equal(
      stored.get(`${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`) ?? 0,
      count,
    );
    assert.equal((await store.identities.readStatus()).errors, count);
    await store.identities.lookup.save([
      {
        type: "player",
        vendor: "nba",
        vendorId: "native-current",
        internalId: replacement === "missing" ? "p_current" : "p_unrelated",
        evidence: { method: "discovery" },
      },
    ]);
    assert.equal(stored.get(IDENTITY_COVERAGE_KEY) === "healthy-generation", !count);
    await finishBackfill(store);
    assert.equal((await store.identities.readStatus()).checks.verified, true);
  });
}

test("superseded repair preserves a newer writer's vendor rejection through audits", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const id = await store.identities.lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "native-current",
  });
  stored.set(IDENTITY_COVERAGE_KEY, "healthy-generation");
  await finishBackfill(store);
  const key = "seasons/2025";
  const original = {
    season: 2025,
    players: [{ id: "p_abandoned", firstName: "Old", lastName: "Player" }],
  };
  await store.docs.write(key, original);
  const update = store.identities.lookup.updateRegisteredFacts;
  const entered = createDeferred();
  const release = createDeferred();
  let paused = false;
  store.identities.lookup.updateRegisteredFacts = async (...args) => {
    if (!paused && args[1]?.partial) {
      paused = true;
      entered.resolve(undefined);
      await release.promise;
    }
    return update(...args);
  };
  const writing = store.docs.write(key, original);
  assert.equal(
    await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
    true,
  );
  const player = { id, firstName: "Current", lastName: "Player" };
  await store.docs.write(key, {
    season: 2025,
    players: [{ ...player, espnIdentity: { id: null } }],
  });
  const current = structuredClone(stored.get(key));
  assert.equal((await store.identities.readStatus()).errors, 1);
  release.resolve(undefined);
  await writing;
  assert.deepEqual(stored.get(key), current);
  assert.equal((await store.identities.readStatus()).errors, 1);
  assert.equal(stored.has(`${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`), false);
  await store.identities.lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "unrelated-native",
  });
  assert.equal(stored.get(IDENTITY_COVERAGE_KEY), "healthy-generation");
  stored.set(IDENTITY_COVERAGE_KEY, "audit-retained-rejection");
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).errors, 1);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  await store.docs.write(key, { season: 2025, players: [player] });
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal(await readIdentitySourceRejections(ctx.storage, key), 0);
  await store.docs.write(key, {
    season: 2025,
    players: [{ ...player, espnIdentity: { id: null } }],
  });
  assert.equal(await readIdentitySourceRejections(ctx.storage, key), 1);
  await store.docs.remove(key);
  assert.equal(await readIdentitySourceRejections(ctx.storage, key), 0);
  assert.equal((await store.identities.readStatus()).errors, 0);
});

test("opaque backfill retains vendor rejections while sanitizing older stored sources", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const id = await store.identities.lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "native-current",
  });
  const key = "seasons/2025";
  stored.set(key, {
    season: 2025,
    players: [{ id, firstName: "Current", lastName: "Player", espnIdentity: { id: null } }],
  });
  await finishBackfill(store);
  assert.equal(stored.get(key).players[0].espnIdentity, undefined);
  assert.equal(await readIdentitySourceRejections(ctx.storage, key), 1);
  assert.equal((await store.identities.readStatus()).errors, 1);
  stored.set(IDENTITY_COVERAGE_KEY, "recheck-sanitized-source");
  await finishBackfill(store);
  assert.equal((await store.identities.readStatus()).errors, 1);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
});

test("failed superseded repair preserves the newer source and schedules normal recovery", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const store = createStore(ctx);
  const id = await store.identities.lookup.discover({
    type: "player",
    vendor: "nba",
    vendorId: "native-current",
  });
  await finishBackfill(store);
  const key = "seasons/2025";
  const original = {
    season: 2025,
    players: [{ id: "p_abandoned", firstName: "Old", lastName: "Player" }],
  };
  await store.docs.write(key, original);
  const update = store.identities.lookup.updateRegisteredFacts;
  const entered = createDeferred();
  const release = createDeferred();
  let paused = false;
  store.identities.lookup.updateRegisteredFacts = async (...args) => {
    if (!paused && args[1]?.partial) {
      paused = true;
      entered.resolve(undefined);
      await release.promise;
    }
    return update(...args);
  };
  const writing = store.docs.write(key, original);
  assert.equal(
    await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
    true,
  );
  const current = { season: 2025, players: [{ id, firstName: "Current", lastName: "Player" }] };
  await store.docs.write(key, current);
  const transaction = ctx.storage.transaction;
  let unavailable = true;
  ctx.storage.transaction = (change) =>
    transaction((inner) =>
      change({
        ...inner,
        get: async (asked) => {
          if (unavailable && asked === `identity:entity:nba:player:${id}`)
            throw new Error("Identity ledger unavailable");
          return inner.get(asked);
        },
      }),
    );
  release.resolve(undefined);
  await writing;
  assert.deepEqual(stored.get(key), current);
  assert.equal(stored.get(`${IDENTITY_ERROR_PREFIX}failed:${encodeURIComponent(key)}`), 1);
  assert.equal((await store.identities.readStatus()).checks.verified, false);
  unavailable = false;
  for (let step = 0; step < 100; step++) {
    await store.identities.backfill(store.docs);
    if ((await store.identities.readStatus()).checks.verified) break;
  }
  assert.equal((await store.identities.readStatus()).checks.verified, true);
  assert.equal((await store.identities.readStatus()).errors, 0);
  assert.deepEqual(stored.get(key), current);
});

test("game registration while publication waits invalidates a completed missing-season audit", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    await finishBackfill(store);
    const game = createGame("g_later");
    const { season: _season, ...withoutSeason } = game;
    await store.docs.write(`games/${game.id}`, withoutSeason);
    const key = cached ? "job:details:detail-answer:/season?season=2026" : "seasons/2026";
    const publish = store.identities.publishDocument;
    const entered = createDeferred();
    const release = createDeferred();
    store.identities.publishDocument = async (...args) => {
      if (args[0] === key) {
        entered.resolve(undefined);
        await release.promise;
      }
      return publish(...args);
    };
    const document = { season: 2026, games: [game] };
    const writing = cached
      ? store
          .createJobStorage("details")
          .put("detail-answer:/season?season=2026", { body: document })
      : store.docs.write(key, document);
    assert.equal(
      await Promise.race([entered.promise.then(() => true), writing.then(() => false)]),
      true,
    );
    await store.identities.lookup.save([
      {
        type: "game",
        vendor: "nba",
        vendorId: "native-later-game",
        internalId: game.id,
        evidence: { method: "discovery" },
      },
    ]);
    await finishBackfill(store);
    assert.ok((await store.identities.readStatus()).checks.missingFacts > 0);
    const revision = stored.get(IDENTITY_COVERAGE_KEY);
    const transaction = ctx.storage.transaction;
    const writeGroups = [];
    ctx.storage.transaction = (change) =>
      transaction((inner) => {
        const writes = [];
        writeGroups.push(writes);
        return change({
          ...inner,
          put: async (asked, value) => {
            writes.push(asked);
            return inner.put(asked, value);
          },
        });
      });
    release.resolve(undefined);
    await writing;
    assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), revision);
    assert.ok(
      writeGroups.some((writes) => writes.includes(key) && writes.includes(IDENTITY_COVERAGE_KEY)),
    );
    await finishBackfill(store);
    assert.equal((await store.identities.readStatus()).checks.verified, true);
    assert.equal((await store.identities.lookup.readEntry("game", game.id)).facts.season, 2026);
    assert.equal(await store.identities.lookup.read("game", "nba", game.id), null);
  }
});

test("failed atomic identity publication preserves sports data and reports uncertainty", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    const sourceKey = cached ? "job:details:detail-answer:/players?season=2025" : "seasons/2025";
    const write = (document) =>
      cached
        ? store
            .createJobStorage("details")
            .put("detail-answer:/players?season=2025", { body: document })
        : store.docs.write(sourceKey, document);
    const id = await store.identities.lookup.discover({
      type: "player",
      vendor: "nba",
      vendorId: "native-player",
    });
    await finishBackfill(store);
    const transaction = ctx.storage.transaction;
    let failed = false;
    let publishedTogether = false;
    ctx.storage.transaction = (change) =>
      transaction((inner) =>
        change({
          ...inner,
          get: async (key) => {
            if (key === sourceKey && !failed) {
              failed = true;
              throw new Error("Identity ledger unavailable");
            }
            return inner.get(key);
          },
          put: async (key, value) => {
            if (key === sourceKey) {
              assert.equal(
                await inner.get(`${IDENTITY_ERROR_PREFIX}failed:${encodeURIComponent(sourceKey)}`),
                1,
              );
              publishedTogether = true;
            }
            return inner.put(key, value);
          },
        }),
      );
    const document = {
      season: 2025,
      players: [{ id, firstName: "Example", lastName: "Player" }],
    };
    await write(document);
    assert.equal(failed, true);
    assert.equal(publishedTogether, true);
    assert.deepEqual(cached ? stored.get(sourceKey).body : stored.get(sourceKey), document);
    assert.equal((await store.identities.readStatus()).checks.verified, false);
    assert.ok((await store.identities.readStatus()).errors > 0);
    assert.equal(await store.identities.lookup.read("player", "nba", id), null);
  }
});

test("failed fallback evidence cannot replace the earlier usable document", async () => {
  for (const cached of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const store = createStore(ctx);
    const sourceKey = cached ? "job:details:detail-answer:/players?season=2025" : "seasons/2025";
    const write = (document) =>
      cached
        ? store
            .createJobStorage("details")
            .put("detail-answer:/players?season=2025", { body: document })
        : store.docs.write(sourceKey, document);
    stored.set(IDENTITY_COVERAGE_KEY, "missing-native-demand");
    await finishBackfill(store);
    const original = {
      season: 2025,
      players: [{ id: "p_missing", firstName: "Missing", lastName: "Player" }],
    };
    await write(original);
    const transaction = ctx.storage.transaction;
    let failed = false;
    ctx.storage.transaction = (change) =>
      transaction((inner) =>
        change({
          ...inner,
          get: async (asked) => {
            if (asked === sourceKey && !failed) {
              failed = true;
              throw new Error("Primary publication unavailable");
            }
            return inner.get(asked);
          },
          put: async (asked, value) => {
            if (asked.startsWith(`${IDENTITY_ERROR_PREFIX}failed:`))
              throw new Error("Failure evidence unavailable");
            return inner.put(asked, value);
          },
        }),
      );
    await assert.rejects(
      write({
        season: 2025,
        players: [],
      }),
      /Failure evidence unavailable/,
    );
    assert.deepEqual(cached ? stored.get(sourceKey).body : stored.get(sourceKey), original);
    assert.equal(stored.get(`${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(sourceKey)}`), 1);
    assert.equal((await store.identities.readStatus()).errors, 1);
    await store.identities.lookup.save([
      {
        type: "player",
        vendor: "nba",
        vendorId: "native-missing",
        internalId: "p_missing",
        evidence: { method: "discovery" },
      },
    ]);
    assert.notEqual(stored.get(IDENTITY_COVERAGE_KEY), "missing-native-demand");
  }
});

test("registration checks honor complete and partial source-count replacement", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const lookup = createStore(ctx).identities.lookup;
  const id = await lookup.discover({ type: "player", vendor: "nba", vendorId: "native-player" });
  const key = "seasons/2025";
  const marker = `${IDENTITY_UNREGISTERED_PREFIX}${encodeURIComponent(key)}`;
  stored.set(marker, 2);
  stored.set(`${IDENTITY_ERROR_PREFIX}rejected:${encodeURIComponent(key)}`, 2);
  await lookup.recordRegistrationCheck("player", "nba", id, { key, rejected: 0, partial: true });
  assert.equal(stored.get(marker), 2);
  await lookup.recordRegistrationCheck("player", "nba", id, { key, rejected: 0, partial: false });
  assert.equal(stored.has(marker), false);
  assert.equal((await createStore(ctx).identities.readStatus()).errors, 0);
});

test("coverage demand sees rejection inserts and deletions within the registration transaction", async () => {
  for (const inserting of [false, true]) {
    const { ctx, stored } = createDurableObjectContext();
    const lookup = createStore(ctx).identities.lookup;
    const key = `${IDENTITY_UNREGISTERED_PREFIX}players`;
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
