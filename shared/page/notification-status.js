// Permission guidance and category controls for this device's notification settings.

export const PENDING_SPINNER_MS = 700;

export const CATEGORIES = /** @type {const} */ (["updates", "reminders"]);

export const TOO_MANY_DEVICES = "Too many devices get notifications already";
export const CHANGE_FAILED = "Couldn't update notifications. Try again in a moment.";

const NOTES = {
  blockedOnIos:
    "Notifications are blocked for this page. Turn them on in Settings > Notifications.",
  blockedInBrowser:
    "Notifications are blocked for this page. Turn them on in the browser's site settings, from the icon beside the address.",
  homeScreen:
    "Apple only supports notifications from sites saved to your home screen. To configure notifications, add this site to your home screen.",
  unsupportedInBrowser:
    "This browser can't show notifications. Try another browser or a window that isn't private.",
  unsupportedOnHomeScreen: "This browser can't show notifications",
  failed: CHANGE_FAILED,
};

/**
 * @typedef {{ isIos: boolean, isOnHomeScreen: boolean, canOpenWelcome: boolean }} NoteDevice
 */

// iOS keeps a Home Screen page's permission in its Settings app; other browsers keep it per site.
// A Home Screen app has no other browser or private window to try.
/**
 * @param {string} status
 * @param {NoteDevice} device
 * @returns {string | undefined}
 */
function describeStatus(status, device) {
  if (status === "blocked") return device.isIos ? NOTES.blockedOnIos : NOTES.blockedInBrowser;
  if (status === "unsupported")
    return device.isOnHomeScreen ? NOTES.unsupportedOnHomeScreen : NOTES.unsupportedInBrowser;
  return NOTES[/** @type {keyof typeof NOTES} */ (status)];
}

/**
 * The note under the control a save answers, else under the updates label: a message it was
 * given, else what its status says. Where notifications come only from the Home Screen, its ?
 * opens the welcome's steps.
 * @param {{ status: string, message: string, device: NoteDevice }} state
 * @returns {{ text: string, hasHelp: boolean }}
 */
export const chooseNotifyNote = ({ status, message, device }) => ({
  text: message || describeStatus(status, device) || "",
  hasHelp: status === "homeScreen" && device.canOpenWelcome,
});

/**
 * The text before its last word, and the last word, which the ? keeps to, so it never wraps onto
 * a line of its own.
 * @param {string} text
 * @returns {[string, string]}
 */
export function splitAtLastWord(text) {
  const lastWordAt = text.lastIndexOf(" ") + 1;
  return [text.slice(0, lastWordAt), text.slice(lastWordAt)];
}

/**
 * Whether the Worker turned this device away, having no room for another.
 * @param {unknown} error
 */
export const isTurnedAway = (error) =>
  /** @type {{ code?: string } | undefined} */ (error)?.code === "too_many_devices";

/**
 * What a visit's failed save shows: the switch off, saying why, for a device the Worker turned
 * away, and off for one the browser no longer holds. Any other failure leaves the switch as it is,
 * since the browser keeps the subscription and the next visit saves it again.
 * @param {unknown} error
 * @param {boolean} isSubscribed whether the browser still holds a subscription
 * @returns {{ status: "off", note: string } | null} null to leave the switch as it is
 */
export function chooseFailedSyncStatus(error, isSubscribed) {
  if (isTurnedAway(error)) return { status: "off", note: TOO_MANY_DEVICES };
  return isSubscribed ? null : { status: "off", note: "" };
}

/** @param {{ previousStatus: string, permission: string, device: NoteDevice }} state */
export function chooseDeniedStatus({ previousStatus, permission, device }) {
  const deniedStatus = permission === "denied" ? "blocked" : "off";
  return {
    status: previousStatus === "on" ? previousStatus : deniedStatus,
    note: chooseNotifyNote({ status: deniedStatus, message: "", device }).text,
  };
}

/**
 * The choices a viewer made that aren't saved yet, which the controls show at once.
 * @typedef {{ updates?: boolean, reminders?: boolean, minutes?: number }} WantedChoices
 */

/**
 * The controls show each choice not yet saved over the saved one, and stay live while saves run,
 * so a viewer can change their mind at once. A category waiting on its save is busy, and shows a
 * spinner once saving runs slow.
 * @param {{ status: string, preferences: { updates: boolean, reminders: boolean, minutes?: number }, wanted?: WantedChoices, isSlow?: boolean }} state
 */
export function chooseNotificationControls({ status, preferences, wanted = {}, isSlow = false }) {
  const isOn = status === "on";
  const busyCategories = CATEGORIES.filter((category) => wanted[category] !== undefined);
  return {
    areSwitchesHidden: !["off", "on", "failed", "blocked"].includes(status),
    areSwitchesDisabled: status === "blocked",
    areUpdatesOn: wanted.updates ?? (isOn && preferences.updates),
    areRemindersOn: wanted.reminders ?? (isOn && preferences.reminders),
    busyCategories,
    spinnerCategories: isSlow ? busyCategories : [],
    isTimingDisabled: !["off", "on", "failed"].includes(status),
    timingMinutes: wanted.minutes ?? preferences.minutes,
  };
}
