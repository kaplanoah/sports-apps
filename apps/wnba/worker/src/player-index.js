// Every player on a team's roster in a season, as the page's search finds her: her name, team,
// number, and, while she's out, why. The player job builds it from the rosters it keeps, and saves
// it beside them.

/** @typedef {import("../../page/js/search-pages.js").IndexedPlayer} IndexedPlayer */

/**
 * @param {IndexedPlayer} first
 * @param {IndexedPlayer} second
 */
const compareNames = (first, second) =>
  first.lastName.localeCompare(second.lastName) ||
  first.firstName.localeCompare(second.firstName) ||
  first.id.localeCompare(second.id);

/**
 * @param {number} season
 * @param {{ team: string, players: any[] }[]} rosters every team's roster
 */
export function describePlayerIndex(season, rosters) {
  /** @type {IndexedPlayer[]} */
  const players = rosters.flatMap(({ team, players: rostered }) =>
    rostered.map((player) => ({
      id: player.id,
      team,
      number: player.number,
      firstName: player.firstName,
      lastName: player.lastName,
      out: player.out ? { reason: player.out.reason, isForSeason: player.out.isForSeason } : null,
    })),
  );
  return { season, players: players.sort(compareNames) };
}
