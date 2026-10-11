import { describeRegularSeason } from "./player.js";

// Every player on a team's roster in a season, as the page's search finds her: her name, team, and
// number, and which parts of her sheet have something to show, so a search lists only the
// headings her sheet shows. The player job builds it from the rosters and numbers it keeps, and
// saves it beside them.

/** @param {number} season */
export const namePlayerIndexKey = (season) => `player-index/${season}`;

/**
 * @typedef {object} IndexedPlayer
 * @property {string} id
 * @property {string} team
 * @property {string} number
 * @property {string} firstName
 * @property {string} lastName
 * @property {boolean} hasLastGame
 * @property {boolean} hasRegularSeason
 */

/**
 * @param {IndexedPlayer} first
 * @param {IndexedPlayer} second
 */
const compareNames = (first, second) =>
  first.lastName.localeCompare(second.lastName) ||
  first.firstName.localeCompare(second.firstName) ||
  first.id.localeCompare(second.id);

/**
 * @param {object} kept
 * @param {number} kept.season
 * @param {{ team: string, players: any[] }[]} kept.rosters every team's roster
 * @param {Map<string, import("./player.js").PlayerNumbers>} kept.numbers each player's numbers, by id
 * @param {import("./player.js").Ranks} kept.ranks
 */
export function describePlayerIndex({ season, rosters, numbers, ranks }) {
  /** @type {IndexedPlayer[]} */
  const players = rosters.flatMap(({ team, players: rostered }) =>
    rostered.map((player) => {
      const hers = numbers.get(player.id) ?? null;
      return {
        id: player.id,
        team,
        number: player.number,
        firstName: player.firstName,
        lastName: player.lastName,
        hasLastGame: !!hers?.lastGame,
        hasRegularSeason: !!describeRegularSeason(hers?.totals ?? null, ranks),
      };
    }),
  );
  return { season, players: players.sort(compareNames) };
}
