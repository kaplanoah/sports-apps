import test from "node:test";
import assert from "node:assert/strict";
import { createGameReminders, describeGameReminder } from "../shared/worker/game-reminders.js";
import { createPushService } from "../shared/worker/push.js";
import {
  isNotificationPreferences,
  REMINDER_PRESETS,
} from "../shared/page/notification-preferences.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { createBrowserKeys, readPushMessage } from "./push-reader.js";

const NOW = Date.parse("2026-10-25T20:00:00Z");
const GAME = {
  id: "123",
  season: 2026,
  away: "Dodgers",
  home: "Yankees",
  start: NOW + 2 * 60 * 60_000,
  networks: ["FOX"],
};
const PREFERENCES = { updates: false, reminders: true, minutes: 60, timeZone: "America/New_York" };

function createHarness() {
  const { ctx, stored } = createDurableObjectContext();
  const clock = { now: NOW };
  const sent = [];
  const upstream = { games: [GAME], status: 201, throws: false, reads: 0 };
  const push = createPushService({
    storage: ctx.storage,
    now: () => clock.now,
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      if (upstream.throws) throw new Error("Response lost");
      return new Response(null, { status: upstream.status });
    },
  });
  const reminders = createGameReminders({
    storage: ctx.storage,
    push,
    now: () => clock.now,
    verify: async () => {
      upstream.reads++;
      await reminders.saveGames(upstream.games, true);
    },
  });
  const request = (method, path, body) =>
    push.serveRequest(
      new Request(`https://app.example/push/${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      `/push/${path}`,
    );
  async function subscribe(preferences = PREFERENCES, name = "one") {
    const keys = await createBrowserKeys();
    const subscription = {
      endpoint: `https://web.push.apple.com/${name}`,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    };
    assert.equal(
      (await request("PUT", "subscription", { ...subscription, preferences })).status,
      204,
    );
    return { subscription, keys };
  }
  return { ctx, stored, clock, sent, upstream, push, reminders, request, subscribe };
}

test("only the five approved presets, booleans and real time zones are accepted", () => {
  assert.ok(isNotificationPreferences({ ...PREFERENCES, timeZone: "Etc/GMT+5" }));
  for (const { minutes } of REMINDER_PRESETS)
    assert.ok(isNotificationPreferences({ ...PREFERENCES, minutes }));
  for (const invalid of [
    { minutes: "15" },
    { minutes: -1 },
    { minutes: 16 },
    { updates: 1 },
    { reminders: null },
    { timeZone: "Mars/Base" },
    { timeZone: "+0500" },
  ])
    assert.equal(isNotificationPreferences({ ...PREFERENCES, ...invalid }), false);
});

test("reminder wording uses the device zone at the game's instant, including DST", () => {
  assert.equal(
    describeGameReminder(GAME, PREFERENCES).title,
    "Dodgers @ Yankees starting at 6:00 PM EDT on FOX",
  );
  assert.equal(
    describeGameReminder({ ...GAME, start: Date.parse("2026-11-02T23:00:00Z") }, PREFERENCES).title,
    "Dodgers @ Yankees starting at 6:00 PM EST on FOX",
  );
  assert.equal(
    describeGameReminder(GAME, { ...PREFERENCES, minutes: 0 }).title,
    "Dodgers @ Yankees starting now on FOX",
  );
  assert.equal(
    describeGameReminder({ ...GAME, networks: [] }, PREFERENCES).title,
    "Dodgers @ Yankees starting at 6:00 PM EDT network not announced",
  );
});

test("legacy subscriptions migrate with updates on and reminders off; repeat PUT preserves metadata", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe(undefined);
  const [key, device] = [...(await harness.push.listSubscriptions())][0];
  delete device.preferences;
  device.failingSince = NOW - 100;
  device.reminderReceipts = { 123: { state: "sent", dueAt: NOW } };
  await harness.ctx.storage.put(key, device);
  await harness.request("PUT", "subscription", subscription);
  const kept = await harness.ctx.storage.get(key);
  assert.equal(kept.preferences.updates, true);
  assert.equal(kept.preferences.reminders, false);
  assert.equal(kept.failingSince, NOW - 100);
  assert.equal(kept.reminderReceipts["123"].state, "sent");
});

