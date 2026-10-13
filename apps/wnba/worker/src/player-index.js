import { describePlayerIndex } from "#shared/page-search.js";

// Every player on a team's roster in a season, as the page's search finds her: her name, team, and
// number. The player job builds it from the rosters it keeps, and saves it beside them.

/**
 * @param {number} season
 * @param {{ team: string, players: any[] }[]} rosters every team's roster
 */
export const indexRosters = (season, rosters) =>
  describePlayerIndex(
    season,
    rosters.flatMap(({ team, players }) =>
      players.map((player) => ({
        id: player.id,
        team,
        number: player.number,
        firstName: player.firstName,
        lastName: player.lastName,
      })),
    ),
  );
