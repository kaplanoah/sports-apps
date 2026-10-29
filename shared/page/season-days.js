import {
  chooseListedDay,
  countDaysBetween,
  formatShortMonth,
  formatShortWeekday,
  formatWeekday,
  formatWeekdayAndDate,
  nameDay,
  readCalendarDate,
  readDayOfMonth,
} from "./days.js";
import { isLedByOne } from "./day-strip-rules.js";
import { html, joinWithSeparator } from "./html.js";

// A season's game days as the day strip lists them (day-strip.js), each under a label: its date
// as a wall calendar shows it, beside its games, or a heading over them. A league hands over each
// game day's games, already drawn, which day is its today, and which label its days take.

/** @typedef {import("./html.js").Markup} Markup */

const NEAR_DAY_ABBREVIATIONS = new Map([
  [-1, "Yest"],
  [1, "Tmrw"],
]);

/**
 * A day's name beside its date, which doesn't need "Today": the Games list it heads already says so.
 * @param {Date} day
 * @param {Date} today
 */
const nameListDay = (day, today) =>
  nameDay(day, today, { nearDays: [-1, 1], nameOtherDay: formatWeekday, isCapitalized: true });

/**
 * nameListDay's short form, for the narrow column beside a day's games.
 * @param {Date} day
 * @param {Date} today
 */
const abbreviateDay = (day, today) =>
  NEAR_DAY_ABBREVIATIONS.get(countDaysBetween(today, day)) ?? formatShortWeekday(day);

/** @typedef {(day: string, today: string) => Markup} RenderLabel */

/**
 * A day's date as a wall calendar shows it, for a narrow column beside its games.
 * @type {RenderLabel}
 */
function renderCalendarLabel(day, today) {
  const date = readCalendarDate(day);
  const todayDate = readCalendarDate(today);
  const month = formatShortMonth(date);
  const isTomorrow = countDaysBetween(todayDate, date) === 1;
  return html`<h2 class="day-label" aria-label="${nameListDay(date, todayDate)}, ${month} ${readDayOfMonth(day)}">
    <span class="day-month">${month}</span
    ><span class="day-number${isLedByOne(day) ? " leads-with-one" : ""}">${readDayOfMonth(day)}</span
    ><span class="day-name${isTomorrow ? " is-tomorrow" : ""}">${abbreviateDay(date, todayDate)}</span>
  </h2>`;
}

/**
 * A day's date in a heading over its games, named in words near today.
 * @type {RenderLabel}
 */
export function renderHeadingLabel(day, today) {
  const date = readCalendarDate(day);
  const nearName = nameDay(date, readCalendarDate(today), {
    nameOtherDay: () => "",
    isCapitalized: true,
  });
  const names = [nearName, formatWeekdayAndDate(date)].filter(Boolean);
  return html`<h2 class="day-label day-heading">${joinWithSeparator(names)}</h2>`;
}

/**
 * A day's games in a box of their own, under its label, with how many it holds, so the box takes
 * its height before it's drawn.
 * @param {{ day: string, count: number, games: Markup }} gameDay
 * @param {string} today
 * @param {RenderLabel} renderLabel
 */
const renderGameDay = ({ day, count, games }, today, renderLabel) =>
  html`<section class="game-day${day === today ? " is-today" : ""}" style="--games: ${count}">
    ${renderLabel(day, today)} ${games}
  </section>`;

/**
 * A day's stand-in while it's far from the top of the list: its label over an empty box as tall
 * as its games.
 * @param {{ day: string, count: number }} gameDay
 * @param {string} today
 * @param {RenderLabel} renderLabel
 */
const renderStandIn = ({ day, count }, today, renderLabel) =>
  html`<section class="game-day${day === today ? " is-today" : ""}" style="--games: ${count}">
    ${renderLabel(day, today)}
    <ul class="game-list is-stand-in" aria-hidden="true"></ul>
  </section>`;

/**
 * @param {string} today
 * @param {RenderLabel} renderLabel
 */
const renderNoGamesToday = (today, renderLabel) =>
  html`<section class="game-day no-games is-today">
    ${renderLabel(today, today)}
    <p class="empty-note">No games today</p>
  </section>`;

/**
 * A date without games, which a tap on it in the strip brings into the list.
 * @param {string} day
 * @param {string} today
 * @param {RenderLabel} renderLabel
 */
const renderQuietDay = (day, today, renderLabel) =>
  html`<section class="game-day no-games quiet-day">
    ${renderLabel(day, today)}
    <p class="empty-note">No games</p>
  </section>`;

/**
 * Some of a season's game days, each under its label, as a search lists the games it finds.
 * @param {object} options
 * @param {{ day: string, count: number, games: Markup }[]} options.gameDays in order
 * @param {string} options.today
 * @param {RenderLabel} [options.renderLabel]
 * @param {boolean} [options.standsIn] whether a day far from what shows stands in for its games,
 *   as a season of many games a day does
 * @returns {import("./day-strip.js").ListedDay[]}
 */
export const listFoundDays = ({
  gameDays,
  today,
  renderLabel = renderCalendarLabel,
  standsIn = false,
}) => gameDays.map((gameDay) => listGameDay(gameDay, today, renderLabel, standsIn));

/**
 * A game day as a list draws it, with its stand-in when the league has them.
 * @param {{ day: string, count: number, games: Markup }} gameDay
 * @param {string} today
 * @param {RenderLabel} renderLabel
 * @param {boolean} standsIn
 * @returns {import("./day-strip.js").ListedDay}
 */
const listGameDay = (gameDay, today, renderLabel, standsIn) => ({
  day: gameDay.day,
  markup: renderGameDay(gameDay, today, renderLabel),
  ...(standsIn && { farMarkup: renderStandIn(gameDay, today, renderLabel) }),
});

/**
 * Each game day of the season as the day strip lists it, from its first to its last, with a day
 * saying there are no games today when today falls between them, and the day the list opens on:
 * today, or `openDay` when a game still under way began before it.
 * @param {object} options
 * @param {{ day: string, count: number, games: Markup }[]} options.gameDays in order
 * @param {string} options.today
 * @param {string | null} [options.openDay]
 * @param {string} options.emptyNote
 * @param {RenderLabel} [options.renderLabel]
 * @param {boolean} [options.standsIn] whether a day far from the top of the list stands in for its
 *   games, as a season of many games a day does
 * @returns {import("./day-strip.js").DayStripFill}
 */
export function listSeasonDays({
  gameDays,
  today,
  openDay = null,
  emptyNote,
  renderLabel = renderCalendarLabel,
  standsIn = false,
}) {
  const days = listFoundDays({ gameDays, today, renderLabel, standsIn });
  const isTodayInSeason = !!days.length && days[0].day < today && today < days.at(-1).day;
  if (isTodayInSeason && !days.some(({ day }) => day === today)) {
    const after = days.findIndex(({ day }) => day > today);
    days.splice(after, 0, { day: today, markup: renderNoGamesToday(today, renderLabel) });
  }
  const startDay = chooseListedDay(days, openDay && openDay < today ? openDay : today);
  return {
    days,
    today,
    startDay,
    emptyNote,
    renderQuietDay: (day) => renderQuietDay(day, today, renderLabel),
  };
}
