// The calendar words a search reads, and the days each covers. Days are "YYYY-MM-DD" on the
// viewer's calendar and times are on the viewer's clock, as the Games list shows them. A week runs
// Sunday to Saturday, and a weekend from Friday at 5 PM to the end of Sunday, as Friday night's
// games are weekend games to fans and on TV. Runs in the page and in Node, so it uses no DOM.

import {
  addDays,
  countDaysInMonth,
  formatMinutesIntoDay,
  formatMonth,
  formatShortDate,
  formatWeekdayAndDate,
  isSameMonth,
  readCalendarDate,
  readDayOfMonth,
  readWeekday,
  shiftMonth,
} from "./days.js";
import { capitalize } from "./html.js";

/** @typedef {import("./search-words.js").Meaning} Meaning */
/**
 * The days a search covers, from and to "YYYY-MM-DD", what the line calls them, and whether a
 * Friday in them counts only from 5 PM, as a weekend's does.
 * @typedef {{ from: string, to: string, label: string, isFromFridayEvening?: boolean }} DayRange
 */
/**
 * Minutes after midnight a game starts from and before, on the viewer's clock or, `isLocal`, on the
 * clock where it's played, and what the line calls it.
 * @typedef {{ from: number, to: number, label: string, isLocal?: boolean }} TimeOfDay
 */

const WEEKEND_FRIDAY_FROM = 17 * 60;
const MINUTES_PER_DAY = 24 * 60;
const FRIDAY = 5;

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

// "Sun" is a team, so Sunday has no short name.
const WEEKDAYS = [
  ["sunday"],
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
];

// The days a phrase names, from today.
const RANGES = {
  today: ["today"],
  tonight: ["tonight"],
  tomorrow: ["tomorrow"],
  yesterday: ["yesterday"],
  "last-night": ["last night"],
  "this-week": ["this week"],
  "next-week": ["next week"],
  "last-week": ["last week"],
  "this-weekend": ["this weekend", "the weekend", "weekend"],
  "next-weekend": ["next weekend"],
  "last-weekend": ["last weekend"],
  "this-month": ["this month"],
  "next-month": ["next month"],
  "last-month": ["last month"],
  "past-week": ["past week", "the past week", "past 7 days", "last 7 days"],
  "so-far": ["so far", "this season so far"],
  "rest-of-season": ["rest of the season", "rest of season", "rest of the year"],
};

// Parts of a day, on the viewer's clock, but for day and night games, which go by the clock where
// they're played, as baseball's do: a day game starts before 5 PM there.
const TIMES_OF_DAY = {
  morning: { words: ["morning"], from: 0, to: 12 * 60, label: "Morning" },
  afternoon: { words: ["afternoon"], from: 12 * 60, to: 17 * 60, label: "Afternoon" },
  night: { words: ["night", "evening"], from: 17 * 60, to: MINUTES_PER_DAY, label: "Night" },
  late: { words: ["late games"], from: 21 * 60, to: MINUTES_PER_DAY, label: "Late" },
  "day-games": {
    words: ["day games", "day game", "daytime", "matinee", "matinees"],
    from: 0,
    to: 17 * 60,
    label: "Day games",
    isLocal: true,
  },
  "night-games": {
    words: ["night games", "night game"],
    from: 17 * 60,
    to: MINUTES_PER_DAY,
    label: "Night games",
    isLocal: true,
  },
};

const PARTS_OF_MONTH = { early: [1, 10], mid: [11, 20], middle: [11, 20], late: [21, 31] };

/**
 * A month's name as a search reads it, in English whatever the viewer's language, as "June".
 * @param {number} month 1 to 12
 */
export const nameMonth = (month) => capitalize(MONTHS[month - 1][0]);

/** @returns {{ phrase: string, meaning: Meaning }[]} */
function listMonthEntries() {
  return MONTHS.flatMap((names, index) =>
    names.map((phrase) => ({
      phrase,
      meaning: { kind: "month", value: index + 1, display: nameMonth(index + 1) },
    })),
  );
}

function listWeekdayEntries() {
  return WEEKDAYS.flatMap((names, index) => [
    ...names.map((phrase) => ({
      phrase,
      meaning: { kind: "weekday", value: index, display: capitalize(names[0]) },
    })),
    {
      phrase: `${names[0]}s`,
      meaning: { kind: "weekdays", value: [index], display: `${capitalize(names[0])}s` },
    },
  ]);
}

function listRangeEntries() {
  return Object.entries(RANGES).flatMap(([name, phrases]) =>
    phrases.map((phrase) => ({
      phrase,
      meaning: { kind: "range", value: name, display: phrases[0] },
    })),
  );
}

function listTimeEntries() {
  return Object.entries(TIMES_OF_DAY).flatMap(([name, { words }]) =>
    words.map((phrase) => ({ phrase, meaning: { kind: "time", value: name, display: words[0] } })),
  );
}

