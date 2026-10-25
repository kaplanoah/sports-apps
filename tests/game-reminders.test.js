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
  const upstream = {
    games: [GAME],
    status: 201,
    throws: false,
    reads: 0,
    onSend: /** @type {null | (() => Promise<void>)} */ (null),
  };
  const push = createPushService({
    storage: ctx.storage,
    now: () => clock.now,
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      if (upstream.onSend) await upstream.onSend();
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

test("turning updates off while reminders stay on stops the remaining update batch", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe({ ...PREFERENCES, updates: true });
  harness.upstream.onSend = async () => {
    harness.upstream.onSend = null;
    await harness.request("PUT", "preferences", {
      ...subscription,
      preferences: PREFERENCES,
      revision: 0,
    });
  };
  await harness.push.sendToAll([{ title: "First update" }, { title: "Second update" }]);
  assert.equal(harness.sent.length, 1);
  const [device] = (await harness.push.listSubscriptions()).values();
  assert.equal(device.preferences.reminders, true);
});

test("an unsent reminder skipped after its deadline can follow a later start or future lead deadline", async () => {
  for (const change of ["start", "lead"]) {
    const harness = createHarness();
    const { subscription } = await harness.subscribe();
    harness.clock.now = GAME.start - 60 * 60_000 + 30_000;
    await harness.reminders.saveGames([GAME]);
    assert.equal(await harness.reminders.findNextDeadline(), Infinity);
    const game = change === "start" ? { ...GAME, start: GAME.start + 60 * 60_000 } : GAME;
    const minutes = change === "lead" ? 15 : 60;
    if (change === "lead")
      await harness.request("PUT", "preferences", {
        ...subscription,
        preferences: { ...PREFERENCES, minutes },
        revision: 0,
      });
    harness.upstream.games = [game];
    await harness.reminders.saveGames([game]);
    const dueAt = game.start - minutes * 60_000;
    assert.equal(await harness.reminders.findNextDeadline(), dueAt - 30_000);
    harness.clock.now = dueAt;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, 1);
  }
});

test("a confirmed push rejection can follow a rescheduled game without resetting its attempt count", async () => {
  for (const changesDuringSend of [false, true]) {
    const harness = createHarness();
    await harness.subscribe();
    await harness.reminders.saveGames([GAME]);
    harness.clock.now = GAME.start - 60 * 60_000;
    harness.upstream.status = 503;
    const moved = { ...GAME, start: GAME.start + 60 * 60_000 };
    const reschedule = async () => {
      harness.upstream.games = [moved];
      await harness.reminders.saveGames([moved]);
    };
    if (changesDuringSend)
      harness.upstream.onSend = async () => {
        harness.upstream.onSend = null;
        await reschedule();
      };
    await harness.reminders.checkDue();
    if (!changesDuringSend) await reschedule();
    assert.equal(await harness.reminders.findNextDeadline(), moved.start - 60 * 60_000 - 30_000);
    const [device] = (await harness.push.listSubscriptions()).values();
    assert.equal(device.reminderReceipts[GAME.id].attempts, 1);
    harness.clock.now += 60 * 60_000;
    harness.upstream.status = 201;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, 2);
  }
});

test("a gone response for old keys cannot remove a subscription renewed during delivery", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe({ ...PREFERENCES, updates: true });
  const { p256dh, auth } = await createBrowserKeys();
  const renewed = { ...subscription, keys: { p256dh, auth } };
  harness.upstream.status = 410;
  harness.upstream.onSend = async () => {
    assert.equal((await harness.request("PUT", "subscription", renewed)).status, 204);
  };
  assert.equal((await harness.request("POST", "test", subscription)).status, 502);
  const [kept] = (await harness.push.listSubscriptions()).values();
  assert.deepEqual(kept.keys, renewed.keys);
  assert.equal((await harness.request("POST", "preferences", renewed)).status, 200);
});

test("DELETE and test requests with wrong keys cannot act on another device", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const impostor = { ...subscription, keys: await createBrowserKeys() };
  assert.equal((await harness.request("POST", "test", impostor)).status, 404);
  assert.equal((await harness.request("DELETE", "subscription", impostor)).status, 400);
  assert.equal(harness.sent.length, 0);
  assert.equal((await harness.push.listSubscriptions()).size, 1);
  assert.equal((await harness.request("POST", "preferences", subscription)).status, 200);
});

