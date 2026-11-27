import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { createDeferred } from "../../../tests/deferred.js";
import { createBrowserKeys, readPushMessage } from "../../../tests/push-reader.js";
import { readIdentityGames } from "../../../shared/worker/espn-adapter.js";
import { buildSnapshot, listReminderGames } from "../worker/src/adapters/wnba.js";
import { nameEspnMatchKey } from "../worker/src/adapters/lead.js";
import { SeasonStore } from "../worker/src/store.js";
import { findTeamCodeByEspnId } from "../page/js/teams.js";
import { ESPN } from "./espn-fixtures.js";

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
);
const GAME_ID = "1042600132";
const SEASON_KEY = "seasons/2026";
const PUSH_ENDPOINT = "https://web.push.apple.com/wnba-fixture";

async function createLegacyPublishingStore() {
  const { ctx } = createDurableObjectContext();
  const clock = { now: Date.parse(FIXTURE.now) };
  const answers = Object.values(ESPN.answers);
  const snapshot = {
    ...buildSnapshot(FIXTURE.responses, { season: 2026, now: clock.now }),
    identityRecords: readIdentityGames(answers, findTeamCodeByEspnId),
  };
  const backup = buildSnapshot(
    { ...FIXTURE.responses, scoreboard: null, backup: { answers } },
    { season: 2026, now: clock.now },
  );
  const sent = [];
  const upstream = { snapshot, failVerification: false, reads: [] };
  const store = new SeasonStore(
    ctx,
    {},
    {
      now: () => clock.now,
      createLoadSnapshot:
        () =>
        async (season, { verify = false } = {}) => {
          upstream.reads.push({ season, verify });
          if (verify && upstream.failVerification)
            throw new Error("Fixture verification unavailable");
          return upstream.snapshot;
        },
      fetchImpl: async (input, init) => {
        assert.equal(String(input), PUSH_ENDPOINT, "No vendor reads belong to this fixture");
        sent.push(init.body);
        return new Response(null, { status: 201 });
      },
    },
  );
  await store.saveSeason(snapshot);
  const lookup = store.identities.lookup;
  const match = await store.docs.read(nameEspnMatchKey(GAME_ID));
  assert.ok(match);
  const guard = await lookup.readEligible("game", "espn", match.eventId);
  assert.ok(guard);
  const previous = await store.docs.read(SEASON_KEY);
  const updatedGame = backup.games.find((game) => game.id === GAME_ID);
  assert.equal(previous.games.find((game) => game.id === GAME_ID).state, "pre");
  assert.equal(updatedGame.state, "final");
  const candidate = {
    ...previous,
    games: previous.games.map((game) => (game.id === GAME_ID ? updatedGame : game)),
  };
  const association = {
    type: "game",
    vendor: "espn",
    vendorId: match.eventId,
    internalId: GAME_ID,
    evidence: { method: "existing-id" },
  };
  return {
    clock,
    ctx,
    upstream,
    store,
    lookup,
    snapshot,
    guard,
    previous,
    candidate,
    association,
    sent,
  };
}

test("guarded WNBA season publication retains the document through quarantine and old-token restoration", async () => {
  const { store, lookup, guard, previous, candidate, association } =
    await createLegacyPublishingStore();
  await lookup.save([{ ...association, disputed: true }]);
  assert.equal(
    await store.docs.replaceIfUnchanged(SEASON_KEY, previous, candidate, {
      identityGuards: [guard],
    }),
    false,
  );
  assert.deepEqual(await store.docs.read(SEASON_KEY), previous);
  await lookup.save([{ ...association, decisive: true }]);
  assert.equal(
    await store.docs.replaceIfUnchanged(SEASON_KEY, previous, candidate, {
      identityGuards: [guard],
    }),
    false,
  );
  const restored = await lookup.readEligible("game", association.vendor, association.vendorId);
  assert.equal(
    await store.docs.replaceIfUnchanged(SEASON_KEY, previous, candidate, {
      identityGuards: [restored],
    }),
    true,
  );
  const published = await store.docs.read(SEASON_KEY);
  assert.deepEqual(published, candidate);
  assert.deepEqual(published.standings, previous.standings);
  assert.deepEqual(
    published.games.filter((game) => game.id !== GAME_ID),
    previous.games.filter((game) => game.id !== GAME_ID),
  );
});

