// What the settings panel's notifications switch shows once saving this device's subscription to
// the Worker fails.

export const TOO_MANY_DEVICES = "Too many devices get notifications already";

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
