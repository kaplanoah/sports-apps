import { findTeamCode, TEAMS } from "../../page/js/teams.js";
import { readTable } from "./wnba.js";

// Every player's averages a game, for her team's Roster, and each team's leading scorers, worked
// out from the season's totals, the one read each player's sheet is worked out from too, with the
// same math, so a Roster, the leading scorers, and a sheet show the same numbers. The player job
// saves both from each read of the totals (player-updater.js): the averages in `averages/<year>`,
// and the leading scorers in the season's record.

// A team's sheet and a game's preview each show a team's leading five.
const LEADERS_PER_TEAM = 5;

/**
 * Where the store keeps every player's averages for a season.
 * @param {number} year
 */
export const nameAveragesKey = (year) => `averages/${year}`;

/**
 * @typedef {object} PlayerAverages
 * @property {string} team
 * @property {number} id
 * @property {string} firstName
 * @property {string} lastName
 * @property {number} games
 * @property {number} minutes
 * @property {number} points
 * @property {number} rebounds
 * @property {number} assists
 * @property {number | null} fieldGoalShare
 */

/**
 * The feeds write a player's name whole; everything after the first space is her last name.
 * @param {string} name
 */
export function splitName(name) {
  const [firstName, ...rest] = String(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

/**
 * Her number a game of a total, or null before she has played or for a column her totals lack.
 * @param {string} total
 * @returns {(row: Record<string, number>) => number | null}
 */
export const readPerGame = (total) => (row) =>
  row.GP > 0 && row[total] != null ? row[total] / row.GP : null;

/**
 * The share of her attempts she made, or null when she took none.
 * @param {string} made
 * @param {string} attempted
 * @returns {(row: Record<string, number>) => number | null}
 */
export const readShare = (made, attempted) => (row) =>
  row[attempted] > 0 ? row[made] / row[attempted] : null;

/**
 * Her averages a game from her totals, as her sheet and her team's Roster both show them, for a
 * player who has played.
 * @param {Record<string, number>} row
 */
export const averageTotals = (row) => ({
  minutes: /** @type {number} */ (readPerGame("MIN")(row)),
  points: /** @type {number} */ (readPerGame("PTS")(row)),
  rebounds: /** @type {number} */ (readPerGame("REB")(row)),
  assists: /** @type {number} */ (readPerGame("AST")(row)),
});

/**
 * Every player who has played this season, with her averages a game, under the team she last
 * played for.
 * @param {any} totals the stats site's season totals
 * @returns {PlayerAverages[]}
 */
export function describeAverages(totals) {
  return readTable(totals, "LeagueDashPlayerStats")
    .filter((row) => row.GP > 0 && findTeamCode(row.TEAM_ID))
    .map((row) => ({
      team: /** @type {string} */ (findTeamCode(row.TEAM_ID)),
      id: row.PLAYER_ID,
      ...splitName(row.PLAYER_NAME),
      games: row.GP,
      ...averageTotals(row),
      fieldGoalShare: readShare("FGM", "FGA")(row),
    }));
}

/**
 * Every player's averages a season as the store keeps them.
 * @param {number} year
 * @param {any} totals the stats site's season totals
 */
export const describeAveragesDoc = (year, totals) => ({
  year,
  players: describeAverages(totals),
});

/**
 * A team's best scorers by points a game. A player who has missed most of the team's games
 * doesn't lead it, however well she scores.
 * @param {PlayerAverages[]} averages
 * @param {string} team
 */
function listTeamLeaders(averages, team) {
  const players = averages.filter((player) => player.team === team);
  const most = Math.max(0, ...players.map((player) => player.games));
  return players
    .filter((player) => player.games >= most / 2)
    .sort((first, second) => second.points - first.points)
    .slice(0, LEADERS_PER_TEAM);
}

/**
 * Each team's leading scorers, from every player's averages.
 * @param {PlayerAverages[]} averages
 */
export const listLeaders = (averages) =>
  Object.keys(TEAMS).flatMap((team) => listTeamLeaders(averages, team));
