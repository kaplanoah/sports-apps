// Device push categories and reminder timing in Settings, with inline permission guidance.
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from "./notification-preferences.js";
import { readStoredJson, storeJson, forgetStored } from "./local-storage.js";
import { readDeviceTimeZone } from "./days.js";
import { reloadWhenSignedOut } from "./access.js";

import { isIos, isOnHomeScreen } from "./device.js";
import { isAskingToAdd, openWelcome } from "./home-screen.js";
import { html, setHtml } from "./html.js";
import { renderNotificationRows } from "./notifications-view.js";
import {
  CHANGE_FAILED,
  PENDING_SPINNER_MS,
  chooseDeniedStatus,
  chooseFailedSyncStatus,
  chooseNotifyNote,
  chooseNotificationControls,
  isTurnedAway,
  splitAtLastWord,
  TOO_MANY_DEVICES,
} from "./notification-status.js";
import { registerServiceWorker } from "./service-worker.js";
import { readWorkerError } from "./worker-error.js";

// Phosphor's question, at its Regular weight.
const HELP_BUTTON = html`<button type="button" class="notify-help" aria-label="How to get notifications"><svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M140,180a12,12,0,1,1-12-12A12,12,0,0,1,140,180ZM128,72c-22.06,0-40,16.15-40,36v4a8,8,0,0,0,16,0v-4c0-11,10.77-20,24-20s24,9,24,20-10.77,20-24,20a8,8,0,0,0-8,8v8a8,8,0,0,0,16,0v-.72c18.24-3.35,32-17.9,32-35.28C168,88.15,150.06,72,128,72Zm104,56A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg></button>`;

let registration = null;
let subscription = null;
let status = "loading";
let note = "";
/** @type {import("./notifications-view.js").NotePlace} */
let notePlace = "notify";
/** @type {Pick<import("./league-words.js").LeagueWords, "notificationUpdates" | "reminderTiming" | "reminderAtStart">} */
let notificationWords;
let preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
let revision = 0;
const PREFERENCES_KEY = "device-notifications";
const PREVIOUS_KEY = "previous-push-subscription";
const PENDING_KEY = "pending-push-preferences";
let isBusy = false;
/** @type {import("./notification-status.js").PendingCategory | null} */
let pending = null;
let reading = null;
/** @type {number | null} */
let requestedMinutes = null;
/** @type {Promise<void> | null} */
let savingTiming = null;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

export const canPush = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const readNoteDevice = () => ({
  isIos: isIos(),
  isOnHomeScreen: isOnHomeScreen(),
  canOpenWelcome: isAskingToAdd(),
});

function renderNote() {
  const { text, hasHelp } = chooseNotifyNote({ status, message: note, device: readNoteDevice() });
  if (!hasHelp) return text;
  const [lead, lastWord] = splitAtLastWord(text);
  return html`${lead}<span class="notify-help-end">${lastWord}${HELP_BUTTON}</span>`;
}

// The group is drawn whole, so a reload puts it back as it was before the status is known again.
function renderNotifications() {
  if (!notificationWords) return;
  const controls = chooseNotificationControls({
    status,
    isBusy,
    preferences,
    pending,
    timingMinutes: requestedMinutes,
  });
  const group = findElement("notificationsGroup");
  setHtml(
    group,
    renderNotificationRows({ controls, words: notificationWords, note: renderNote(), notePlace }),
  );
  group.hidden = status === "loading";
}

/** @param {string} next @param {string} [message] @param {import("./notifications-view.js").NotePlace} [place] */
function setStatus(next, message = "", place = "notify") {
  status = next;
  note = message;
  notePlace = place;
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

async function saveSubscription(
  current,
  initialPreferences = undefined,
  previousSubscription = undefined,
) {
  await requestPush("push/subscription", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...current.toJSON(),
      preferences: initialPreferences,
      previousSubscription,
    }),
  });
}

// A device the Worker turns away never gets a message, so the browser doesn't keep it either, and
// the switch shows it off, now and on the next visit. A save that fails any other way keeps the
// subscription, which the next visit saves again.
async function saveOrForget(
  current,
  initialPreferences = undefined,
  previousSubscription = undefined,
) {
  try {
    await saveSubscription(current, initialPreferences, previousSubscription);
  } catch (error) {
    if (isTurnedAway(error)) {
      await current.unsubscribe().catch(() => {});
      subscription = null;
      forgetCategories(initialPreferences ?? preferences);
    }
    throw error;
  }
}

async function subscribe(
  publicKey,
  initialPreferences = undefined,
  previousSubscription = undefined,
) {
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(publicKey),
  });
  await saveOrForget(subscription, initialPreferences, previousSubscription);
  await readPreferences();
}

