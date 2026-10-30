import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as MLBSnapshot from "../page/js/snapshot.js";
import worker from "../worker/src/index.js";
import { nameInjuriesRequest } from "../worker/src/injuries.js";
import { NEWS_FEEDS } from "../worker/src/news-feeds.js";
import { SeasonStore } from "../worker/src/store.js";
import { createPushService } from "../../../shared/worker/push.js";
import { decodeBase64Url } from "../../../shared/worker/web-push.js";
import {
  createDurableObjectContext,
  fireNextAlarm,
} from "../../../tests/durable-object-context.js";
import { createBrowserKeys, readPushMessage } from "../../../tests/push-reader.js";

const APP_KEY = "k3y";
const ORIGIN = "https://mlb-app.example.workers.dev";
const ENDPOINT = "https://web.push.apple.com/QGuQyavXutnMH";

const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-24-evening.json`, "utf8"),
);
const NOW = Date.parse(EVENING.now);
const SNAPSHOT = MLBSnapshot.buildSnapshot(EVENING.responses, { season: 2026, now: NOW });

/** @param {string} url */
const isNewsFeed = (url) => NEWS_FEEDS.some((feed) => feed.url === url);

function createPushStore({ pushStatus = 201 } = {}) {
  const context = createDurableObjectContext();
  const harness = { snapshot: SNAPSHOT, pushStatus, isPushServiceAnswering: true, pushes: [] };
  const clock = { now: NOW };
  // MLB, whose pitchers the store also keeps, ESPN's injury report, and the news outlets aren't
  // what these tests follow.
  const fetchImpl = async (url, init) => {
    if (url.startsWith(MLBSnapshot.MLB_API) || url === nameInjuriesRequest() || isNewsFeed(url))
      return new Response(null, { status: 404 });
    harness.pushes.push({ url, init });
    if (!harness.isPushServiceAnswering)
      throw new DOMException("The push service didn't answer", "TimeoutError");
    return new Response(null, { status: harness.pushStatus });
  };
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      createLoadSnapshot: () => async () => structuredClone(harness.snapshot),
      now: () => clock.now,
      fetchImpl,
    },
  );
  const env = {
    APP_KEY,
    STORE: {
      idFromName: (name) => name,
      get: () => ({ fetch: (request) => store.fetch(request) }),
    },
  };
  return { store, context, harness, env, clock };
}

/**
 * @param {object} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
function requestApp(env, path, { method = "GET", body } = {}) {
  /** @type {RequestInit} */
  const init = { method, headers: { "content-type": "application/json", origin: ORIGIN } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return worker.fetch(new Request(`${ORIGIN}/${APP_KEY}${path}`, init), env);
}

async function subscribe(env, endpoint = ENDPOINT) {
  const keys = await createBrowserKeys();
  const response = await requestApp(env, "/push/subscription", {
    method: "PUT",
    body: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  });
  return { response, keys };
}

const listSubscriptions = (context) =>
  [...context.stored.keys()].filter((key) => key.startsWith("push:subscription:"));

test("the signing key is made once, and its public half is the page's to use", async () => {
  const { env, context } = createPushStore();
  const first = await (await requestApp(env, "/push/key")).json();
  const second = await (await requestApp(env, "/push/key")).json();
  assert.equal(first.publicKey, second.publicKey);
  assert.equal(decodeBase64Url(first.publicKey).length, 65);
  assert.ok(context.stored.get("push:signing-key").d, "the private key is kept");
});

test("a subscription is saved, and only for a real push service", async () => {
  const { env, context } = createPushStore();
  const { response } = await subscribe(env);
  assert.equal(response.status, 204);
  const [key] = listSubscriptions(context);
  assert.equal(context.stored.get(key).endpoint, ENDPOINT);
  assert.equal(context.stored.get(key).subject, ORIGIN);

  const elsewhere = await subscribe(env, "https://example.com/push");
  assert.equal(elsewhere.response.status, 400);
  const plainHttp = await subscribe(env, "http://web.push.apple.com/abc");
  assert.equal(plainHttp.response.status, 400);
  const shortKeys = await requestApp(env, "/push/subscription", {
    method: "PUT",
    body: { endpoint: ENDPOINT, keys: { p256dh: "AAAA", auth: "AAAA" } },
  });
  assert.equal(shortKeys.status, 400);
  assert.equal(listSubscriptions(context).length, 1);
});

test("the store's own paths can't reach the keys or subscriptions", async () => {
  const { env } = createPushStore();
  await subscribe(env);
  assert.equal((await requestApp(env, "/store/push:signing-key/x")).status, 404);
  assert.deepEqual((await (await requestApp(env, "/store/push")).json()).docs, []);
});

test("a test goes to that device, and a gone device is retired", async () => {
  const { env, context, harness } = createPushStore();
  const { keys } = await subscribe(env);
  const sent = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(sent.status, 204);
  assert.equal(harness.pushes[0].url, ENDPOINT);
  const message = await readPushMessage(harness.pushes[0].init.body, keys);
  assert.equal(message.title, "Notifications are on");

  harness.pushStatus = 410;
  const gone = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(gone.status, 502);
  assert.deepEqual(listSubscriptions(context), []);
  const unknown = await requestApp(env, "/push/test", {
    method: "POST",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(unknown.status, 404);
});

/** @param {object} env */
const sendTest = (env) =>
  requestApp(env, "/push/test", { method: "POST", body: { endpoint: ENDPOINT } });

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

test("a test message to a push service that doesn't answer fails, and keeps the device", async () => {
  const { env, context, harness } = createPushStore();
  await subscribe(env);
  harness.isPushServiceAnswering = false;
  const sent = await sendTest(env);
  assert.equal(sent.status, 502);
  assert.equal(listSubscriptions(context).length, 1);
});

test("a device whose push service doesn't answer for a week is retired", async () => {
  const { env, context, harness, clock } = createPushStore();
  await subscribe(env);
  harness.isPushServiceAnswering = false;

  await sendTest(env);
  clock.now += 8 * DAY_MS;
  await sendTest(env);

  assert.deepEqual(listSubscriptions(context), []);
});

/**
 * Stands in a device for each key, each saved at the given time.
 * @param {ReturnType<typeof createDurableObjectContext>} context
 * @param {number} count
 * @param {number} savedAt
 */
function storeDevices(context, count, savedAt) {
  for (let index = 0; index < count; index += 1)
    context.stored.set(`push:subscription:${index}`, { endpoint: `${ENDPOINT}-${index}`, savedAt });
}

/**
 * Changes what the store keeps for one of the devices `storeDevices` stood in.
 * @param {ReturnType<typeof createDurableObjectContext>} context
 * @param {number} index
 * @param {object} fields
 */
function changeDevice(context, index, fields) {
  const key = `push:subscription:${index}`;
  context.stored.set(key, { ...context.stored.get(key), ...fields });
}

/** @param {{ response: Response }} subscribed */
const readTurnedAwayCode = async ({ response }) => {
  assert.equal(response.status, 429);
  return (await response.json()).error.code;
};

test("a full store of devices in use turns a new one away, but a device already kept can subscribe again", async () => {
  const { env, context } = createPushStore();
  storeDevices(context, 99, NOW);
  await subscribe(env);

  assert.equal(
    await readTurnedAwayCode(await subscribe(env, `${ENDPOINT}-new`)),
    "too_many_devices",
  );
  assert.equal((await subscribe(env)).response.status, 204);
  assert.equal(listSubscriptions(context).length, 100);
});

test("a full store makes room for a new device by retiring the one saved longest ago, once that's a month ago", async () => {
  const { env, context } = createPushStore();
  storeDevices(context, 100, NOW);
  changeDevice(context, 50, { savedAt: NOW - 29 * DAY_MS, failingSince: NOW - 2 * DAY_MS });
  changeDevice(context, 60, { savedAt: NOW - 31 * DAY_MS });
  changeDevice(context, 70, { savedAt: NOW - 40 * DAY_MS });

  assert.equal((await subscribe(env, `${ENDPOINT}-a`)).response.status, 204);
  assert.ok(!context.stored.has("push:subscription:70"));
  assert.equal((await subscribe(env, `${ENDPOINT}-b`)).response.status, 204);
  assert.ok(!context.stored.has("push:subscription:60"));
  assert.equal(
    await readTurnedAwayCode(await subscribe(env, `${ENDPOINT}-c`)),
    "too_many_devices",
    "a device saved within the month keeps its slot, failing or not",
  );
  assert.ok(context.stored.has("push:subscription:50"));
  assert.equal(listSubscriptions(context).length, 100);
});

test("a device kept without the time it was saved counts as not saved for a month", async () => {
  const { env, context } = createPushStore();
  storeDevices(context, 100, NOW);
  context.stored.set("push:subscription:5", { endpoint: `${ENDPOINT}-5` });

  assert.equal((await subscribe(env)).response.status, 204);
  assert.ok(!context.stored.has("push:subscription:5"));
});

test("a device saved again on a later visit keeps its slot in a full store", async () => {
  const { env, context, clock } = createPushStore();
  await subscribe(env);
  clock.now += 40 * DAY_MS;
  storeDevices(context, 99, clock.now);
  await subscribe(env);

  assert.equal(
    await readTurnedAwayCode(await subscribe(env, `${ENDPOINT}-new`)),
    "too_many_devices",
  );
});

test("a device whose push service turns every message away for a week is retired, and one that gets a message through starts over", async () => {
  const { env, context, harness, clock } = createPushStore({ pushStatus: 403 });
  await subscribe(env);

  await sendTest(env);
  clock.now += 6 * DAY_MS;
  await sendTest(env);
  assert.equal(listSubscriptions(context).length, 1);
  harness.pushStatus = 201;
  await sendTest(env);
  harness.pushStatus = 403;
  clock.now += 2 * DAY_MS;
  await sendTest(env);
  assert.equal(listSubscriptions(context).length, 1);

  clock.now += 7 * DAY_MS;
  await sendTest(env);
  assert.deepEqual(listSubscriptions(context), []);
});

test("a device that gets a message through after a week of failures is kept, though the next message fails", async () => {
  const context = createDurableObjectContext();
  const keys = await createBrowserKeys();
  const statuses = [201, 500];
  const push = createPushService({
    storage: context.ctx.storage,
    now: () => NOW,
    fetchImpl: /** @type {any} */ (async () => new Response(null, { status: statuses.shift() })),
  });
  const key = "push:subscription:device";
  await context.ctx.storage.put(key, {
    endpoint: ENDPOINT,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    subject: ORIGIN,
    failingSince: NOW - 8 * DAY_MS,
  });

  await push.sendToAll([
    { title: "First", body: "", tag: "first" },
    { title: "Second", body: "", tag: "second" },
  ]);

  assert.equal(context.stored.get(key)?.failingSince, NOW);
});

test("unsubscribing removes the device", async () => {
  const { env, context } = createPushStore();
  await subscribe(env);
  const response = await requestApp(env, "/push/subscription", {
    method: "DELETE",
    body: { endpoint: ENDPOINT },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(listSubscriptions(context), []);
});

/**
 * A push service whose every message fails once the given step, taken while the message is out,
 * is done.
 * @param {(push: ReturnType<typeof createPushService>, clock: { now: number }) => unknown} whileSending
 */
function createPushServiceWith(whileSending) {
  const context = createDurableObjectContext();
  const clock = { now: NOW };
  const failAfterStep = async () => {
    await whileSending(push, clock);
    return new Response(null, { status: 500 });
  };
  const push = createPushService({
    storage: context.ctx.storage,
    now: () => clock.now,
    fetchImpl: /** @type {any} */ (failAfterStep),
  });
  return { context, push };
}

/**
 * @param {ReturnType<typeof createPushService>} push
 * @param {string} method
 * @param {object} body
 */
const requestSubscription = (push, method, body) =>
  push.serveRequest(
    new Request(`${ORIGIN}/push/subscription`, { method, body: JSON.stringify(body) }),
    "/push/subscription",
  );

/** @param {{ p256dh: string, auth: string }} keys */
const describeDevice = ({ p256dh, auth }) => ({ endpoint: ENDPOINT, keys: { p256dh, auth } });

const FINAL_MESSAGE = { title: "Final", body: "", tag: "final" };

test("a device removed while its message is out stays removed", async () => {
  const { context, push } = createPushServiceWith((service) =>
    requestSubscription(service, "DELETE", { endpoint: ENDPOINT }),
  );
  await requestSubscription(push, "PUT", describeDevice(await createBrowserKeys()));

  await push.sendToAll([FINAL_MESSAGE]);

  assert.deepEqual(listSubscriptions(context), []);
});

test("a device subscribed again while its old subscription's message is out keeps the new one", async () => {
  const newKeys = await createBrowserKeys();
  const { context, push } = createPushServiceWith((service) =>
    requestSubscription(service, "PUT", describeDevice(newKeys)),
  );
  await requestSubscription(push, "PUT", describeDevice(await createBrowserKeys()));

  await push.sendToAll([FINAL_MESSAGE]);

  const [key] = listSubscriptions(context);
  assert.equal(context.stored.get(key).keys.auth, newKeys.auth);
  assert.equal(context.stored.get(key).failingSince, undefined);
});

test("a device saved again by a visit while its message is out keeps the visit's save, and the failure", async () => {
  const keys = await createBrowserKeys();
  const { context, push } = createPushServiceWith((service, clock) => {
    clock.now += MINUTE_MS;
    return requestSubscription(service, "PUT", describeDevice(keys));
  });
  await requestSubscription(push, "PUT", describeDevice(keys));

  await push.sendToAll([FINAL_MESSAGE]);

  const [key] = listSubscriptions(context);
  assert.equal(context.stored.get(key).savedAt, NOW + MINUTE_MS);
  assert.equal(context.stored.get(key).failingSince, NOW + MINUTE_MS);
});

function moveMetsIntoField(snapshot) {
  const { PHI, ...teams } = snapshot.teams;
  return { ...snapshot, teams: { ...teams, NYM: { ...PHI, w: 83, l: 76 } } };
}

test("an update that finds a change for a club in the field notifies every device", async () => {
  const { store, env, context, harness, clock } = createPushStore();
  const endpoints = [ENDPOINT, `${ENDPOINT}-2`];
  const devices = [await subscribe(env, endpoints[0]), await subscribe(env, endpoints[1])];
  await store.alarm();
  assert.deepEqual(harness.pushes, [], "the first reading has nothing to compare with");

  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  await fireNextAlarm(store, context, clock);
  assert.equal(harness.pushes.length, 2);
  for (const [index, { keys }] of devices.entries()) {
    const push = harness.pushes.find(({ url }) => url === endpoints[index]);
    const message = await readPushMessage(push.init.body, keys);
    assert.match(message.title, /^Mets take .* from the Phillies$/);
    assert.match(message.tag, /^field:NYM:PHI:/);
  }

  harness.pushes.length = 0;
  await fireNextAlarm(store, context, clock);
  assert.deepEqual(harness.pushes, [], "nothing new, nothing sent");
});

test("an update's news goes out even when saving its status fails", async () => {
  const { store, env, context, harness, clock } = createPushStore();
  await subscribe(env);
  await store.alarm();
  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  const { put } = context.ctx.storage;
  context.ctx.storage.put = async (key, value) => {
    if (key.endsWith("live/status")) throw new Error("storage is full");
    return put(key, value);
  };
  await fireNextAlarm(store, context, clock);
  assert.equal(harness.pushes.length, 1);
});

test("a push service that fails doesn't stop the season update", async () => {
  const { store, env, context, harness, clock } = createPushStore();
  context.ctx.acceptWebSocket({ send: () => {} });
  await subscribe(env);
  await store.alarm();
  harness.snapshot = moveMetsIntoField(SNAPSHOT);
  harness.pushStatus = 500;
  await fireNextAlarm(store, context, clock);
  assert.equal(harness.pushes.length, 1);
  assert.ok("NYM" in context.stored.get("seasons/2026").teams);
  assert.equal(context.alarm.at, clock.now + MLBSnapshot.POLL_CLOSING_MS);
});
