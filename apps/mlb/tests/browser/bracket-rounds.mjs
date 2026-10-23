export const WILD_CARD_SERIES = ["AL_WC1", "AL_WC2", "NL_WC1", "NL_WC2"];
export const DIVISION_SERIES = ["AL_DS1", "AL_DS2", "NL_DS1", "NL_DS2"];

/**
 * Finishes each series in `ids`, won by its first club in `wins` games.
 * @param {any} season
 * @param {string[]} ids
 * @param {number} wins
 */
export function finishSeries(season, ids, wins) {
  for (const id of ids)
    season.series[id] = { ...season.series[id], winsA: wins, winsB: 0, started: true };
  return season;
}
