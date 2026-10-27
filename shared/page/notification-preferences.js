import { isTimeZone } from "./days.js";
// Device push categories and the timing presets shared by settings and the private push API.
export const REMINDER_PRESETS = [
  { minutes: 0, label: "" },
  { minutes: 10, label: "10 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 180, label: "3 hours before" },
];

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  updates: false,
  reminders: false,
  minutes: 10,
  timeZone: "America/New_York",
};

/** @param {any} value */
export const isNotificationPreferences = (value) =>
  !!value &&
  typeof value.updates === "boolean" &&
  typeof value.reminders === "boolean" &&
  REMINDER_PRESETS.some(({ minutes }) => minutes === value.minutes) &&
  isTimeZone(value.timeZone);

/** @param {any} value */
export function normalizeNotificationPreferences(value) {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...value };
  if (!REMINDER_PRESETS.some(({ minutes }) => minutes === preferences.minutes))
    preferences.minutes = DEFAULT_NOTIFICATION_PREFERENCES.minutes;
  return preferences;
}

/** @param {any} device */
export const readNotificationPreferences = (device) =>
  normalizeNotificationPreferences(
    device.preferences ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, updates: true },
  );
