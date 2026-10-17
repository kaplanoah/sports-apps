// Which teams a game is between, for a game that names each side by its team's code.

/**
 * Whether a team plays in a game.
 * @param {{ away?: string | null, home?: string | null }} game
 * @param {string} team
 */
export const isPlayedBy = (game, team) => game.away === team || game.home === team;
