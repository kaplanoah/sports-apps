import { test, expect, openApp, openSettings } from "./harness.mjs";

// The switch subscribes through the page's service worker.
test.use({ serviceWorkers: "allow" });

const DEVICE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device";
const NEXT_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device-next";
// Where the stand-in keeps the device's subscription, so it lasts through a reload as a phone's
// does, and the endpoint its next subscription gets, as a push service hands out a new one.
const SUBSCRIPTION_KEY = "stubbedSubscription";
const NEXT_ENDPOINT_KEY = "stubbedNextEndpoint";

// Headless Chromium has no push service, and its headless shell denies notifications outright,
// so the permission prompt and the subscription are stand-ins. The subscription has real keys,
// which is all the Worker needs.
function stubPushManager({ endpoint, subscriptionKey, nextEndpointKey }) {
  const readKept = () => JSON.parse(sessionStorage.getItem(subscriptionKey) ?? "null");
  /** @type {NotificationPermission} */
  let permission = readKept() ? "granted" : "default";
  Object.defineProperty(Notification, "permission", { get: () => permission });
  Notification.requestPermission = async () => {
    permission = "granted";
    return permission;
  };
  const encode = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  /** @returns {any} what the page reads of a PushSubscription */
  const createSubscription = (kept) => ({
    endpoint: kept.endpoint,
    options: { applicationServerKey: Uint8Array.from(kept.serverKey) },
    toJSON: () => ({ endpoint: kept.endpoint, keys: kept.keys }),
    unsubscribe: async () => {
      sessionStorage.removeItem(subscriptionKey);
      return true;
    },
  });
  PushManager.prototype.getSubscription = async () => {
    const kept = readKept();
    return kept && createSubscription(kept);
  };
  PushManager.prototype.subscribe = async (options) => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const kept = {
      endpoint: sessionStorage.getItem(nextEndpointKey) ?? endpoint,
      serverKey: [...new Uint8Array(/** @type {ArrayBuffer} */ (options.applicationServerKey))],
      keys: {
        p256dh: encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
        auth: encode(crypto.getRandomValues(new Uint8Array(16))),
      },
    };
    sessionStorage.setItem(subscriptionKey, JSON.stringify(kept));
    return createSubscription(kept);
  };
}

const STUB = {
  endpoint: DEVICE_ENDPOINT,
  subscriptionKey: SUBSCRIPTION_KEY,
  nextEndpointKey: NEXT_ENDPOINT_KEY,
};

test("notifications can be turned on and off, with no note while the switch works", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, STUB);
  const app = await openApp(page);
  await openSettings(page);

  const toggle = page.getByRole("switch", { name: "Notifications" });
  const note = page.locator("#notifyNote");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(note).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(app.countSubscriptions()).toBe(1);
  await expect(note).toBeHidden();
  await expect(page.getByRole("button", { name: /test/i })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(app.countSubscriptions()).toBe(0);
});

test("a device subscribed under the Worker's old signing key subscribes again, and the Worker forgets the old subscription", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, STUB);
  const app = await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Notifications" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.evaluate(
    ([subscriptionKey, nextEndpointKey, nextEndpoint]) => {
      const kept = JSON.parse(/** @type {string} */ (sessionStorage.getItem(subscriptionKey)));
      sessionStorage.setItem(subscriptionKey, JSON.stringify({ ...kept, serverKey: [1, 2, 3] }));
      sessionStorage.setItem(nextEndpointKey, nextEndpoint);
    },
    [SUBSCRIPTION_KEY, NEXT_ENDPOINT_KEY, NEXT_ENDPOINT],
  );
  const savingNext = page.waitForRequest(
    (request) => request.method() === "PUT" && !!request.postData()?.includes(NEXT_ENDPOINT),
  );

  await page.reload();
  await (await savingNext).response();

  expect(app.countSubscriptions()).toBe(1);
});

test("blocked notifications point to the browser's site settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/browser's site settings/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeDisabled();
});

test("on an iPhone, blocked notifications point to Settings", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/Turn them on in Settings > Notifications/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeDisabled();
});

test("on an iPhone outside the Home Screen, the page says to add it there", async ({ page }) => {
  await page.addInitScript(() => {
    delete window.PushManager;
    Object.defineProperty(navigator, "userAgent", {
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
  });
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/add this page to your Home Screen/);
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeHidden();
});