test("device writes reject stale revisions and invalid preferences and never expose other devices", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const changed = { ...PREFERENCES, minutes: 30, updates: true };
  assert.equal(
    (
      await harness.request("PUT", "preferences", {
        ...subscription,
        preferences: changed,
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await harness.request("PUT", "preferences", {
        ...subscription,
        preferences: PREFERENCES,
        revision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await harness.request("PUT", "preferences", {
        ...subscription,
        preferences: { ...changed, minutes: 20 },
        revision: 1,
      })
    ).status,
    400,
  );
  const response = await (await harness.request("POST", "preferences", subscription)).json();
  assert.deepEqual(response, { preferences: changed, revision: 1 });
  assert.equal(
    (
      await harness.request("POST", "preferences", {
        ...subscription,
        keys: { ...subscription.keys, auth: "AAAA" },
      })
    ).status,
    400,
  );
});

test("endpoint replacement transfers flags, revision, failures and sent receipts", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const [key, device] = [...(await harness.push.listSubscriptions())][0];
  await harness.ctx.storage.put(key, {
    ...device,
    revision: 4,
    failingSince: NOW,
    reminderReceipts: { 123: { state: "sent", dueAt: NOW } },
  });
  const replacement = { ...subscription, endpoint: "https://web.push.apple.com/two" };
  assert.equal(
    (
      await harness.request("PUT", "subscription", {
        ...replacement,
        previousSubscription: subscription,
      })
    ).status,
    204,
  );
  const devices = await harness.push.listSubscriptions();
  assert.equal(devices.size, 1);
  const [kept] = devices.values();
  assert.deepEqual(kept.preferences, PREFERENCES);
  assert.equal(kept.revision, 4);
  assert.equal(kept.failingSince, NOW);
  assert.equal(kept.reminderReceipts["123"].state, "sent");
});

test("device leads have independent persisted deadlines and share verification", async () => {
  const harness = createHarness();
  const first = await harness.subscribe();
  await harness.subscribe({ ...PREFERENCES, minutes: 30 }, "two");
  await harness.subscribe(PREFERENCES, "three");
  await harness.reminders.saveGames([GAME]);
  assert.equal(await harness.reminders.findNextDeadline(), GAME.start - 60 * 60_000 - 30_000);
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.upstream.reads, 1);
  assert.equal(harness.sent.length, 2);
  const message = await readPushMessage(
    harness.sent.find(({ url }) => url === first.subscription.endpoint).init.body,
    first.keys,
  );
  assert.equal(message.game, GAME.id);
  assert.equal(message.tag, "game-reminder:123");
  assert.equal(harness.sent[0].init.headers.ttl, "120");
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 2);
  harness.clock.now = GAME.start - 30 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 3);
});

test("failed source verification retains pending games but cannot send stale facts", async () => {
  const harness = createHarness();
  await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.upstream.games = null;
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 0);
  assert.ok(Number.isFinite(await harness.reminders.findNextDeadline()));
  harness.upstream.games = [GAME];
  harness.clock.now += 30_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].init.headers.ttl, "90");
});

test("a verified missing or ineligible game cancels a pending reminder", async () => {
  const harness = createHarness();
  await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.upstream.games = [];
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 0);
  assert.equal(await harness.reminders.findNextDeadline(), Infinity);
});

test("rescheduling moves unsent deadlines, while sent receipts survive game and lead changes", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  const moved = { ...GAME, start: GAME.start + 60 * 60_000 };
  harness.upstream.games = [moved];
  await harness.reminders.saveGames([moved]);
  assert.equal(await harness.reminders.findNextDeadline(), moved.start - 60 * 60_000 - 30_000);
  harness.clock.now = moved.start - 60 * 60_000;
  await harness.reminders.checkDue();
  await harness.request("PUT", "preferences", {
    ...subscription,
    preferences: { ...PREFERENCES, minutes: 15 },
    revision: 0,
  });
  const movedAgain = { ...moved, start: moved.start + 60 * 60_000 };
  harness.upstream.games = [movedAgain];
  await harness.reminders.saveGames([movedAgain]);
  const [kept] = (await harness.push.listSubscriptions()).values();
  assert.equal(kept.reminderReceipts[GAME.id].state, "sent");
  assert.equal(await harness.reminders.findNextDeadline(), Infinity);
  harness.clock.now = movedAgain.start - 15 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 1);
});

