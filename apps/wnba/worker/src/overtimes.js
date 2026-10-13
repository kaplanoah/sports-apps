import { readTable } from "./wnba.js";

// Which of a season's finals went to overtime, and how many overtimes each played, for search, from
// the minutes each team played in the league's log of every team's games: a game's five players on
// the floor play 200 minutes in regulation, and 25 more in each five-minute overtime.

const REGULATION_MINUTES = 200;
const OVERTIME_MINUTES = 25;

/**
 * How many overtimes a team's game played, from the minutes its players played in all.
 * @param {Record<string, any>} row
 */
const countOvertimes = (row) =>
  Math.max(0, Math.round((Number(row.MIN) - REGULATION_MINUTES) / OVERTIME_MINUTES));

/**
 * The season's finals that went past regulation, each by its id with how many overtimes it played.
 * @param {number} season
 * @param {any[]} teamGames every team's games of each kind, as the league's log answers
 */
export function describeOvertimes(season, teamGames) {
  /** @type {Record<string, number>} */
  const games = {};
  for (const row of teamGames.flatMap((answer) => readTable(answer, "LeagueGameLog"))) {
    const overtimes = countOvertimes(row);
    if (overtimes) games[String(row.GAME_ID)] = overtimes;
  }
  return { season, games };
}
