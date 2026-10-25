// Days and times on the viewer's own calendar and clock, and a league's own day, which is Eastern.
// A league's day, written "YYYY-MM-DD", is a date on a calendar, not an instant, so it's read as one.

import { capitalize } from "./html.js";

const MS_PER_DAY = 86400000;

const EASTERN_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

// The pages' sentences are English, so the words for near days are too, whatever the browser's
// language. Weekdays and dates follow the viewer's locale.
const NEAR_DAY_WORDS = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const NEAR_DAYS = [-1, 0, 1];

/** @param {Date} date */
const readStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A "YYYY-MM-DD" date's year, month from 1, and day.
 * @param {string} date
 */
const readDateParts = (date) => date.split("-").map(Number);

/**
 * The league's day of an instant, as "YYYY-MM-DD", with its hour and year on the Eastern clock.
 * @param {number} ms
 */
export function readEasternDay(ms) {
  const parts = Object.fromEntries(
    EASTERN_PARTS.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    year: Number(parts.year),
  };
}

/**
 * The "YYYY-MM-DD" date some whole days after another, or before it when `days` is negative.
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  const [year, month, day] = readDateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * Midnight of a "YYYY-MM-DD" date on the viewer's calendar.
 * @param {string} date
 */
export function readCalendarDate(date) {
  const [year, month, day] = readDateParts(date);
  return new Date(year, month - 1, day);
}

/**
 * The day of the month of a "YYYY-MM-DD" date.
 * @param {string} date
 */
export const readDayOfMonth = (date) => readDateParts(date)[2];

/**
 * The weekday of a "YYYY-MM-DD" date, 0 for Sunday.
 * @param {string} date
 */
export function readWeekday(date) {
  const [year, month, day] = readDateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Whether two "YYYY-MM-DD" dates fall in the same month of the same year.
 * @param {string} first
 * @param {string} second
 */
export const isSameMonth = (first, second) => first.slice(0, 7) === second.slice(0, 7);

/**
 * How many days a month has.
 * @param {number} month 1 to 12
 * @param {number} year
 */
export const countDaysInMonth = (month, year) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The month some whole months after a "YYYY-MM-DD" date's, or before it when `months` is negative.
 * @param {string} date
 * @param {number} months
 */
export function shiftMonth(date, months) {
  const [year, month] = readDateParts(date);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return { month: shifted.getUTCMonth() + 1, year: shifted.getUTCFullYear() };
}

// Making a formatter takes far longer than using one, and a search reads every game's start on
// each key press, so each zone's clock is made once.
/** @type {Map<string, Intl.DateTimeFormat>} */
const zoneClocks = new Map();

/** @param {string} timeZone */
function readZoneClock(timeZone) {
  const kept = zoneClocks.get(timeZone);
  if (kept) return kept;
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone,
  });
  zoneClocks.set(timeZone, clock);
  return clock;
}

/**
 * A moment's minutes after midnight on the viewer's clock, or on another zone's.
 * @param {Date} moment
 * @param {string} [timeZone]
 */
export function readMinutesIntoDay(moment, timeZone) {
  if (!timeZone) return moment.getHours() * 60 + moment.getMinutes();
  const parts = readZoneClock(timeZone).formatToParts(moment);
  const read = (/** @type {string} */ type) =>
    Number(parts.find((part) => part.type === type)?.value);
  return read("hour") * 60 + read("minute");
}

/**
 * The "YYYY-MM-DD" date of a moment on the viewer's calendar.
 * @param {Date} moment
 */
export const formatCalendarDate = (moment) =>
  [
    moment.getFullYear(),
    String(moment.getMonth() + 1).padStart(2, "0"),
    String(moment.getDate()).padStart(2, "0"),
  ].join("-");

/**
 * The day of a list of days, in order, that's `wanted`, or the nearest after it, or the last.
 * @param {{ day: string }[]} days "YYYY-MM-DD" days, in order
 * @param {string} wanted a "YYYY-MM-DD" day
 */
export const chooseListedDay = (days, wanted) =>
  (days.find(({ day }) => day >= wanted) ?? days[days.length - 1])?.day ?? wanted;

/**
 * Whole days from one date's calendar day to another's, negative when the second comes first.
 * Rounding absorbs the hour a daylight saving change adds or takes away.
 * @param {Date} earlier
 * @param {Date} later
 */
export const countDaysBetween = (earlier, later) =>
  Math.round((readStartOfDay(later).getTime() - readStartOfDay(earlier).getTime()) / MS_PER_DAY);

