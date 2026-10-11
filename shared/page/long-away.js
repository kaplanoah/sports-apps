// After two minutes away, a view goes back to where it starts: long enough to glance at another
// app and come back to where it was, short enough that the next sitting starts over.
export const START_AFTER_AWAY_MS = 2 * 60 * 1000;

/** @param {number} awayMs */
export const isAwayLong = (awayMs) => awayMs >= START_AFTER_AWAY_MS;
