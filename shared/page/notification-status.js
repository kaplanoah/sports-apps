// What the settings panel's notifications switch says under it, for its status and the device,
// and what it shows once saving this device's subscription to the Worker fails.

export const TOO_MANY_DEVICES = "Too many devices get notifications already";
export const CHANGE_FAILED = "Couldn't change notifications. Try again in a moment.";

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
 * The note under the switch: a message the switch was given, else what its status says, else what
 * the app's notifications tell. Where they come only from the Home Screen, it ends with a ? that
 * opens the welcome's steps, wherever the welcome can open.
 * @param {{ status: string, message: string, about: string, device: NoteDevice }} state
 * @returns {{ text: string, hasHelp: boolean }}
 */
export const chooseNotifyNote = ({ status, message, about, device }) => ({
  text: message || describeStatus(status, device) || about,
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