test("a WNBA association revoked while a canonical write waits cannot publish its old decision", async () => {
  const { store, lookup, guard, previous, candidate, association } =
    await createLegacyPublishingStore();
  const release = createDeferred();
  store.docUpdates.set(SEASON_KEY, release.promise);
  const publishing = store.docs.replaceIfUnchanged(SEASON_KEY, previous, candidate, {
    identityGuards: [guard],
  });
  try {
    await lookup.save([{ ...association, disputed: true }]);
  } finally {
    release.resolve(undefined);
  }
  assert.equal(await publishing, false);
  assert.deepEqual(await store.docs.read(SEASON_KEY), previous);
});

// These guards originate on the adapter snapshot. The real league selector and store writer
// must carry them into internal reminder facts; no test calls reminders.saveGames directly.
function addSourceGuards(snapshot, identityGuards) {
  const guardedGames = (games) =>
    games.map((game) => (game.id === GAME_ID ? { ...game, identityGuards } : game));
  return {
    ...snapshot,
    games: guardedGames(snapshot.games),
    nearestGames: guardedGames(snapshot.nearestGames),
    schedule: guardedGames(snapshot.schedule),
  };
}

async function subscribe(store) {
  const keys = await createBrowserKeys();
  const response = await store.push.serveRequest(
    new Request("https://wnba.example/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: PUSH_ENDPOINT,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        preferences: {
          updates: false,
          reminders: true,
          minutes: 60,
          timeZone: "America/New_York",
        },
      }),
    }),
    "/push/subscription",
  );
  assert.equal(response.status, 204);
  return keys;
}

async function readReceipt(store) {
  const device = [...(await store.push.listSubscriptions()).values()][0];
  return device.reminderReceipts[GAME_ID];
}

async function prepareGuardedReminders() {
  const fixture = await createLegacyPublishingStore();
  const { store, lookup, snapshot, guard, upstream } = fixture;
  const native = await lookup.readEligible("game", "wnba", GAME_ID);
  assert.ok(native);
  const guards = [native, guard];
  upstream.snapshot = addSourceGuards(snapshot, guards);
  await store.updateSeason();
  const keys = await subscribe(store);
  await store.updateSeason();
  const candidate = listReminderGames(upstream.snapshot).find((game) => game.id === GAME_ID);
  assert.ok("identityGuards" in candidate);
  assert.deepEqual(candidate.identityGuards, guards);
  fixture.clock.now = candidate.start - 60 * 60_000;
  return { ...fixture, keys, guards };
}

test("the WNBA writer keeps source guards in reminder facts and out of page documents", async () => {
  const { ctx, store, guards, snapshot, upstream } = await prepareGuardedReminders();
  await store.verifyReminderGames();
  const facts = await ctx.storage.get("push:reminder-games");
  assert.deepEqual(facts.games.find((game) => game.id === GAME_ID).identityGuards, guards);
  assert.ok(Number.isFinite(facts.verifiedAt));
  for (const key of [SEASON_KEY, "schedules/2026"]) {
    const doc = await store.docs.read(key);
    assert.ok(doc, key);
    assert.doesNotMatch(JSON.stringify(doc), /identityGuards|associationToken/);
  }
  assert.ok(upstream.reads.some((read) => read.verify));
  assert.ok(upstream.reads.some((read) => !read.verify));
  const legacy = listReminderGames(snapshot);
  assert.ok(legacy.length);
  assert.ok(legacy.every((game) => !Object.hasOwn(game, "identityGuards")));
});

