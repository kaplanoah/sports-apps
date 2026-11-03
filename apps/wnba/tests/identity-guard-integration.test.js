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
  const store = new SeasonStore(
    ctx,
    {},
    {
      now: () => clock.now,
      createLoadSnapshot: () => async () => snapshot,
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
  const restored = await lookup.readEligible("game", "espn", association.vendorId);
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

test("a guarded WNBA reminder needs a restored token and current confirmation before claiming a send", async () => {
  const { clock, store, lookup, snapshot, guard, association, sent } =
    await createLegacyPublishingStore();
  const keys = await createBrowserKeys();
  const subscription = {
    endpoint: PUSH_ENDPOINT,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    preferences: {
      updates: false,
      reminders: true,
      minutes: 60,
      timeZone: "America/New_York",
    },
  };
  const response = await store.push.serveRequest(
    new Request("https://wnba.example/push/subscription", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription),
    }),
    "/push/subscription",
  );
  assert.equal(response.status, 204);
  const candidate = listReminderGames(snapshot).find((game) => game.id === GAME_ID);
  assert.ok(candidate);
  const guarded = { ...candidate, identityGuards: [guard] };
  await store.reminders.saveGames([guarded]);
  clock.now = candidate.start - 60 * 60_000;
  await store.reminders.saveGames([guarded], true);
  await lookup.save([{ ...association, disputed: true }]);
  await store.reminders.checkDue();
  assert.equal(sent.length, 0);
  let device = [...(await store.push.listSubscriptions()).values()][0];
  assert.equal(device.reminderReceipts[GAME_ID].attempts, 0);
  await lookup.save([{ ...association, decisive: true }]);
  await store.reminders.checkDue();
  assert.equal(sent.length, 0);
  const restored = await lookup.readEligible("game", "espn", association.vendorId);
  const confirmed = { ...candidate, identityGuards: [restored] };
  await store.reminders.saveGames([confirmed]);
  let verifications = 0;
  store.verifyReminderGames = async () => {
    verifications += 1;
    await store.reminders.saveGames(null);
  };
  await store.reminders.checkDue();
  assert.equal(verifications, 1);
  assert.equal(sent.length, 0);
  device = [...(await store.push.listSubscriptions()).values()][0];
  assert.equal(device.reminderReceipts[GAME_ID].attempts, 0);
  await store.reminders.saveGames([confirmed], true);
  await store.reminders.checkDue();
  assert.equal(sent.length, 1);
  device = [...(await store.push.listSubscriptions()).values()][0];
  assert.equal(device.reminderReceipts[GAME_ID].state, "sent");
  const payload = await readPushMessage(sent[0], keys);
  assert.equal(payload.game, GAME_ID);
  assert.doesNotMatch(JSON.stringify(payload), /identityGuards|associationToken/);
});
