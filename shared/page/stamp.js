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
 * Whether a day's games are a full slate, every one of them in one state, as one over or still to
 * start.
 * @param {{ state: string }[]} games the day's games
 * @param {string} state
 */
export const isWholeSlate = (games, state) =>
  isFullSlate(games.length) && games.every((game) => game.state === state);

/**
 * A full day's games, as the header counts them after the one it names: "slate of 5 under way",
 * "slate of 5 over" once every game is final, or, before any has begun, "starts slate of 5".
 * @param {number} count
 * @param {"starts" | "under way" | "over"} stage
 */
export const describeSlate = (count, stage) =>
  stage === "starts" ? `starts slate of ${count}` : `slate of ${count} ${stage}`;

/**
 * How a full day that has begun stands, "slate of 5 under way" until every game is final and
 * "slate of 5 over" after, or nothing for a day of few games.
 * @param {{ state: string }[]} games the day's games
 */
export function describeDaySlate(games) {
  if (!isFullSlate(games.length)) return "";
  return describeSlate(games.length, isWholeSlate(games, "final") ? "over" : "under way");
}

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