// Saving again on every visit restores a subscription the Worker lost, and keeps a full Worker
// from making room by retiring this device. A new signing key needs a new subscription, in place
// of the old one, which the Worker would otherwise keep sending to.
async function syncSubscription() {
  const publicKey = await fetchPublicKey();
  const subscribedKey = subscription.options.applicationServerKey;
  if (subscribedKey && encodeBase64Url(subscribedKey) !== publicKey) {
    const previousSubscription = subscription.toJSON();
    await subscription.unsubscribe();
    subscription = null;
    storeJson(PREVIOUS_KEY, previousSubscription);
    await subscribe(publicKey, undefined, previousSubscription);
    forgetStored(PREVIOUS_KEY);
    return;
  }
  const pendingPreferences = readStoredJson(PENDING_KEY);
  await saveOrForget(
    subscription,
    pendingPreferences ? normalizeNotificationPreferences(pendingPreferences) : undefined,
    readStoredJson(PREVIOUS_KEY) ?? undefined,
  );
  forgetStored(PREVIOUS_KEY);
  await readPreferences();
}

/** @param {unknown} error */
function showFailedSync(error) {
  const shown = chooseFailedSyncStatus(error, !!subscription);
  if (shown) setStatus(shown.status, shown.note);
}

function restoreControlFocus(id) {
  if (!id) return;
  // Focusing an iPhone select can reopen or dismiss its native picker.
  if (id === "reminderTiming" && !document.body.classList.contains("kbd")) return;
  const dialog = findElement("settingsDialog");
  const hasFocusMoved =
    document.activeElement !== document.body && document.activeElement !== dialog;
  if (!hasFocusMoved && dialog.hasAttribute("open"))
    findElement(id)?.focus({ preventScroll: true });
}

/** @param {() => Promise<void>} task @param {import("./notification-status.js").PendingCategory | null} [intent] */
async function showBusyDuring(task, intent = null) {
  const focused = document.activeElement;
  const focusedId = findElement("notificationsGroup").contains(focused) ? focused?.id : null;
  isBusy = true;
  pending = intent;
  const indicator =
    intent &&
    setTimeout(() => {
      intent.elapsedMs = PENDING_SPINNER_MS;
      renderNotifications();
    }, PENDING_SPINNER_MS);
  renderNotifications();
  try {
    await task();
  } finally {
    if (indicator) clearTimeout(indicator);
    pending = null;
    isBusy = false;
    renderNotifications();
    restoreControlFocus(focusedId);
  }
}

async function readPreferences() {
  const result = await requestPush("push/preferences", {
    ...sendEndpoint("POST", subscription.endpoint),
    body: JSON.stringify(subscription.toJSON()),
  });
  rememberPreferences(result.preferences);
  revision = result.revision;
  forgetStored(PENDING_KEY);
  const timeZone = readDeviceTimeZone();
  if (preferences.timeZone !== timeZone) await savePreferences({ ...preferences, timeZone });
  renderNotifications();
}

async function savePreferences(next) {
  const result = await requestPush("push/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...subscription.toJSON(), preferences: next, revision }),
  });
  rememberPreferences(result.preferences);
  revision = result.revision;
}

function rememberPreferences(next) {
  preferences = normalizeNotificationPreferences(next);
  storeJson(PREFERENCES_KEY, preferences);
}

function forgetCategories(next) {
  rememberPreferences({ ...next, updates: false, reminders: false });
  forgetStored(PENDING_KEY);
}

async function saveOrRestorePreferences(next) {
  try {
    await savePreferences(next);
  } catch (error) {
    if (!isSubscriptionMissing(error)) throw error;
    storeJson(PENDING_KEY, next);
    await saveOrForget(subscription, next, readStoredJson(PREVIOUS_KEY) ?? undefined);
    forgetStored(PREVIOUS_KEY);
    await readPreferences();
    if (Object.keys(next).some((key) => next[key] !== preferences[key]))
      throw Object.assign(new Error("Notifications changed. Try again."), { code: "conflict" });
  }
}

/** @param {unknown} error */
const isSubscriptionMissing = (error) =>
  /** @type {{ code?: string }} */ (error)?.code === "not_found";

async function removeSubscription(next) {
  try {
    await savePreferences(next);
    await requestPush("push/subscription", sendEndpoint("DELETE", subscription.endpoint));
  } catch (error) {
    if (!isSubscriptionMissing(error)) throw error;
  }
  storeJson(PREVIOUS_KEY, subscription.toJSON());
  await subscription.unsubscribe();
  subscription = null;
  forgetCategories(next);
}

/**
 * @param {"updates" | "reminders"} category
 * @param {boolean} isEnabled
 * @param {{ minutes?: number, place?: import("./notifications-view.js").NotePlace }} [request]
 */
async function changeCategory(category, isEnabled, request = {}) {
  const { minutes = preferences.minutes, place = category === "updates" ? "notify" : "reminders" } =
    request;
  const before = preferences;
  const previousStatus = status;
  const next = { ...before, minutes, [category]: isEnabled, timeZone: readDeviceTimeZone() };
  try {
    // Keep permission in the tap stack, before registration or network work.
    if (isEnabled && (await Notification.requestPermission()) !== "granted") {
      const denied = chooseDeniedStatus({
        previousStatus,
        permission: Notification.permission,
        device: readNoteDevice(),
      });
      setStatus(denied.status, denied.note);
      return;
    }
    await readSubscriptionOnce();
    if (!registration) return;
    if (next.updates || next.reminders) {
      if (!subscription) {
        storeJson(PENDING_KEY, next);
        await subscribe(await fetchPublicKey(), next, readStoredJson(PREVIOUS_KEY) ?? undefined);
        forgetStored(PREVIOUS_KEY);
      }
      await saveOrRestorePreferences(next);
      setStatus("on");
    } else {
      await removeSubscription(next);
      setStatus("off");
    }
  } catch (error) {
    if (isTurnedAway(error)) setStatus("off", TOO_MANY_DEVICES, place);
    else {
      preferences = before;
      if (subscription) await readPreferences().catch(() => {});
      setStatus(subscription ? "on" : "failed", CHANGE_FAILED, place);
    }
  }
}