test("opting in or changing a lead past its deadline never bursts old reminders", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe({
    ...PREFERENCES,
    reminders: false,
    minutes: 15,
  });
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start - 60 * 60_000 + 30_000;
  await harness.request("PUT", "preferences", {
    ...subscription,
    preferences: PREFERENCES,
    revision: 0,
  });
  await harness.reminders.refreshDevices();
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 0);
  assert.equal(await harness.reminders.findNextDeadline(), Infinity);
});

test("transient failures retry within the lifetime, and a lost response retains the stable tag", async () => {
  const harness = createHarness();
  const { keys } = await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start - 60 * 60_000;
  harness.upstream.throws = true;
  await harness.reminders.checkDue();
  harness.clock.now += 15_000;
  harness.upstream.throws = false;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 2);
  const messages = await Promise.all(
    harness.sent.map(({ init }) => readPushMessage(init.body, keys)),
  );
  assert.equal(messages[0].tag, messages[1].tag);
  harness.clock.now += 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 2);
});

test("permanent endpoints are removed; updates and reminders are independent", async () => {
  const harness = createHarness();
  await harness.subscribe();
  await harness.push.sendToAll([{ title: "Final", tag: "final" }]);
  assert.equal(harness.sent.length, 0);
  await harness.reminders.saveGames([GAME]);
  harness.upstream.status = 410;
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  assert.equal((await harness.push.listSubscriptions()).size, 0);
});

test("At start expires after a minute and other reminders expire before the scheduled start", async () => {
  const harness = createHarness();
  await harness.subscribe({ ...PREFERENCES, minutes: 0 });
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start;
  harness.upstream.status = 503;
  await harness.reminders.checkDue();
  assert.equal(harness.sent[0].init.headers.ttl, "60");
  harness.clock.now += 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 1);
  assert.equal(await harness.reminders.findNextDeadline(), Infinity);
});

test("an explicit opt-out and later endpoint re-subscription retain sent game receipts", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  await harness.request("DELETE", "subscription", subscription);
  const replacement = { ...subscription, endpoint: "https://web.push.apple.com/return" };
  await harness.request("PUT", "subscription", {
    ...replacement,
    previousSubscription: subscription,
  });
  const [kept] = (await harness.push.listSubscriptions()).values();
  assert.equal(kept.preferences.reminders, true);
  assert.equal(kept.reminderReceipts[GAME.id].state, "sent");
  await harness.reminders.saveGames([{ ...GAME, start: GAME.start + 60 * 60_000 }]);
  harness.clock.now += 60 * 60_000;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 1);
});

test("concurrent preference edits accept one revision and reject the stale writer", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const changes = await Promise.all(
    [15, 30].map((minutes) =>
      harness.request("PUT", "preferences", {
        ...subscription,
        preferences: { ...PREFERENCES, minutes },
        revision: 0,
      }),
    ),
  );
  assert.deepEqual(changes.map((response) => response.status).sort(), [200, 409]);
});

test("returning from an opt-out still respects the hundred-device limit", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  await harness.request("DELETE", "subscription", subscription);
  for (let index = 0; index < 100; index++) {
    const response = await harness.request("PUT", "subscription", {
      ...subscription,
      endpoint: `https://web.push.apple.com/full-${index}`,
    });
    assert.equal(response.status, 204);
  }
  const response = await harness.request("PUT", "subscription", {
    ...subscription,
    endpoint: "https://web.push.apple.com/return",
    previousSubscription: subscription,
  });
  assert.equal(response.status, 429);
  assert.equal((await harness.push.listSubscriptions()).size, 100);
});

test("rescheduling an uncertain delivery cannot reset its attempts or issue a new pregame reminder", async () => {
  const harness = createHarness();
  await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start - 60 * 60_000;
  harness.upstream.throws = true;
  await harness.reminders.checkDue();
  const moved = { ...GAME, start: GAME.start + 60 * 60_000 };
  harness.upstream.games = [moved];
  await harness.reminders.saveGames([moved]);
  const [device] = (await harness.push.listSubscriptions()).values();
  assert.equal(device.reminderReceipts[GAME.id].state, "expired");
  assert.equal(device.reminderReceipts[GAME.id].attempts, 1);
  harness.clock.now += 60 * 60_000;
  harness.upstream.throws = false;
  await harness.reminders.checkDue();
  assert.equal(harness.sent.length, 1);
});
