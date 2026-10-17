// The settings panel's notifications switch: subscribes this device to the Worker's pushes. The
// note under it says what the app's notifications tell, or why the switch can't do its job.
import { reloadWhenSignedOut } from "./access.js";

import { isIos, isOnHomeScreen } from "./device.js";
import { html, setHtml } from "./html.js";
import { chooseFailedSyncStatus, isTurnedAway, TOO_MANY_DEVICES } from "./notification-status.js";
import { registerServiceWorker } from "./service-worker.js";
import { readWorkerError } from "./worker-error.js";

const NOTES = {
  blockedOnIos:
    "Notifications are blocked for this page. Turn them on in Settings > Notifications.",
  blockedInBrowser:
    "Notifications are blocked for this page. Turn them on in the browser's site settings, from the icon beside the address.",
  homeScreen:
    "To get notifications on an iPhone, add this page to your Home Screen and open it from there",
  unsupported: "This browser can't show notifications",
  failed: "Couldn't change notifications. Try again in a moment.",
  tooManyDevices: TOO_MANY_DEVICES,
};

const SWITCHABLE = new Set(["off", "on", "failed"]);

let registration = null;
let subscription = null;
let status = "loading";
let note = "";
let about = "";
let isBusy = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const canPush = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iOS keeps a Home Screen page's permission in its Settings app; other browsers keep it per site.
function describeStatus() {
  if (status === "blocked") return isIos() ? NOTES.blockedOnIos : NOTES.blockedInBrowser;
  return NOTES[status] ?? about;
}

// The row is drawn whole, so a reload puts it back as it was before the status is known again.
function renderNotifications() {
  const isSwitchHidden = !SWITCHABLE.has(status) && status !== "blocked";
  const isDisabled = isBusy || status === "blocked";
  const row = findElement("notifyRow");
  setHtml(
    row,
    html`<span class="control-label">
        <span id="notifyTitle">Notifications</span>
        <span class="control-note" id="notifyNote" role="status">${note || describeStatus()}</span>
      </span>
      <button type="button" role="switch" class="switch" id="notifySwitch" aria-checked="${String(status === "on")}" aria-labelledby="notifyTitle" ${isSwitchHidden ? "hidden" : ""} ${isDisabled ? "disabled" : ""}>
        <span class="switch-knob" aria-hidden="true"></span>
      </button>`,
  );
  row.hidden = status === "loading";
}

function setStatus(next, message = "") {
  status = next;
  note = message;
  renderNotifications();
}

function decodeBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The Worker's error, with the code it names.
 * @param {Response} response
 */
async function readPushFailure(response) {
  const body = await response.json().catch(() => null);
  const { code, message } = readWorkerError(body, response.status);
  return Object.assign(new Error(message), { code });
}

async function requestPush(path, init = {}) {
  const response = await fetch(new URL(path, location.href), { cache: "no-store", ...init });
  reloadWhenSignedOut(response);
  if (!response.ok) throw await readPushFailure(response);
  return response.status === 204 ? null : response.json();
}

const sendEndpoint = (method, endpoint) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ endpoint }),
});

async function fetchPublicKey() {
  const { publicKey } = await requestPush("push/key");
  return publicKey;
}

async function saveSubscription(current) {
  await requestPush("push/subscription", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(current.toJSON()),
  });
}

// A device the Worker turns away never gets a message, so the browser doesn't keep it either, and
// the switch shows it off, now and on the next visit. A save that fails any other way keeps the
// subscription, which the next visit saves again.
async function saveOrForget(current) {
  try {
    await saveSubscription(current);
  } catch (error) {
    if (isTurnedAway(error)) {
      await current.unsubscribe().catch(() => {});
      subscription = null;
    }
    throw error;
  }
}

async function subscribe(publicKey) {
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(publicKey),
  });
  await saveOrForget(subscription);
}

// Saving again on every visit restores a subscription the Worker lost, and a new signing key
// needs a new subscription.
async function syncSubscription() {
  const publicKey = await fetchPublicKey();
  const subscribedKey = subscription.options.applicationServerKey;
  if (subscribedKey && encodeBase64Url(subscribedKey) !== publicKey) {
    await subscription.unsubscribe();
    subscription = null;
    await subscribe(publicKey);
    return;
  }
  await saveOrForget(subscription);
}

/** @param {unknown} error */
function showFailedSync(error) {
  const shown = chooseFailedSyncStatus(error, !!subscription);
  if (shown) setStatus(shown.status, shown.note);
}

async function showBusyDuring(task) {
  isBusy = true;
  renderNotifications();
  try {
    await task();
  } finally {
    isBusy = false;
    renderNotifications();
  }
}

// iOS asks for permission only from a tap, so the request comes before anything is awaited.
async function turnOn() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setStatus(permission === "denied" ? "blocked" : "off");
    return;
  }
  try {
    await subscribe(await fetchPublicKey());
    setStatus("on");
  } catch (error) {
    if (isTurnedAway(error)) setStatus("off", NOTES.tooManyDevices);
    else setStatus("failed");
  }
}

async function turnOff() {
  try {
    await requestPush("push/subscription", sendEndpoint("DELETE", subscription.endpoint));
    await subscription.unsubscribe();
    subscription = null;
    setStatus("off");
  } catch {
    setStatus("on", NOTES.failed);
  }
}

/** @param {Event} event */
function toggleNotifications(event) {
  if (isBusy || !(/** @type {Element} */ (event.target).closest("#notifySwitch"))) return;
  showBusyDuring(status === "on" ? turnOff : turnOn);
}

function describeStartStatus() {
  if (Notification.permission === "denied") return "blocked";
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/**
 * @param {{ about?: string }} [options] what the app's notifications tell, under the switch while
 *   it works
 */
export async function startNotifications(options = {}) {
  about = options.about ?? "";
  findElement("notifyRow").addEventListener("click", toggleNotifications);
  if (!canPush()) {
    setStatus(isIos() && !isOnHomeScreen() ? "homeScreen" : "unsupported");
    return;
  }
  try {
    registration = await registerServiceWorker();
    subscription = await registration.pushManager.getSubscription();
  } catch {
    setStatus("unsupported");
    return;
  }
  setStatus(describeStartStatus());
  if (status === "on") syncSubscription().catch(showFailedSync);
}