test("retired device history prunes records older than a month and keeps at most a hundred", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const [device] = (await harness.push.listSubscriptions()).values();
  harness.stored.set("push:retired:stale", {
    ...device,
    retiredAt: NOW - 30 * 24 * 60 * 60_000 - 1,
  });
  assert.equal((await harness.request("DELETE", "subscription", subscription)).status, 204);
  const firstRetired = await harness.ctx.storage.list({
    prefix: "push:retired:",
    limit: undefined,
  });
  assert.equal(firstRetired.size, 1);
  assert.equal(firstRetired.has("push:retired:stale"), false);
  const second = await harness.subscribe(PREFERENCES, "second");
  for (let index = 0; index < 100; index++)
    harness.stored.set(`push:retired:${index}`, { ...device, retiredAt: NOW - index });
  assert.equal((await harness.request("DELETE", "subscription", second.subscription)).status, 204);
  const retired = await harness.ctx.storage.list({ prefix: "push:retired:", limit: undefined });
  assert.equal(retired.size, 100);
  assert.equal(retired.has("push:retired:stale"), false);
  assert.equal(retired.has("push:retired:99"), false);
  assert.equal(retired.has("push:retired:0"), true);
});

for (const { removal, status, inactiveDays } of [
  { removal: "permanent removal", status: 410, inactiveDays: 0 },
  { removal: "permanent removal after a month away", status: 410, inactiveDays: 40 },
  { removal: "a week of failures", status: 503, inactiveDays: 0 },
]) {
  test(`renewal after ${removal} retains opted-in categories and sent receipts`, async () => {
    const harness = createHarness();
    const { subscription } = await harness.subscribe({ ...PREFERENCES, updates: true });
    if (inactiveDays) {
      const [key, device] = [...(await harness.push.listSubscriptions())][0];
      await harness.ctx.storage.put(key, {
        ...device,
        savedAt: NOW - inactiveDays * 24 * 60 * 60_000,
      });
    }
    await harness.reminders.saveGames([GAME]);
    harness.clock.now = GAME.start - 60 * 60_000;
    await harness.reminders.checkDue();
    harness.upstream.status = status;
    await harness.push.sendToAll([{ title: "Final" }]);
    if (status === 503) {
      harness.clock.now += 7 * 24 * 60 * 60_000;
      await harness.push.sendToAll([{ title: "Final" }]);
    }
    assert.equal((await harness.push.listSubscriptions()).size, 0);
    const renewed = {
      ...subscription,
      endpoint: "https://web.push.apple.com/renewed-after-removal",
    };
    assert.equal(
      (
        await harness.request("PUT", "subscription", {
          ...renewed,
          previousSubscription: subscription,
        })
      ).status,
      204,
    );
    const [device] = (await harness.push.listSubscriptions()).values();
    assert.deepEqual(device.preferences, { ...PREFERENCES, updates: true });
    assert.equal(device.reminderReceipts[GAME.id].state, "sent");
    if (status === 503) {
      await harness.push.sendToAll([{ title: "Next update" }]);
      assert.equal((await harness.push.listSubscriptions()).size, 1);
      const [active] = (await harness.push.listSubscriptions()).values();
      assert.equal(active.failingSince, harness.clock.now);
    }
    const beforeReschedule = harness.sent.length;
    const moved = { ...GAME, start: harness.clock.now + 2 * 60 * 60_000 };
    harness.upstream.games = [moved];
    await harness.reminders.saveGames([moved]);
    harness.clock.now = moved.start - 60 * 60_000;
    harness.upstream.status = 201;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, beforeReschedule);
  });
}

for (const transfer of ["renewal", "opt-out"]) {
  test(`a known successful reminder keeps its sent receipt across in-flight ${transfer}`, async () => {
    const harness = createHarness();
    const { subscription } = await harness.subscribe();
    const renewed = { ...subscription, endpoint: "https://web.push.apple.com/renewed-during-send" };
    const saveRenewal = () =>
      harness.request("PUT", "subscription", { ...renewed, previousSubscription: subscription });
    harness.upstream.onSend = async () => {
      harness.upstream.onSend = null;
      if (transfer === "opt-out") await harness.request("DELETE", "subscription", subscription);
      else await saveRenewal();
    };
    await harness.reminders.saveGames([GAME]);
    harness.clock.now = GAME.start - 60 * 60_000;
    await harness.reminders.checkDue();
    if (transfer === "opt-out") await saveRenewal();
    const [device] = (await harness.push.listSubscriptions()).values();
    assert.equal(device.reminderReceipts[GAME.id].state, "sent");
    harness.clock.now += 15_000;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, 1);
  });
}