/** The calendar's words, for a search's dictionary. */
export const CALENDAR_ENTRIES = [
  ...listMonthEntries(),
  ...listWeekdayEntries(),
  ...listRangeEntries(),
  ...listTimeEntries(),
  { phrase: "weekends", meaning: { kind: "weekdays", value: [5, 6, 0], display: "Weekends" } },
  {
    phrase: "weekdays",
    meaning: { kind: "weekdays", value: [1, 2, 3, 4, 5], display: "Weekdays" },
  },
  ...Object.keys(PARTS_OF_MONTH).map((phrase) => ({
    phrase,
    meaning: { kind: "part-of-month", value: phrase },
  })),
  { phrase: "after", meaning: { kind: "after" } },
  { phrase: "before", meaning: { kind: "before" } },
  ...["to", "through", "thru", "until", "-"].map((phrase) => ({ phrase, meaning: { kind: "to" } })),
  { phrase: "pm", meaning: { kind: "meridiem", value: "pm" } },
  { phrase: "am", meaning: { kind: "meridiem", value: "am" } },
];

/** @param {string} day */
const formatDay = (day) => formatWeekdayAndDate(readCalendarDate(day));

/**
 * What the line calls a run of days: one day as "Thu, Oct 1", and several as "Oct 2-4" or
 * "Sep 27-Oct 3", with an en dash.
 * @param {string} from
 * @param {string} to
 */
function formatDays(from, to) {
  if (from === to) return formatDay(from);
  const end = isSameMonth(from, to)
    ? String(readDayOfMonth(to))
    : formatShortDate(readCalendarDate(to));
  return `${formatShortDate(readCalendarDate(from))}\u2013${end}`;
}

/**
 * @param {string} from
 * @param {string} to
 * @param {boolean} [isFromFridayEvening]
 * @returns {DayRange}
 */
export const createRange = (from, to, isFromFridayEvening = false) => ({
  from,
  to,
  label: formatDays(from, to),
  ...(isFromFridayEvening && { isFromFridayEvening }),
});

/** @param {number} number */
const padDate = (number) => String(number).padStart(2, "0");

/**
 * A day of a month of a year, as "YYYY-MM-DD", or null for one the calendar doesn't have, like
 * February 30 or a 13th month's day.
 * @param {number} month 1 to 12
 * @param {number} day
 * @param {number} year
 */
export function readMonthDay(month, day, year) {
  const isDay = month >= 1 && month <= 12 && day >= 1 && day <= countDaysInMonth(month, year);
  return isDay ? `${year}-${padDate(month)}-${padDate(day)}` : null;
}

/**
 * The days of a month of a year.
 * @param {number} month 1 to 12
 * @param {number} year
 * @param {[number, number]} [days] the first and last day of the month to cover
 * @returns {DayRange}
 */
export function readMonthDays(month, year, [firstDay, lastDay] = [1, 31]) {
  const lengthOfMonth = countDaysInMonth(month, year);
  const from = `${year}-${padDate(month)}-${padDate(firstDay)}`;
  const to = `${year}-${padDate(month)}-${padDate(Math.min(lastDay, lengthOfMonth))}`;
  const isWhole = firstDay === 1 && lastDay >= lengthOfMonth;
  return isWhole ? { from, to, label: formatMonth(readCalendarDate(from)) } : createRange(from, to);
}

/**
 * The part of a month "early", "mid", or "late" names.
 * @param {string} part
 * @param {number} month
 * @param {number} year
 */
export const readPartOfMonth = (part, month, year) =>
  readMonthDays(month, year, /** @type {[number, number]} */ (PARTS_OF_MONTH[part]));

/**
 * The next day that's a weekday, today included, or, for a past one, the last before today.
 * @param {number} weekday 0 for Sunday
 * @param {string} today
 * @param {"next" | "last"} [which]
 */
export function findWeekday(weekday, today, which = "next") {
  const shift = (weekday - readWeekday(today) + 7) % 7;
  return which === "last" ? addDays(today, shift - 7) : addDays(today, shift);
}

/** @param {string} today */
const findThisSunday = (today) => findWeekday(0, today);

/**
 * The days a range's name covers, from today, within the season.
 * @param {string} name
 * @param {{ today: string, seasonStart: string, seasonEnd: string }} season
 * @returns {DayRange}
 */
