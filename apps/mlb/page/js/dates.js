import { addDays, readEasternDay, readPlayingDay } from "#shared/days.js";

// A game's day on the viewer's calendar. Until its time is set MLB's start is a placeholder,
// which can land on the wrong day out west, so the day comes from MLB's `date`.
export const readGameDay = (game) =>
  readPlayingDay({ start: game.at, isTimeSet: !game.tbd, leagueDate: game.date });

/** A game on the slate, whose start is its `start` where a standings row's next game has `at`. */
export const readSlateGameDay = (game) => readGameDay({ ...game, at: game.start });

const NIGHT_END_HOUR = 6;

// MLB's day runs through its night games, so before 6am Eastern it's still the night before.
/** @param {number} ms */
export const isPastMidnight = (ms) => readEasternDay(ms).hour < NIGHT_END_HOUR;

/** @param {number} ms */
export const readMlbDay = (ms) =>
  isPastMidnight(ms) ? addDays(readEasternDay(ms).date, -1) : readEasternDay(ms).date;