/**
 * Whether a game is still to come today, which a page sets apart as it does one being played.
 * @param {{ state: string, day: Date | null }} game
 * @param {Date} now
 */
export const isStillToComeToday = ({ state, day }, now) =>
  state === "pre" && day !== null && countDaysBetween(now, day) === 0;

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start or a
 * league's day. Until its time is set, a game's start is a placeholder that can fall on another
 * day where the viewer is, so the league's day stands in for it.
 * @param {{ start?: string | null, isTimeSet: boolean, leagueDate?: string | null }} game
 */
export function readPlayingDay({ start, isTimeSet, leagueDate }) {
  const startMs = Date.parse(start ?? "");
  const hasStart = Number.isFinite(startMs);
  if (leagueDate && !(isTimeSet && hasStart)) return readCalendarDate(leagueDate);
  return hasStart ? readStartOfDay(new Date(startMs)) : null;
}

/** @param {Date} date */
export const formatClockTime = (date) =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** @param {Date} date */
export const formatClockTimeWithSeconds = (date) =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * A clock time without its AM or PM, for where the time of day goes without saying.
 * @param {Date} date
 */
export const formatClockTimeWithoutMeridiem = (date) =>
  new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .filter(({ type }) => type !== "dayPeriod")
    .map(({ value }) => value)
    .join("")
    .trim();

/**
 * A time of day given in minutes after midnight, as "9 PM", or "9:30 PM" off the hour.
 * @param {number} minutes
 */
export function formatMinutesIntoDay(minutes) {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  const options = minutes % 60 ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" };
  return date.toLocaleTimeString([], /** @type {Intl.DateTimeFormatOptions} */ (options));
}

/**
 * A moment's date and clock time, naming its year only when it isn't the year of `now`.
 * @param {Date} moment
 * @param {Date} now
 */
export const formatDateAndTime = (moment, now) =>
  moment.toLocaleString([], {
    year: moment.getFullYear() === now.getFullYear() ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** @param {Date} date */
export const formatShortDate = (date) =>
  date.toLocaleDateString([], { month: "short", day: "numeric" });

/** @param {Date} date */
export const formatShortMonth = (date) => date.toLocaleDateString([], { month: "short" });

/** @param {Date} date */
export const formatMonth = (date) => date.toLocaleDateString([], { month: "long" });

/** @param {Date} date */
export const formatLongDate = (date) =>
  date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

/** @param {Date} date */
export const formatWeekday = (date) => date.toLocaleDateString([], { weekday: "long" });

/** @param {Date} date */
export const formatShortWeekday = (date) => date.toLocaleDateString([], { weekday: "short" });

/** @param {Date} date */
export const formatWeekdayAndDate = (date) =>
  date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/**
 * A day's weekday within a week of now either way, and its short date further off.
 * @param {Date} date
 * @param {number} daysAway whole days from now, negative for a day gone by
 */
export const formatWeekdayOrDate = (date, daysAway) =>
  Math.abs(daysAway) < 7 ? formatWeekday(date) : formatShortDate(date);

/**
 * A day as the viewer would say it from now: "yesterday", "today", or "tomorrow" when it's one of
 * `nearDays`, and whatever `nameOtherDay` calls it otherwise.
 * @param {Date} date
 * @param {Date} now
 * @param {object} [options]
 * @param {number[]} [options.nearDays] whole days from now, negative for a day gone by
 * @param {(date: Date, daysAway: number) => string} [options.nameOtherDay]
 * @param {boolean} [options.isCapitalized] for a name that starts a line
 */
export function nameDay(
  date,
  now,
  { nearDays = NEAR_DAYS, nameOtherDay = formatWeekdayOrDate, isCapitalized = false } = {},
) {
  const daysAway = countDaysBetween(now, date);
  const name = nearDays.includes(daysAway)
    ? NEAR_DAY_WORDS.format(daysAway, "day")
    : nameOtherDay(date, daysAway);
  return isCapitalized ? capitalize(name) : name;
}

/**
 * A game's day at the start of a line: Yesterday, Today, or Tomorrow, and its weekday and date
 * further off, as in "Sat, Oct 10".
 * @param {Date} day
 * @param {number} now
 */
export const describeDay = (day, now) =>
  nameDay(day, new Date(now), { nameOtherDay: formatWeekdayAndDate, isCapitalized: true });

/** @param {number} start @param {string} timeZone */
export const formatReminderTime = (start, timeZone) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(start));

/** The device's zone, saved only with its push choices. */
export const readDeviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** @param {unknown} value */
export function isTimeZone(value) {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_/+-]*$/.test(value))
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
