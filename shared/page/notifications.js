// The settings panel's notifications switch: subscribes this device to the Worker's pushes. The
// note under it says what the app's notifications tell, or why the switch can't do its job, and,
// where they come only from the Home Screen, ends, wherever the page asks to be added there, with a
// ? that opens the welcome's steps.
import { reloadWhenSignedOut } from "./access.js";

import { isIos, isOnHomeScreen } from "./device.js";
import { isAskingToAdd, openWelcome } from "./home-screen.js";
import { html, setHtml } from "./html.js";
import {
  CHANGE_FAILED,
  chooseFailedSyncStatus,
  chooseNotifyNote,
  isTurnedAway,
  splitAtLastWord,
  TOO_MANY_DEVICES,
} from "./notification-status.js";
import { registerServiceWorker } from "./service-worker.js";
import { readWorkerError } from "./worker-error.js";

// Phosphor's question, at its Regular weight.
const HELP_BUTTON = html`<button type="button" class="notify-help" aria-label="How to get notifications"><svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M140,180a12,12,0,1,1-12-12A12,12,0,0,1,140,180ZM128,72c-22.06,0-40,16.15-40,36v4a8,8,0,0,0,16,0v-4c0-11,10.77-20,24-20s24,9,24,20-10.77,20-24,20a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-.72c18.24-3.35,32-17.9,32-35.28C168,88.15,150.06,72,128,72Zm104,56A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg></button>`;

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

function renderNote() {
  const device = {
    isIos: isIos(),
    isOnHomeScreen: isOnHomeScreen(),
    canOpenWelcome: isAskingToAdd(),
  };
  const { text, hasHelp } = chooseNotifyNote({ status, message: note, about, device });
  if (!hasHelp) return text;
  const [lead, lastWord] = splitAtLastWord(text);
  return html`${lead}<span class="notify-help-end">${lastWord}${HELP_BUTTON}</span>`;
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
        <span class="control-note" id="notifyNote" role="status">${renderNote()}</span>
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

// Saving again on every visit restores a subscription the Worker lost, and keeps a full Worker
// from making room by forgetting this device. A new signing key needs a new subscription.
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
    if (isTurnedAway(error)) setStatus("off", TOO_MANY_DEVICES);
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
    setStatus("on", CHANGE_FAILED);
  }
}

/** @param {Event} event */
function toggleNotifications(event) {
  if (isBusy || !(/** @type {Element} */ (event.target).closest("#notifySwitch"))) return;
  showBusyDuring(status === "on" ? turnOff : turnOn);
}

/** @param {Event} event */
function openHomeScreenSteps(event) {
  if (/** @type {Element} */ (event.target).closest(".notify-help")) openWelcome();
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
  findElement("notifyRow").addEventListener("click", openHomeScreenSteps);
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
