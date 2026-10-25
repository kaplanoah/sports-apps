// The service worker every app's sw.js loads: it shows the Worker's push messages, and opens the
// page when one is tapped. Every push shows a notification, because iOS stops delivering to a page
// whose pushes show nothing, so a message that can't be read shows the app's sw.js `pageName`.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readMessage(data) {
  try {
    return data ? data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title || self.pageName, {
      body: message.body || "",
      tag: message.tag,
      data: readGameIntent(message),
      icon: "icon-180.png",
    }),
  );
});

function readGameIntent(message) {
  if (
    !/^\d{1,12}$/.test(String(message?.game ?? "")) ||
    !Number.isInteger(message?.season) ||
    message.season < 1900 ||
    message.season > 2200
  )
    return null;
  return { game: String(message.game), season: message.season };
}

async function openPageFromNotification(data) {
  const scope = self.registration.scope;
  const url = new URL(scope);
  const intent = readGameIntent(data);
  if (intent) {
    url.searchParams.set("game", intent.game);
    url.searchParams.set("season", String(intent.season));
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((client) => client.url.startsWith(scope));
  if (!open) return self.clients.openWindow(url.href);
  if (intent) await open.navigate(url.href);
  return open.focus();
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openPageFromNotification(event.notification.data));
});

async function requestPush(path, method, body) {
  const response = await fetch(new URL(path, self.registration.scope), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`The Worker answered ${response.status}`);
}

function decodeBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function fetchPublicKey() {
  const response = await fetch(new URL("push/key", self.registration.scope));
  return decodeBase64Url((await response.json()).publicKey);
}

async function subscribeAgain(oldSubscription) {
  const applicationServerKey =
    oldSubscription?.options.applicationServerKey ?? (await fetchPublicKey());
  return self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

async function replaceSubscription(oldSubscription, newSubscription) {
  const replacement = newSubscription ?? (await subscribeAgain(oldSubscription));
  await requestPush("push/subscription", "PUT", {
    ...replacement.toJSON(),
    previousSubscription: oldSubscription?.toJSON(),
  });
  if (oldSubscription && oldSubscription.endpoint !== replacement.endpoint)
    await requestPush("push/subscription", "DELETE", { endpoint: oldSubscription.endpoint });
}

// A browser can replace a subscription on its own, and the Worker would otherwise keep sending
// to the old one until the page is next opened. The old one goes only once the Worker has the new
// one, so a save that fails leaves the device subscribed where the Worker still sends.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(replaceSubscription(event.oldSubscription, event.newSubscription));
});
