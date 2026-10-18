// What the settings panel's notifications switch shows once saving this device's subscription to
// the Worker fails.

/**
 * What a visit's failed save shows: the switch off for a device the browser no longer holds. Any
 * other failure leaves the switch as it is, since the browser keeps the subscription and the next
 * visit saves it again.
 * @param {boolean} isSubscribed whether the browser still holds a subscription
 * @returns {"off" | null} null to leave the switch as it is
 */
export const chooseFailedSyncStatus = (isSubscribed) => (isSubscribed ? null : "off");
