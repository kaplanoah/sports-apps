import { isTimeZone } from "./days.js";
// Device push categories and the timing presets shared by settings and the private push API.
export const REMINDER_PRESETS = [0, 10, 30, 60, 180];

/** @param {number} minutes @param {Pick<import("./league-words.js").LeagueWords, "reminderAtStart">} words */
export function nameReminderPreset(minutes, words) {
  if (minutes === 0) return words.reminderAtStart;
  return minutes < 60
    ? `${minutes} minutes before`
    : `${minutes / 60} ${minutes === 60 ? "hour" : "hours"} before`;
}

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
  REMINDER_PRESETS.includes(value.minutes) &&
  isTimeZone(value.timeZone);

/** @param {any} value */
export function normalizeNotificationPreferences(value) {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...value };
  if (!REMINDER_PRESETS.includes(preferences.minutes))
    preferences.minutes = DEFAULT_NOTIFICATION_PREFERENCES.minutes;
  return preferences;
}

/** @param {any} device */
export const readNotificationPreferences = (device) =>
  normalizeNotificationPreferences(
    device.preferences ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, updates: true },
  );