test("a legacy same-endpoint return restores retired history only with its subscription proof", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  await harness.reminders.saveGames([GAME]);
  harness.clock.now = GAME.start - 60 * 60_000;
  await harness.reminders.checkDue();
  await harness.request("DELETE", "subscription", subscription);
  const { p256dh, auth } = await createBrowserKeys();
  const impostor = { ...subscription, keys: { p256dh, auth } };
  assert.equal((await harness.request("PUT", "subscription", impostor)).status, 409);
  assert.equal((await harness.request("PUT", "subscription", subscription)).status, 204);
  const [device] = (await harness.push.listSubscriptions()).values();
  assert.deepEqual(device.preferences, PREFERENCES);
  assert.equal(device.reminderReceipts[GAME.id].state, "sent");
});

test("a stale device displaced by capacity can return without losing its reminder choices", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  const [key, device] = [...(await harness.push.listSubscriptions())][0];
  await harness.ctx.storage.put(key, { ...device, savedAt: NOW - 40 * 24 * 60 * 60_000 });
  for (let index = 0; index < 100; index++)
    assert.equal(
      (
        await harness.request("PUT", "subscription", {
          ...subscription,
          endpoint: `https://web.push.apple.com/capacity-${index}`,
        })
      ).status,
      204,
    );
  assert.equal((await harness.push.listSubscriptions()).has(key), false);
  await harness.request("DELETE", "subscription", {
    ...subscription,
    endpoint: "https://web.push.apple.com/capacity-0",
  });
  assert.equal((await harness.request("PUT", "subscription", subscription)).status, 204);
  assert.deepEqual((await harness.ctx.storage.get(key)).preferences, PREFERENCES);
});

test("retired renewal history expires a month after removal even before another retirement", async () => {
  const harness = createHarness();
  const { subscription } = await harness.subscribe();
  await harness.request("DELETE", "subscription", subscription);
  harness.clock.now += 30 * 24 * 60 * 60_000 + 1;
  assert.equal(
    (
      await harness.request("PUT", "subscription", {
        ...subscription,
        endpoint: "https://web.push.apple.com/after-history-expiry",
        previousSubscription: subscription,
      })
    ).status,
    204,
  );
  const [device] = (await harness.push.listSubscriptions()).values();
  assert.equal(device.preferences.reminders, false);
  assert.equal(
    (await harness.ctx.storage.list({ prefix: "push:retired:", limit: undefined })).size,
    0,
  );
});

for (const change of ["endpoint", "keys"]) {
  test(`a gone response for the old ${change} retries a renewed reminder within its original deadline`, async () => {
    const harness = createHarness();
    const { subscription, keys: originalKeys } = await harness.subscribe();
    const keys = change === "endpoint" ? originalKeys : await createBrowserKeys();
    const renewed = {
      ...subscription,
      endpoint:
        change === "endpoint" ? "https://web.push.apple.com/changed" : subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    };
    harness.upstream.status = 410;
    harness.upstream.onSend = async () => {
      harness.upstream.onSend = null;
      assert.equal(
        (
          await harness.request("PUT", "subscription", {
            ...renewed,
            previousSubscription: subscription,
          })
        ).status,
        204,
      );
    };
    await harness.reminders.saveGames([GAME]);
    harness.clock.now = GAME.start - 60 * 60_000;
    await harness.reminders.checkDue();
    const [device] = (await harness.push.listSubscriptions()).values();
    assert.equal(device.reminderReceipts[GAME.id].state, "pending");
    harness.clock.now += 15_000;
    harness.upstream.status = 201;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, 2);
    assert.equal(harness.sent[1].url, renewed.endpoint);
    assert.equal(harness.sent[1].init.headers.ttl, "105");
    assert.equal(
      (await readPushMessage(harness.sent[1].init.body, keys)).tag,
      `game-reminder:${GAME.id}`,
    );
    harness.clock.now += 15_000;
    await harness.reminders.checkDue();
    assert.equal(harness.sent.length, 2);
  });
}
