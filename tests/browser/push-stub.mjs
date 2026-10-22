// Stand-ins for the browser's permission prompt and push service, for the tests that subscribe.

export const PUSH_STUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-device",
  keptKey: "test-push-subscription",
  nextEndpointKey: "test-next-endpoint",
};

// Headless Chromium has no push service, and its headless shell denies notifications outright,
// so the permission prompt and the subscription are stand-ins. The subscription has real keys,
// which is all the Worker needs. Both last through a reload, as the browser's do. A test can name
// the endpoint the next subscription gets, as a push service hands out a new one.
export function stubPushManager({ endpoint, keptKey, nextEndpointKey }) {
  const PERMISSION_KEY = "test-notification-permission";
  Object.defineProperty(Notification, "permission", {
    get: () => sessionStorage.getItem(PERMISSION_KEY) ?? "default",
  });
  Notification.requestPermission = async () => {
    sessionStorage.setItem(PERMISSION_KEY, "granted");
    return "granted";
  };
  /** @returns {any} a stand-in for the browser's PushSubscription */
  const describeSubscription = (kept) => ({
    endpoint: kept.endpoint,
    options: { applicationServerKey: Uint8Array.from(kept.serverKey) },
    toJSON: () => ({ endpoint: kept.endpoint, keys: kept.keys }),
    unsubscribe: async () => {
      sessionStorage.removeItem(keptKey);
      return true;
    },
  });
  const encode = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  PushManager.prototype.getSubscription = async () => {
    const kept = sessionStorage.getItem(keptKey);
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
    const kept = {
      endpoint: sessionStorage.getItem(nextEndpointKey) ?? endpoint,
      keys,
      serverKey: [...new Uint8Array(serverKey)],
    };
    sessionStorage.setItem(keptKey, JSON.stringify(kept));
    return describeSubscription(kept);
  };
}
