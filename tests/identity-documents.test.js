import test from "node:test";
import assert from "node:assert/strict";
import { createSeasonStore } from "../shared/worker/season-store.js";
import { createIdentityLookup, nameIdentityCandidatePrefix } from "../shared/worker/identity.js";
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
const createStore = (ctx) => new Store(ctx, {}, OPTIONS);
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