export function readNamedRange(name, { today, seasonStart, seasonEnd }) {
  const weekStart = addDays(today, -readWeekday(today));
  const sunday = findThisSunday(today);
  const monthDays = (/** @type {number} */ shift) => {
    const { month, year } = shiftMonth(today, shift);
    return readMonthDays(month, year);
  };
  const ranges = {
    today: () => createRange(today, today),
    tonight: () => createRange(today, today),
    tomorrow: () => createRange(addDays(today, 1), addDays(today, 1)),
    yesterday: () => createRange(addDays(today, -1), addDays(today, -1)),
    "last-night": () => createRange(addDays(today, -1), addDays(today, -1)),
    "this-week": () => createRange(weekStart, addDays(weekStart, 6)),
    "next-week": () => createRange(addDays(weekStart, 7), addDays(weekStart, 13)),
    "last-week": () => createRange(addDays(weekStart, -7), addDays(weekStart, -1)),
    "this-weekend": () => createRange(addDays(sunday, -2), sunday, true),
    "next-weekend": () => createRange(addDays(sunday, 5), addDays(sunday, 7), true),
    "last-weekend": () => createRange(addDays(sunday, -9), addDays(sunday, -7), true),
    "this-month": () => monthDays(0),
    "next-month": () => monthDays(1),
    "last-month": () => monthDays(-1),
    "past-week": () => createRange(addDays(today, -6), today),
    "so-far": () => createRange(seasonStart, today),
    "rest-of-season": () => createRange(today, seasonEnd),
  };
  return ranges[name]();
}

/** The part of the day a range's name holds, as tonight's is the night. */
export const RANGE_TIMES = { tonight: "night", "last-night": "night" };

/**
 * The days a count of days covers, from today on, as "next 7 days" does, or up to today, as "last
 * 10 days" and "past 10 days" do.
 * @param {number} count
 * @param {string} today
 * @param {"next" | "last"} which
 */
export const readCountedDays = (count, today, which) =>
  which === "next"
    ? createRange(today, addDays(today, count - 1))
    : createRange(addDays(today, 1 - count), today);

/**
 * The part of a day a word names.
 * @param {string} name
 * @returns {TimeOfDay}
 */
export function readTimeOfDay(name) {
  const { from, to, label, isLocal } = TIMES_OF_DAY[name];
  return { from, to, label, ...(isLocal && { isLocal }) };
}

/**
 * A clock time a search names, as "9", "9:30", "9pm", or "9 pm", in minutes after midnight. A bare
 * hour is an afternoon or evening one, as games are, but for noon.
 * @param {string} word
 * @param {string | undefined} meridiem "am" or "pm", when the next word says
 */
export function readClockWord(word, meridiem) {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(word);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const said = match[3] ?? meridiem;
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const isAfternoon = said ? said === "pm" : true;
  const hour24 = (hour % 12) + (isAfternoon ? 12 : 0);
  return hour24 * 60 + minute;
}

/**
 * The time of day "after", "before", or "at" a clock time covers.
 * @param {"after" | "before" | "at"} side
 * @param {number} minutes
 * @returns {TimeOfDay}
 */
export function readClockRange(side, minutes) {
  if (side === "after")
    return { from: minutes, to: MINUTES_PER_DAY, label: `After ${formatMinutesIntoDay(minutes)}` };
  if (side === "before")
    return { from: 0, to: minutes, label: `Before ${formatMinutesIntoDay(minutes)}` };
  return { from: minutes, to: minutes + 60, label: formatMinutesIntoDay(minutes) };
}

/**
 * Whether a day and a start, in minutes after midnight, fall in a range of days, a Friday that
 * counts only from the evening counting a game whose time isn't set.
 * @param {DayRange} range
 * @param {string} day
 * @param {number | null} minutes null for a game whose time isn't set
 */
export function isInRange(range, day, minutes) {
  if (day < range.from || day > range.to) return false;
  const isEveningOnly =
    range.isFromFridayEvening && day === range.from && readWeekday(day) === FRIDAY;
  return !isEveningOnly || minutes === null || minutes >= WEEKEND_FRIDAY_FROM;
}

/**
 * Whether a day falls on one of some weekdays, a weekend's Friday counting only from the evening.
 * @param {number[]} weekdays
 * @param {string} day
 * @param {number | null} minutes
 */
export function isOnWeekdays(weekdays, day, minutes) {
  const weekday = readWeekday(day);
  if (!weekdays.includes(weekday)) return false;
  const isWeekend = weekdays.includes(0) && weekdays.includes(FRIDAY);
  return !(isWeekend && weekday === FRIDAY) || minutes === null || minutes >= WEEKEND_FRIDAY_FROM;
}

/**
 * The part of two ranges both cover, or null when they don't meet.
 * @param {DayRange} first
 * @param {DayRange} second
 * @returns {DayRange | null}
 */
export function overlapRanges(first, second) {
  const from = first.from > second.from ? first.from : second.from;
  const to = first.to < second.to ? first.to : second.to;
  if (from > to) return null;
  const isFromFridayEvening =
    (from === first.from && first.isFromFridayEvening) ||
    (from === second.from && second.isFromFridayEvening);
  return createRange(from, to, !!isFromFridayEvening);
}
