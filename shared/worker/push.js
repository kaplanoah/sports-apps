import {
  isNotificationPreferences,
  readNotificationPreferences,
} from "../page/notification-preferences.js";
import * as WebPush from "./web-push.js";
import { respondError, respondJson } from "./responses.js";

// Push subscriptions and the key that signs messages for them. Both are kept under keys the
// store's own paths can't name, so the page's store never hands them out. The store keeps a hundred
// active devices at most, since anyone with the page's address can subscribe one. Once full, it
// makes room for a new one only by retiring the one saved longest ago that hasn't been saved for
// a month, since each visit saves its device again, and turns the new one away otherwise, so a flood of
// subscriptions never pushes out a phone opened that month. It also removes active devices their push
// service says are gone, or that have failed every message for a week, long enough for a fault of the
// store's own to be fixed first. Up to a hundred retired devices retain preferences and reminder
// receipts for a month, so returning devices and renewed endpoints keep their delivery history.

const SIGNING_KEY = "push:signing-key";
const SUBSCRIPTION_PREFIX = "push:subscription:";
const RETIRED_PREFIX = "push:retired:";
const MAX_BODY_BYTES = 4 * 1024;
const MAX_SUBSCRIPTIONS = 100;
const FAILING_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const UNSAVED_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Only real push services, so a stored address can't point the Worker anywhere else.
const PUSH_SERVICE_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
];

const TEST_MESSAGE = {
  title: "Notifications are on",
  body: "You'll hear here when something happens to a team in your ranking.",
  tag: "test",
};

/** @param {number} status */
export const isDelivered = (status) => status >= 200 && status < 300;

/** @param {number} status */
export const isRetryablePushStatus = (status) => status === 429 || status >= 500;

/** @param {number} status */
export const isGonePushStatus = (status) => status === 404 || status === 410;

const isPushServiceHost = (host) =>
  PUSH_SERVICE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));

function isPushServiceUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && isPushServiceHost(url.hostname);
  } catch {
    return false;
  }
}

function hasKeyLength(text, length) {
  try {
    return typeof text === "string" && WebPush.decodeBase64Url(text).length === length;
  } catch {
    return false;
  }
}

export const isSameSubscription = (stored, sent) =>
  stored.endpoint === sent.endpoint &&
  stored.keys.p256dh === sent.keys.p256dh &&
  stored.keys.auth === sent.keys.auth;

const isSubscription = (value) =>
  !!value &&
  isPushServiceUrl(value.endpoint) &&
  hasKeyLength(value.keys?.p256dh, 65) &&
  hasKeyLength(value.keys?.auth, 16);

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The device a full store retires to make room for another, the one saved longest ago once that's
 * a month ago, or undefined when every device was saved since. A device kept without the time it
 * was saved counts as saved longest ago.
 * @param {Map<string, { savedAt?: number }>} stored
 * @param {number} now
 */
function findForgettable(stored, now) {
  const [oldest] = [...stored]
    .map(([key, device]) => ({ key, savedAt: device.savedAt ?? 0 }))
    .sort((first, second) => first.savedAt - second.savedAt);
  return oldest && now - oldest.savedAt >= UNSAVED_FOR_MS ? oldest.key : undefined;
}

async function findSubscriptionKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
  return SUBSCRIPTION_PREFIX + hex.join("").slice(0, 32);
}

