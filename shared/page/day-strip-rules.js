// What a season's list of days decides, apart from drawing and scrolling it (day-strip.js): which
// days its strip holds and how each is labeled, which days the list shows, where it opens, how it
// travels to a day, and when it follows its start day. Runs in the page and in Node, so it uses no
// DOM.

import {
  addDays,
  formatMonth,
  formatShortMonth,
  formatShortWeekday,
  formatWeekday,
  readCalendarDate,
  readDayOfMonth,
} from "./days.js";

/** @typedef {import("./day-strip.js").ListedDay} ListedDay */
/** @typedef {import("./html.js").Markup} Markup */

// Farther than this many screens, a jump is made at once rather than flown.
const FLOWN_SCREENS = 3;
// After a long time away, the list's start day can move as the store catches up, as when a game
// still under way when the page left has since ended, so for this long, until someone moves the
// list or the strip, the list follows it.
const FOLLOW_START_MS = 10 * 1000;

/**
 * Every day from the first game day to the last.
 * @param {ListedDay[]} days
 */
export function listStripDays(days) {
  if (!days.length) return [];
  const last = days[days.length - 1].day;
  const stripDays = [];
  for (let day = days[0].day; day <= last; day = addDays(day, 1)) stripDays.push(day);
  return stripDays;
}

/**
 * What names a day in the strip: Today, the month on its first, and otherwise its weekday.
 * @param {string} day
 * @param {string} today
 * @returns {"today" | "month" | "weekday"}
 */
export function chooseCellLabel(day, today) {
  if (day === today) return "today";
  return readDayOfMonth(day) === 1 ? "month" : "weekday";
}

/**
 * The word over a day's number in the strip, as its rule chooses it.
 * @param {string} day
 * @param {string} today
 */
export function readCellWord(day, today) {
  const label = chooseCellLabel(day, today);
  if (label === "today") return "Today";
  const date = readCalendarDate(day);
  return label === "month" ? formatShortMonth(date) : formatShortWeekday(date);
}

/**
 * The words a day's cell leaves out, for a voice to say after what a finger sees, so "Sat 12"
 * reads "Sat 12, September" and "Oct 1" reads "Oct 1, Thursday".
 * @param {string} day
 * @param {string} today
 */
export function readUnshownCellWords(day, today) {
  const date = readCalendarDate(day);
  const label = chooseCellLabel(day, today);
  if (label === "today") return `${formatWeekday(date)}, ${formatMonth(date)}`;
  return label === "month" ? formatWeekday(date) : formatMonth(date);
}

/**
 * Whether a day's date starts with a 1, whose stem the eye centers it on, right of its box's middle.
 * @param {string} day
 */
export const isLedByOne = (day) => String(readDayOfMonth(day)).startsWith("1");

/**
 * The days the list shows: each game day, and in its place among them a date without games a tap
 * brought in.
 * @param {ListedDay[]} days
 * @param {string | null} quietDay
 * @param {(day: string) => Markup} renderQuietDay
 * @returns {ListedDay[]}
 */
export function listShownDays(days, quietDay, renderQuietDay) {
  if (!quietDay || days.some(({ day }) => day === quietDay)) return days;
  const quiet = { day: quietDay, markup: renderQuietDay(quietDay) };
  return [...days, quiet].sort((first, second) => (first.day < second.day ? -1 : 1));
}

/**
 * Where a list that shows for the first time since a fill opens: where it last was, once it has
 * been placed; on the day the page put back as it loaded, while the list still has it; and
 * otherwise on its start day.
 * @param {{ isPlaced: boolean, hasPutBackDay: boolean }} state
 * @returns {"last place" | "put back" | "start day"}
 */
export function choosePlacement({ isPlaced, hasPutBackDay }) {
  if (isPlaced) return "last place";
  return hasPutBackDay ? "put back" : "start day";
}

/**
 * Where the list stands with a day a day's gap under its top, or as near as its ends let it.
 * @param {{ dayTop: number, gap: number, scrollHeight: number, clientHeight: number }} list
 */
export const findDayScrollTop = ({ dayTop, gap, scrollHeight, clientHeight }) =>
  Math.max(0, Math.min(dayTop - gap, scrollHeight - clientHeight));

/**
 * Where the strip stands with a date in its middle, or as near as its ends let it.
 * @param {{ cellLeft: number, cellWidth: number, scrollWidth: number, clientWidth: number }} strip
 */
export const findCellScrollLeft = ({ cellLeft, cellWidth, scrollWidth, clientWidth }) =>
  Math.max(0, Math.min(cellLeft - (clientWidth - cellWidth) / 2, scrollWidth - clientWidth));

/**
 * How the list travels to a day: at once when asked to, more than three screens away, or with
 * less motion, and otherwise flown on a spring.
 * @param {{ motion: "instant" | "flown", distance: number, screenHeight: number, isReducedMotion: boolean }} trip
 * @returns {"jump" | "fly"}
 */
export function chooseTrip({ motion, distance, screenHeight, isReducedMotion }) {
  const isFar = Math.abs(distance) > FLOWN_SCREENS * screenHeight;
  return motion === "instant" || isFar || isReducedMotion ? "jump" : "fly";
}

/**
 * Why the strip's dates can't slide to the list's new top day, or null when they can: they slide
 * only while a finger or wheel moves the list, since the list's own moves choose their day.
 * @param {{ hasCells: boolean, isListInHand: boolean, isReducedMotion: boolean }} state
 */
export function describeWhyNoSlide({ hasCells, isListInHand, isReducedMotion }) {
  if (!hasCells) return "a date isn't in the strip";
  if (!isListInHand) return "no finger or wheel moved the list";
  if (isReducedMotion) return "less motion";
  return null;
}

/**
 * Until when a list back from a long time away follows its start day.
 * @param {number} now
 */
export const readFollowStartUntil = (now) => now + FOLLOW_START_MS;

/**
 * Whether a fill moves the list to its new start day: only while it still follows it, and is held
 * on the start day it had.
 * @param {{ now: number, followStartUntil: number, heldDay: string | null, lastStartDay: string, startDay: string }} state
 */
export const isFollowingStartDay = ({ now, followStartUntil, heldDay, lastStartDay, startDay }) =>
  now < followStartUntil && heldDay === lastStartDay && startDay !== lastStartDay;

/**
 * Whether a row is out of the list's sight, above or below what shows.
 * @param {{ rowTop: number, rowHeight: number, scrollTop: number, clientHeight: number }} place
 */
export const isRowOutOfSight = ({ rowTop, rowHeight, scrollTop, clientHeight }) =>
  rowTop + rowHeight <= scrollTop || rowTop >= scrollTop + clientHeight;
