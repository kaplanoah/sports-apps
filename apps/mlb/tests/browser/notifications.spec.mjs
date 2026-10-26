import { testGameReminderSettings } from "../../../../tests/browser/game-reminders.mjs";
import { IPHONE_AGENT, takeAwayPush } from "../../../../tests/browser/devices.mjs";
import { PUSH_STUB, stubPushManager } from "../../../../tests/browser/push-stub.mjs";
import { test, expect, matchPath, openApp, openLockedApp, openSettings } from "./harness.mjs";

// The switch subscribes through the page's service worker.
test.use({ serviceWorkers: "allow" });

const NEXT_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-device-next";

test("notifications can be turned on and off, with no note while the switch works", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, PUSH_STUB);
  const app = await openApp(page);
  await openSettings(page);

  const toggle = page.getByRole("switch", { name: "Game updates" });
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
  await page.addInitScript(stubPushManager, PUSH_STUB);
  const app = await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Game updates" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.evaluate(([{ keptKey, nextEndpointKey }, nextEndpoint]) => {
    const kept = JSON.parse(/** @type {string} */ (sessionStorage.getItem(keptKey)));
    sessionStorage.setItem(keptKey, JSON.stringify({ ...kept, serverKey: [1, 2, 3] }));
    sessionStorage.setItem(nextEndpointKey, nextEndpoint);
  }, /** @type {const} */ ([PUSH_STUB, NEXT_ENDPOINT]));
  const savingNext = page.waitForRequest(
    (request) => request.method() === "PUT" && !!request.postData()?.includes(NEXT_ENDPOINT),
  );

  await page.reload();
  await (await savingNext).response();

  expect(app.countSubscriptions()).toBe(1);
});

test("a device the Worker has no room for is left off, and is still off after a reload", async ({
  page,
}) => {
  await page.addInitScript(stubPushManager, PUSH_STUB);
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
  const toggle = page.getByRole("switch", { name: "Game updates" });

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
  await page.addInitScript(stubPushManager, PUSH_STUB);
  await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Game updates" });
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
  await page.addInitScript(stubPushManager, PUSH_STUB);
  await openApp(page);
  await openSettings(page);
  const toggle = page.getByRole("switch", { name: "Game updates" });
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
  await expect(page.getByRole("switch", { name: "Game updates" })).toBeDisabled();
});

test("on an iPhone, blocked notifications point to Settings", async ({ page }) => {
  await page.addInitScript((agent) => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Object.defineProperty(navigator, "userAgent", { get: () => agent });
  }, IPHONE_AGENT);
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/Turn them on in Settings > Notifications/);
  await expect(page.getByRole("switch", { name: "Game updates" })).toBeDisabled();
});

test("on an iPhone outside the Home Screen, the page says to add it there", async ({ page }) => {
  await takeAwayPush(page);
  await page.addInitScript((agent) => {
    Object.defineProperty(navigator, "userAgent", { get: () => agent });
  }, IPHONE_AGENT);
  await openApp(page);
  await openSettings(page);

  await expect(page.locator("#notifyNote")).toHaveText(/add this site to your home screen/);
  await expect(page.getByRole("switch", { name: "Game updates" })).toBeHidden();
});

testGameReminderSettings(test, expect, {
  openApp,
  openLockedApp,
  openSettings,
  timing: "Time before game",
  timingSize: 13,
  game: "824623",
  updates: "Game updates",
});
