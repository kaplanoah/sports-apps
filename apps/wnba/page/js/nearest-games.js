// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

import { findNearestGames } from "#shared/nearest-games.js";

/** @typedef {{ id: string, state: string, status?: string, series?: string | null, away: { team: string | null }, home: { team: string | null } }} SeasonGame */

/**
 * @param {SeasonGame} game
 * @param {string} team
 */
const isPlaying = (game, team) => game.away.team === team || game.home.team === team;

// The league marks a game it put off or called off in its status, and keeps it as one to come.
/** @param {{ status?: string }} game */
export const isPutOff = (game) => /postpon|ppd|cancel/i.test(game.status ?? "");

/** @param {SeasonGame} game */
const hasBothTeams = (game) => !!(game.away.team && game.home.team);

/**
 * A team's last finished game, the one it's playing, and its next, each null when it has none. The
 * next is one whose other team is known, and never one put off or left over in a series that's
 * already decided, which won't be played then.
 * @template {SeasonGame} Game
 * @param {Game[]} games in order of start
 * @param {string} team
 * @param {Set<string>} decidedSeries
 * @returns {{ last: Game | null, now: Game | null, next: Game | null }}
 */
export const findTeamNearestGames = (games, team, decidedSeries) =>
  findNearestGames(
    games.filter((game) => isPlaying(game, team)),
    (game) => hasBothTeams(game) && !isPutOff(game) && !decidedSeries.has(game.series ?? ""),
  );
