// The season a request names.

export const LAST_SEASON = 2100;

/**
 * @typedef {object} SeasonParam
 * @property {string} rule what a request that names a season that isn't one is told
 * @property {(searchParams: URLSearchParams, now: number) => number | null} readSeason the
 *   season a request names, the current one when it names none, or null when it isn't one
 */

/**
 * The seasons a league's requests can name: its first through LAST_SEASON.
 * @param {object} league
 * @param {number} league.firstSeason
 * @param {(now: number) => number} league.readCurrentSeason
 * @returns {SeasonParam}
 */
export function createSeasonParam({ firstSeason, readCurrentSeason }) {
  return {
    rule: `season must be a whole year between ${firstSeason} and ${LAST_SEASON}`,
    readSeason(searchParams, now) {
      if (!searchParams.has("season")) return readCurrentSeason(now);
      const season = Number(searchParams.get("season"));
      const isValid = Number.isInteger(season) && season >= firstSeason && season <= LAST_SEASON;
      return isValid ? season : null;
    },
  };
}
