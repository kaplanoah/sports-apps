import {
  countDaysBetween,
  formatWeekdayAndDate,
  nameDay,
  readEasternDay,
  readPlayingDay,
} from "#shared/days.js";

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start. A game
 * whose time isn't set yet has a placeholder start at midnight Eastern, so its day is the league's.
 * @param {{ start: string | null, isTimeSet: boolean }} game
 */
export function readGameDay({ start, isTimeSet }) {
  const startMs = Date.parse(start ?? "");
  const leagueDate = Number.isFinite(startMs) ? readEasternDay(startMs).date : null;
  return readPlayingDay({ start, isTimeSet, leagueDate });
}

/**
 * Whether a game is played on the viewer's today.
 * @param {{ start: string | null, isTimeSet: boolean }} game
 * @param {number} now
 */
export function isGameToday(game, now) {
  const day = readGameDay(game);
  return !!day && countDaysBetween(day, new Date(now)) === 0;
}

/**
 * Whether a game is played on the league's today, which is Eastern, whatever the viewer's zone.
 * @param {{ start: string | null }} game
 * @param {number} now
 */
export function isGameOnLeagueToday({ start }, now) {
  const startMs = Date.parse(start ?? "");
  return Number.isFinite(startMs) && readEasternDay(startMs).date === readEasternDay(now).date;
}

/**
 * A game's day for the middle of a sentence, as in "Next game tomorrow".
 * @param {Date} day
 * @param {number} now
 */
export const describeDayInSentence = (day, now) =>
  nameDay(day, new Date(now), { nameOtherDay: formatWeekdayAndDate });
