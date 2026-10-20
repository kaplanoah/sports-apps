// How a finished playoff game reads, in the Updates box and in its notification alike. It runs in
// the page and the Worker, so the box hands it team names that open their sheets, and the Worker
// plain ones.

import { html } from "#shared/html.js";
import { describeSeriesGame, describeSeriesWin } from "#shared/series-text.js";
import { countWinsNeeded, ROUNDS } from "./snapshot.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {(code: string | null) => unknown} RenderTeam */

/** @param {Game} game */
export const isPlayoffFinal = (game) =>
  game.state === "final" &&
  !!game.series &&
  !!game.round &&
  game.away.score != null &&
  game.home.score != null &&
  game.away.score !== game.home.score;

/**
 * The side that won a finished game, and the side that lost it.
 * @param {Game} game
 */
const findResult = (game) =>
  /** @type {number} */ (game.away.score) > /** @type {number} */ (game.home.score)
    ? { winner: game.away, loser: game.home }
    : { winner: game.home, loser: game.away };

/**
 * Each team's wins in a series through one of its games.
 * @param {Game[]} games
 * @param {Game} through
 */
function countSeriesWins(games, through) {
  /** @type {Record<string, number>} */
  const wins = {};
  for (const game of games) {
    if (game.series !== through.series || !isPlayoffFinal(game)) continue;
    if ((game.number ?? 0) > (through.number ?? 0)) continue;
    const winner = findResult(game).winner.team;
    if (winner) wins[winner] = (wins[winner] ?? 0) + 1;
  }
  return wins;
}

/**
 * A finished game's winner over its loser.
 * @param {Game} game
 * @param {RenderTeam} renderTeam
 */
export function describeResult(game, renderTeam) {
  const { winner, loser } = findResult(game);
  return html`<b>${renderTeam(winner.team)}</b> beat the <b>${renderTeam(loser.team)}</b> ${winner.score}-${loser.score}`;
}

/**
 * A playoff game's winner over its loser, and where their series stood after it.
 * @param {Game} game
 * @param {Game[]} games the season's games
 * @param {RenderTeam} renderTeam
 */
export function describeWin(game, games, renderTeam) {
  const { winner, loser } = findResult(game);
  const round = /** @type {number} */ (game.round);
  const wins = countSeriesWins(games, game);
  const own = wins[winner.team ?? ""] ?? 0;
  const theirs = wins[loser.team ?? ""] ?? 0;
  const sides = {
    result: describeResult(game, renderTeam),
    series: ROUNDS[round].name,
    own,
    theirs,
  };
  if (own === countWinsNeeded(round)) return describeSeriesWin(sides);
  return describeSeriesGame({ ...sides, number: /** @type {number} */ (game.number) });
}
