import { countDaysBetween, formatClockTime, formatWeekdayOrDate, nameDay } from "./days.js";
import { html, setHtml } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */

// The header's stamp: a few short lines on what last happened and what's next, in the viewer's
// own words for days ("yesterday", "tomorrow").

/**
 * When a finished game ended, as a few words: "today", "yesterday", the weekday it was played
 * within the week, and its date before that.
 * @param {Date} end when the game ended, or the nearest time known to it
 * @param {Date} played when the game started, which names its weekday or date
 * @param {Date} now
 */
export const describeFinishedDay = (end, played, now) =>
  nameDay(end, now, {
    nearDays: [-1, 0],
    nameOtherDay: (_end, daysAway) => formatWeekdayOrDate(played, daysAway),
  });

/**
 * @param {Date} date
 * @param {Date} [now]
 */
export function formatStampWhen(date, now = new Date()) {
  const time = formatClockTime(date);
  return countDaysBetween(date, now) === 0 ? time : `${nameDay(date, now)} ${time}`;
}

// Sets AM/PM apart so it can be styled smaller.
/** @param {string} when */
function renderMeridiem(when) {
  const parts = /^(.*\d)\s*(\D+)$/.exec(when);
  return parts ? html`${parts[1]}<span class="ap">${parts[2]}</span>` : html`${when}`;
}

/**
 * @param {Date} date
 * @param {Date} [now]
 */
export const renderStampWhen = (date, now = new Date()) =>
  renderMeridiem(formatStampWhen(date, now));

/**
 * A clock time within one of the stamp's sentences, and the day after it when it has one, set apart
 * as a line's own time is.
 * @param {Date} date
 * @param {string} [day]
 */
export const renderStampTime = (date, day = "") =>
  html`<b>${renderMeridiem(formatClockTime(date))}${day && ` ${day}`}</b>`;

/**
 * Whether a day holds too many games for the header to name each, so it names one and counts the
 * day's slate.
 * @param {number} count the day's games
 */
export const isFullSlate = (count) => count > 2;

/**
 * A full day's games, as the header counts them after the one it names: "slate of 5 under way".
 * @param {number} count
 * @param {"under way" | "over"} stage
 */
export const describeSlate = (count, stage) => `slate of ${count} ${stage}`;

/** Leads a line about the games under way, set apart as a time is. */
export const renderStampNow = () => html`<b class="now">NOW</b>`;

/**
 * @param {string} label
 * @param {Markup | string} when
 * @param {string} [why]
 */
export function renderStampLine(label, when, why) {
  return html`<span>${label} <b>${when}</b>${why && html` &mdash; ${why}`}</span>`;
}

/**
 * Writes the stamp's lines, then any problems, and hides it when there's nothing to say.
 * @param {HTMLElement} stamp
 * @param {Markup[]} lines
 * @param {string[]} problems
 */
export function fillStamp(stamp, lines, problems) {
  const all = [
    ...lines,
    ...problems.map((problem) => html`<span class="stamp-err">${problem}</span>`),
  ];
  stamp.hidden = !all.length;
  setHtml(stamp, html`${all}`);
}
