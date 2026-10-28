// League adapters supply eligibility and names from the snapshot also saved for the page.
/**
 * @param {any[] | null} games
 * @param {number} season
 * @param {(game: any) => { away: string, home: string }} readTeams
 */
export function listTimedReminderGames(games, season, readTeams) {
  if (!games) return null;
  return games
    .map((game) => ({
      id: game.id,
      season,
      start: Date.parse(game.start),
      ...readTeams(game),
      networks: game.networks ?? [],
    }))
    .filter((game) => game.away && game.home && Number.isFinite(game.start));
}
