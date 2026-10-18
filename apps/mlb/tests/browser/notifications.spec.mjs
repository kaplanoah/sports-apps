import { test, expect, matchPath, openApp, openSettings } from "./harness.mjs";

// The switch subscribes through the page's service worker.
test.use({ serviceWorkers: "allow" });

const DEVICE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device";

// Headless Chromium has no push service, and its headless shell denies notifications outright,
// so the permission prompt and the subscription are stand-ins. The subscription has real keys,
// which is all the Worker needs. Both last through a reload, as the browser's do.
function stubPushManager(endpoint) {
  const PERMISSION_KEY = "test-notification-permission";
  Object.defineProperty(Notification, "permission", {
    get: () => sessionStorage.getItem(PERMISSION_KEY) ?? "default",
  });
  Notification.requestPermission = async () => {
    sessionStorage.setItem(PERMISSION_KEY, "granted");
    return "granted";
  };
  const KEPT_KEY = "test-push-subscription";
  /** @returns {any} a stand-in for the browser's PushSubscription */
  const describeSubscription = ({ keys, serverKey }) => ({
    endpoint,
    options: { applicationServerKey: Uint8Array.from(serverKey) },
    toJSON: () => ({ endpoint, keys }),
    unsubscribe: async () => {
      sessionStorage.removeItem(KEPT_KEY);
      return true;
    },
  });
  const encode = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  PushManager.prototype.getSubscription = async () => {
    const kept = sessionStorage.getItem(KEPT_KEY);
    return kept ? describeSubscription(JSON.parse(kept)) : null;
  };
  PushManager.prototype.subscribe = async (options) => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    const keys = {
      p256dh: encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
      auth: encode(crypto.getRandomValues(new Uint8Array(16))),
    };
    const serverKey = /** @type {ArrayBuffer} */ (options.applicationServerKey);
    const kept = { keys, serverKey: [...new Uint8Array(serverKey)] };
    sessionStorage.setItem(KEPT_KEY, JSON.stringify(kept));
    return describeSubscription(kept);
  };
}

test("notifications can be turned on and off, with no note while the switch works", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
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

test("a device the Worker has no room for is left off, and is still off after a reload", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
  await openApp(page);
  await page.route(matchPath("/push/subscription"), (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 429,
          json: { error: { code: "too_many_devices", message: "Too many devices." } },
        })
      : route.fallback(),
  );
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Notifications" });

  await toggle.click();
  await expect(page.locator("#notifyNote")).toHaveText(
    "Too many devices get notifications already",
  );
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.pushManager.getSubscription();
      }),
    )
    .toBeNull();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("a device the Worker no longer has room for on a later visit is turned off", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
  await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Notifications" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.route(matchPath("/push/subscription"), (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 429,
          json: { error: { code: "too_many_devices", message: "Too many devices." } },
        })
      : route.fallback(),
  );

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("#notifyNote")).toHaveText(
    "Too many devices get notifications already",
  );
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.pushManager.getSubscription();
      }),
    )
    .toBeNull();
});

test("a new signing key whose save fails for a moment keeps the subscription, which the next visit saves", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, DEVICE_ENDPOINT);
  await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Notifications" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const newKey = Buffer.from(new Uint8Array(65).fill(4)).toString("base64url");
  await page.route(matchPath("/push/key"), (route) =>
    route.fulfill({ json: { publicKey: newKey } }),
  );
  const answerUnavailable = (/** @type {import("@playwright/test").Route} */ route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          json: { error: { code: "unavailable", message: "The store is busy." } },
        })
      : route.fallback();
  await page.route(matchPath("/push/subscription"), answerUnavailable);
  const failedSave = page.waitForResponse(
    (response) => response.url().endsWith("/push/subscription") && response.status() === 503,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await failedSave;

  await page.unroute(matchPath("/push/subscription"), answerUnavailable);
  const save = page.waitForResponse(
    (response) =>
      response.url().endsWith("/push/subscription") && response.request().method() === "PUT",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await save).status()).toBe(204);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
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

  await expect(page.locator("#notifyNote")).toHaveText(
    "Apple only supports notifications from sites saved to your home screen. To configure notifications, add this site to your home screen.",
  );
  await expect(page.getByRole("switch", { name: "Notifications" })).toBeHidden();
});
