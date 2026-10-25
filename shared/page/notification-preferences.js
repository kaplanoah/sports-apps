import { isTimeZone } from "./days.js";
// Device push categories and the timing presets shared by settings and the private push API.
export const REMINDER_PRESETS = [
  { minutes: 0, label: "At start" },
  { minutes: 5, label: "5 minutes before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
];

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  updates: false,
  reminders: false,
  minutes: 15,
  timeZone: "America/New_York",
};

/** @param {any} value */
export const isNotificationPreferences = (value) =>
  !!value &&
  typeof value.updates === "boolean" &&
  typeof value.reminders === "boolean" &&
  REMINDER_PRESETS.some(({ minutes }) => minutes === value.minutes) &&
  isTimeZone(value.timeZone);

/** @param {any} device */
export const readNotificationPreferences = (device) =>
  device.preferences ?? { ...DEFAULT_NOTIFICATION_PREFERENCES, updates: true };