for (const vendor of ["wnba", "espn"]) {
  test(`a disputed ${vendor.toUpperCase()} association blocks the WNBA claim until a fresh restored guard arrives`, async () => {
    const { store, lookup, upstream, snapshot, sent, keys, guards } =
      await prepareGuardedReminders();
    const guard = guards.find((candidate) => candidate.vendor === vendor);
    const association = {
      type: "game",
      vendor,
      vendorId: guard.vendorId,
      internalId: guard.internalId,
      evidence: { method: "existing-id" },
    };
    await store.verifyReminderGames();
    const updateDevice = store.push.updateDevice;
    let disputedAtClaim = 0;
    store.push.updateDevice = async (...args) => {
      if (args[3] && !disputedAtClaim) {
        disputedAtClaim += 1;
        await lookup.save([{ ...association, disputed: true }]);
      }
      return updateDevice(...args);
    };
    await store.reminders.checkDue();
    assert.equal(disputedAtClaim, 1);
    assert.equal(sent.length, 0);
    assert.equal((await readReceipt(store)).attempts, 0);
    assert.equal(await lookup.readEligible("game", association.vendor, association.vendorId), null);

    // Ordinary ingestion must not reconcile a disputed association through agreeing evidence.
    await store.updateSeason();
    assert.equal(await lookup.readEligible("game", association.vendor, association.vendorId), null);
    await store.reminders.checkDue();
    assert.equal(sent.length, 0);
    assert.equal((await readReceipt(store)).attempts, 0);

    await lookup.save([{ ...association, decisive: true }]);
    const restored = await lookup.readEligible("game", association.vendor, association.vendorId);
    assert.equal(restored.internalId, guard.internalId);
    assert.notEqual(restored.associationToken, guard.associationToken);
    await store.verifyReminderGames();
    await store.reminders.checkDue();
    assert.equal(sent.length, 0, "A fresh read carrying the old token still cannot claim");
    assert.equal((await readReceipt(store)).attempts, 0);

    upstream.snapshot = addSourceGuards(
      snapshot,
      await Promise.all(
        guards.map((candidate) =>
          lookup.readEligible("game", candidate.vendor, candidate.vendorId),
        ),
      ),
    );
    await store.verifyReminderGames();
    const verifiedReads = upstream.reads.filter((read) => read.verify).length;
    await Promise.all([store.reminders.checkDue(), store.reminders.checkDue()]);
    assert.equal(sent.length, 1);
    assert.equal(upstream.reads.filter((read) => read.verify).length, verifiedReads);
    const receipt = await readReceipt(store);
    assert.equal(receipt.state, "sent");
    assert.equal(receipt.attempts, 1);
    const payload = await readPushMessage(sent[0], keys);
    assert.equal(payload.game, GAME_ID);
    assert.doesNotMatch(JSON.stringify(payload), /identityGuards|associationToken/);
  });
}

test("failed WNBA fresh verification retains guarded facts without spending a send attempt", async () => {
  const { ctx, store, upstream, sent, guards } = await prepareGuardedReminders();
  upstream.failVerification = true;
  await store.reminders.checkDue();
  let facts = await ctx.storage.get("push:reminder-games");
  assert.equal(facts.verifiedAt, null);
  assert.deepEqual(facts.games.find((game) => game.id === GAME_ID).identityGuards, guards);
  assert.equal(sent.length, 0);
  assert.equal((await readReceipt(store)).attempts, 0);
  upstream.failVerification = false;
  await store.reminders.checkDue();
  facts = await ctx.storage.get("push:reminder-games");
  assert.ok(Number.isFinite(facts.verifiedAt));
  assert.equal(sent.length, 1);
});

for (const identityGuards of [[], null]) {
  test(`an explicit ${JSON.stringify(identityGuards)} WNBA guard survives selection and fails closed`, async () => {
    const { ctx, store, upstream, snapshot, sent } = await prepareGuardedReminders();
    upstream.snapshot = addSourceGuards(snapshot, identityGuards);
    await store.verifyReminderGames();
    const facts = await ctx.storage.get("push:reminder-games");
    assert.deepEqual(
      facts.games.find((game) => game.id === GAME_ID).identityGuards,
      identityGuards,
    );
    await store.reminders.checkDue();
    assert.equal(sent.length, 0);
    assert.equal((await readReceipt(store)).attempts, 0);
  });
}