/**
 * @param {object} options
 * @param {{ get: Function, put: Function, delete: Function, list: Function }} options.storage
 * @param {() => number} options.now
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPushService({ storage, now, fetchImpl }) {
  let signingKey = null;
  let changing = Promise.resolve();

  /** @template Result @param {() => Promise<Result>} task */
  function changeDevices(task) {
    const result = changing.then(task);
    changing = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async function findDeviceForUpdate(key, deviceId) {
    const stored = await storage.get(key);
    if (stored && (deviceId === undefined || (stored.deviceId ?? key) === deviceId))
      return [key, stored];
    if (deviceId === undefined) return null;
    // A completed receipt follows its device through renewal or retirement during the send.
    for (const prefix of [SUBSCRIPTION_PREFIX, RETIRED_PREFIX]) {
      const devices = await storage.list({ prefix });
      for (const [candidate, device] of devices)
        if ((device.deviceId ?? candidate) === deviceId) return [candidate, device];
    }
    return null;
  }

  /** @param {string} key @param {(device: any) => any} change @param {string} [deviceId] */
  function updateDevice(key, change, deviceId = undefined) {
    return changeDevices(async () => {
      const found = await findDeviceForUpdate(key, deviceId);
      if (!found) return null;
      const [currentKey, stored] = found;
      const next = change(stored);
      if (next) await storage.put(currentKey, next);
      return next ?? stored;
    });
  }

  async function loadSigningKey() {
    const stored = await storage.get(SIGNING_KEY);
    if (stored) return stored;
    const created = await WebPush.createSigningKey();
    await storage.put(SIGNING_KEY, created);
    return created;
  }

  // Held as one promise, so two requests at once can't each make a key.
  function readSigningKey() {
    signingKey ??= loadSigningKey().catch((error) => {
      signingKey = null;
      throw error;
    });
    return signingKey;
  }

  /**
   * Keeps when the device's messages started failing, and retires it once they have failed long
   * enough. A message that goes through clears it. A device removed or subscribed again while the
   * message was out keeps what that did. Answers the device as it's now kept, or null once it's
   * retired.
   * @param {string} key
   * @param {any} sent the device as the message went out to it
   * @param {boolean} wentThrough
   */
  async function noteDelivery(key, sent, wentThrough) {
    return changeDevices(async () => {
      const subscription = await storage.get(key);
      if (!subscription || !isSameSubscription(subscription, sent)) return subscription ?? null;
      const { failingSince, ...kept } = subscription;
      if (wentThrough) {
        if (failingSince !== undefined) await storage.put(key, kept);
        return kept;
      }
      if (failingSince === undefined) {
        const failing = { ...kept, failingSince: now() };
        await storage.put(key, failing);
        return failing;
      }
      if (now() - failingSince < FAILING_FOR_MS) return subscription;
      await archiveDevice(key, subscription);
      return null;
    });
  }

  /**
   * Sends the device a message, and answers the push service's status with the device as it's
   * now kept, or null once it's retired.
   * @param {string} key
   * @param {any} subscription
   * @param {object} message
   */
  async function deliver(key, subscription, message, ttlSeconds = undefined) {
    let status;
    try {
      status = await WebPush.sendPush({
        subscription,
        message,
        signingKey: await readSigningKey(),
        subject: subscription.subject,
        now: now(),
        fetchImpl,
        ttlSeconds,
      });
    } catch (error) {
      await noteDelivery(key, subscription, false);
      throw error;
    }
    if (!isGonePushStatus(status))
      return { status, kept: await noteDelivery(key, subscription, isDelivered(status)) };
    await changeDevices(async () => {
      const current = await storage.get(key);
      if (current && isSameSubscription(current, subscription)) await archiveDevice(key, current);
    });
    return { status, kept: null };
  }

  async function serveKey() {
    const publicKey = WebPush.readApplicationServerKey(await readSigningKey());
    return respondJson({ publicKey });
  }

  // The push service needs a way to reach whoever sends, and the page's own address is one.
  async function saveSubscription(request) {
    const body = await readBody(request);
    if (!isSubscription(body))
      return respondError(400, "invalid_argument", "That isn't a push subscription.");
    if (body.preferences !== undefined && !isNotificationPreferences(body.preferences))
      return respondError(400, "invalid_argument", "Invalid notification preferences.");
    return changeDevices(async () => {
      const { endpoint, keys, previousSubscription } = body;
      const key = await findSubscriptionKey(endpoint);
      const stored = await storage.get(key);
      const isRenewal = isSubscription(previousSubscription);
      const proof = isRenewal ? previousSubscription : body;
      const previousKey = await findSubscriptionKey(proof.endpoint);
      const activePrevious = isRenewal ? await storage.get(previousKey) : null;
      const previous =
        activePrevious ?? (isRenewal || !stored ? await readRetiredDevice(previousKey) : null);
      if (previous && !isSameSubscription(previous, proof))
        return respondError(409, "conflict", "The previous subscription changed.");
      if (!activePrevious && !(await makeRoomFor(key)))
        return respondError(429, "too_many_devices", "Too many devices get notifications already.");
      const { retiredAt, ...kept } = stored ?? previous ?? {};
      const preferences = readNotificationPreferences(kept);
      await storage.put(key, {
        ...kept,
        deviceId: kept.deviceId ?? (previous && !stored ? previousKey : key),
        endpoint,
        keys,
        subject: new URL(request.url).origin,
        savedAt: now(),
        preferences: !stored && !previous && body.preferences ? body.preferences : preferences,
        revision: kept.revision ?? 0,
      });
      if (previousKey !== key) await storage.delete(previousKey);
      if (previous && !activePrevious)
        await storage.delete(previousKey.replace(SUBSCRIPTION_PREFIX, RETIRED_PREFIX));
      return new Response(null, { status: 204 });
    });
  }

  /**
   * Makes room for the device when the store is full and holds one it can retire, and answers
   * whether the device has room.
   * @param {string} key
   */
  async function makeRoomFor(key) {
    if (await storage.get(key)) return true;
    const stored = await listSubscriptions();
    if (stored.size < MAX_SUBSCRIPTIONS) return true;
    const forgettable = findForgettable(stored, now());
    if (forgettable === undefined) return false;
    await archiveDevice(forgettable, stored.get(forgettable));
    return true;
  }

  async function readSubscriptionFor(request) {
    const body = await readBody(request);
    if (!body || typeof body.endpoint !== "string") return {};
    const key = await findSubscriptionKey(body.endpoint);
    const subscription = await storage.get(key);
    if (body.keys && subscription && !isSameSubscription(subscription, body)) return {};
    return { key, subscription };
  }

  async function removeSubscription(request) {
    const { key } = await readSubscriptionFor(request);
    if (!key) return respondError(400, "invalid_argument", "Say which subscription to remove.");
    await changeDevices(async () => {
      const device = await storage.get(key);
      if (device) await archiveDevice(key, device);
    });
    return new Response(null, { status: 204 });
  }

  async function archiveDevice(key, device) {
    // A returning device gets a fresh failure window.
    const { failingSince, ...history } = device;
    await storage.put(key.replace(SUBSCRIPTION_PREFIX, RETIRED_PREFIX), {
      ...history,
      deviceId: device.deviceId ?? key,
      retiredAt: now(),
    });
    await trimRetiredDevices();
    await storage.delete(key);
  }

  function isRetiredExpired(device) {
    return now() - device.retiredAt > UNSAVED_FOR_MS;
  }

  async function readRetiredDevice(subscriptionKey) {
    const key = subscriptionKey.replace(SUBSCRIPTION_PREFIX, RETIRED_PREFIX);
    const device = await storage.get(key);
    if (!device || !isRetiredExpired(device)) return device;
    await storage.delete(key);
    return null;
  }

  async function trimRetiredDevices() {
    const retired = [...(await storage.list({ prefix: RETIRED_PREFIX }))].sort(
      ([, first], [, second]) => second.retiredAt - first.retiredAt,
    );
    for (const [index, [key, device]] of retired.entries()) {
      if (index >= MAX_SUBSCRIPTIONS || isRetiredExpired(device)) await storage.delete(key);
    }
  }

  async function servePreferences(request) {
    const body = await readBody(request);
    if (!isSubscription(body))
      return respondError(400, "invalid_argument", "Say which device to change.");
    return changeDevices(async () => {
      const key = await findSubscriptionKey(body.endpoint);
      const stored = await storage.get(key);
      if (!stored || !isSameSubscription(stored, body))
        return respondError(404, "not_found", "This device isn't subscribed.");
      if (request.method === "PUT") {
        if (!isNotificationPreferences(body.preferences) || !Number.isSafeInteger(body.revision))
          return respondError(400, "invalid_argument", "Invalid notification preferences.");
        if (body.revision !== (stored.revision ?? 0))
          return respondError(409, "conflict", "Notifications changed. Try again.");
        stored.preferences = body.preferences;
        stored.revision = body.revision + 1;
        await storage.put(key, stored);
      }
      return respondJson({
        preferences: readNotificationPreferences(stored),
        revision: stored.revision ?? 0,
      });
    });
  }

  async function sendTest(request) {
    const { key, subscription } = await readSubscriptionFor(request);
    if (!subscription) return respondError(404, "not_found", "This device isn't subscribed.");
    let status;
    try {
      ({ status } = await deliver(key, subscription, TEST_MESSAGE));
    } catch {
      return respondError(502, "push_failed", "The push service didn't answer.");
    }
    if (isDelivered(status)) return new Response(null, { status: 204 });
    return respondError(502, "push_failed", `The push service answered ${status}.`);
  }

  /** @param {Request} request @param {string} pathname */
  function serveRequest(request, pathname) {
    const route = `${request.method} ${pathname}`;
    if (route === "GET /push/key") return serveKey();
    if (route === "PUT /push/subscription") return saveSubscription(request);
    if (route === "DELETE /push/subscription") return removeSubscription(request);
    if (route === "POST /push/preferences" || route === "PUT /push/preferences")
      return servePreferences(request);
    if (route === "POST /push/test") return sendTest(request);
    return respondError(404, "not_found", "No such path.");
  }

  // Each device gets its messages in order, and one device failing doesn't stop the others.
  async function sendInOrder(key, subscription, messages) {
    let kept = subscription;
    for (const message of messages) {
      if (!readNotificationPreferences(kept).updates) return;
      ({ kept } = await deliver(key, kept, message));
      if (!kept) return;
    }
  }

  const listSubscriptions = () => storage.list({ prefix: SUBSCRIPTION_PREFIX });

  async function sendToAll(messages) {
    const stored = await listSubscriptions();
    return Promise.allSettled(
      [...stored]
        .filter(([, subscription]) => readNotificationPreferences(subscription).updates)
        .map(([key, subscription]) => sendInOrder(key, subscription, messages)),
    );
  }

  return { serveRequest, sendToAll, listSubscriptions, updateDevice, deliver };
}
