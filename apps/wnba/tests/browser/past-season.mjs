const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** @param {string | null | undefined} time */
const moveBackAYear = (time) => time && new Date(Date.parse(time) - YEAR_MS).toISOString();

/**
 * The afternoon's season as last year's record, its finals a year earlier and nothing still to
 * play.
 * @param {any} season
 */
const keepAsLastSeason = (season) => ({
  ...season,
  season: 2025,
  games: keepFinalsAYearBack(season.games),
  nearestGames: keepFinalsAYearBack(season.nearestGames),
});

/** @param {any[]} games */
const keepFinalsAYearBack = (games) =>
  games
    .filter((game) => game.state === "final")
    .map((game) => ({ ...game, start: moveBackAYear(game.start), end: moveBackAYear(game.end) }));

export const ONE_PAST_SEASON = { pastSeasons: { 2025: keepAsLastSeason } };