function toggleCategory(category) {
  const controls = chooseNotificationControls({ status, isBusy, preferences, pending });
  const isEnabled = !(category === "updates" ? controls.areUpdatesOn : controls.areRemindersOn);
  showBusyDuring(() => changeCategory(category, isEnabled), {
    category,
    isEnabled,
    elapsedMs: 0,
  });
}

/** @param {Event} event */
function toggleNotifications(event) {
  if (isBusy) return;
  const target = /** @type {Element} */ (event.target);
  if (target.closest("#notifySwitch")) toggleCategory("updates");
  if (target.closest("#remindersSwitch")) toggleCategory("reminders");
}

async function saveRequestedTiming() {
  while (requestedMinutes !== null) {
    const minutes = requestedMinutes;
    const next = { ...preferences, minutes, timeZone: readDeviceTimeZone() };
    try {
      await saveOrRestorePreferences(next);
      note = "";
    } catch (error) {
      if (isTurnedAway(error)) {
        requestedMinutes = null;
        setStatus("off", TOO_MANY_DEVICES, "reminderTiming");
        return;
      }
      await readPreferences().catch(() => {});
      note = CHANGE_FAILED;
      notePlace = "reminderTiming";
    }
    if (requestedMinutes === minutes) requestedMinutes = null;
  }
}

async function changeTiming() {
  if (isBusy && !savingTiming) return;
  const timing = /** @type {HTMLSelectElement} */ (findElement("reminderTiming"));
  const minutes = Number(timing.value);
  const controls = chooseNotificationControls({ status, isBusy, preferences, pending });
  if (!controls.areRemindersOn) {
    await showBusyDuring(
      () => changeCategory("reminders", true, { minutes, place: "reminderTiming" }),
      {
        category: "reminders",
        isEnabled: true,
        elapsedMs: 0,
        minutes,
      },
    );
    return;
  }
  requestedMinutes = minutes;
  if (savingTiming) {
    renderNotifications();
    return;
  }
  savingTiming = showBusyDuring(saveRequestedTiming);
  try {
    await savingTiming;
  } finally {
    savingTiming = null;
  }
}

/** @param {Event} event */
function openHomeScreenSteps(event) {
  if (/** @type {Element} */ (event.target).closest(".notify-help")) openWelcome();
}

function describeStartStatus() {
  if (Notification.permission === "denied") return "blocked";
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

async function readSubscription() {
  try {
    registration = await registerServiceWorker();
    subscription = await registration.pushManager.getSubscription();
  } catch {
    registration = null;
  }
}

// A tap on the Updates box's ask can come before settings starts the switch, so both wait on the
// one read.
const readSubscriptionOnce = () => (reading ??= readSubscription());

/** Turns notifications on from a tap elsewhere on the page, as the switch does. */
export function turnOnNotifications() {
  const controls = chooseNotificationControls({ status, isBusy, preferences, pending });
  if (!isBusy && !controls.areUpdatesOn) toggleCategory("updates");
}

/** Whether this device is subscribed to the Worker's pushes, once that's known. */
export async function hasNotificationsSubscription() {
  if (!canPush()) return false;
  await readSubscriptionOnce();
  return !!subscription && Notification.permission === "granted";
}

/**
 * @param {Pick<import("./league-words.js").LeagueWords, "notificationUpdates" | "reminderTiming" | "reminderAtStart">} words
 */
export async function startNotifications(words) {
  notificationWords = words;
  preferences = normalizeNotificationPreferences({
    ...readStoredJson(PREFERENCES_KEY),
    updates: false,
    reminders: false,
  });
  findElement("notificationsGroup").addEventListener("click", toggleNotifications);
  findElement("notificationsGroup").addEventListener("click", openHomeScreenSteps);
  findElement("notificationsGroup").addEventListener("change", changeTiming);
  if (!canPush()) {
    setStatus(isIos() && !isOnHomeScreen() ? "homeScreen" : "unsupported");
    return;
  }
  await readSubscriptionOnce();
  if (!registration) {
    setStatus("unsupported");
    return;
  }
  if (subscription) {
    preferences = normalizeNotificationPreferences(
      readStoredJson(PREFERENCES_KEY) ?? {
        ...preferences,
        updates: true,
        reminders: false,
      },
    );
    try {
      await syncSubscription();
      note = "";
    } catch (error) {
      showFailedSync(error);
      if (note) return;
    }
  }
  if (note) renderNotifications();
  else setStatus(describeStartStatus());
}
