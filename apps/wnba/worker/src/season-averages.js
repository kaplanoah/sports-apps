import { findTeamCode, TEAMS } from "../../page/js/teams.js";
import { readTable } from "./wnba.js";

// Every player's averages a game, for her team's Roster, and each team's leading scorers, worked
// out from the season's totals, the one read each player's sheet is worked out from too, so a
// Roster, the leading scorers, and a sheet show the same numbers. The store keeps the averages in
// `averages/<year>`, which the player job saves (player-updater.js), and the season's record its
// leading scorers, which each update works out from them (season-updater.js).

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
 * The feed gives a player's name whole; everything after the first space is her last name.
 * @param {string} name
 */
function splitName(name) {
  const [firstName, ...rest] = String(name).split(" ");
  return { firstName, lastName: rest.join(" ") };
}

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
      minutes: row.MIN / row.GP,
      points: row.PTS / row.GP,
      rebounds: row.REB / row.GP,
      assists: row.AST / row.GP,
      fieldGoalShare: row.FGA > 0 ? row.FGM / row.FGA : null,
    }));
}

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
