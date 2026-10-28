// How a playoff game reads in every league's Updates box, notifications, and game sheet: its
// result, then where its series stands. A notification breaks its title from its body at a spaced dash, so
// the comma keeps the game and its series in one title.

import { html } from "./html.js";

/**
 * @param {number} own the wins of the side the sentence is about
 * @param {number} theirs its opponent's
 */
export const describeSeriesStanding = (own, theirs) =>
  own > theirs ? "lead" : own === theirs ? "tie" : "trail";

/**
 * A series' wins, as "2-1", the way every score and series lead reads, which the Updates box keeps
 * on one line.
 * @param {number} own
 * @param {number} theirs
 */
export const renderSeriesWins = (own, theirs) =>
  html`<span class="series-score">${own}-${theirs}</span>`;

/**
 * A game that leaves its series going. `result` is the game as the league words it, and `own`
 * and `theirs` each side's wins through it.
 * @param {{ result: unknown, number: number, series: string, own: number, theirs: number }} game
 */
export function describeSeriesGame({ result, number, series, own, theirs }) {
  const standing = describeSeriesStanding(own, theirs);
  return html`${result} in Game&nbsp;${number}, ${standing} the ${series} ${renderSeriesWins(own, theirs)}`;
}

/**
 * Where a series stands, as "Tied 2-2", "Guardians lead 3-1", or, once it's over, "Guardians win
 * 4-1". `leader` names the side with more wins, the one `wins` counts.
 * @param {{ leader: string, wins: number, losses: number, isOver: boolean }} series
 */
export function describeSeriesLead({ leader, wins, losses, isOver }) {
  const score = `${wins}-${losses}`;
  if (isOver) return `${leader} win ${score}`;
  if (wins === losses) return `Tied ${score}`;
  return `${leader} lead ${score}`;
}

/**
 * Where a series stood after a game, as its winner tells it: "Dream won to lead 2-0", "Dream won
 * to tie 1-1", "Dream won but trail 1-2", or "Dream won the series 2-0".
 * @param {{ winner: string, wins: number, losses: number, winsNeeded: number }} result `winner`
 *   names the side that won the game, whose series `wins` and `losses` count
 */
export function describeSeriesAfterWin({ winner, wins, losses, winsNeeded }) {
  const score = `${wins}-${losses}`;
  if (wins === winsNeeded) return `${winner} won the series ${score}`;
  if (wins === losses) return `${winner} won to tie ${score}`;
  if (wins < losses) return `${winner} won but trail ${score}`;
  return `${winner} won to lead ${score}`;
}

/**
 * A game that wins its series.
 * @param {{ result: unknown, series: string, own: number, theirs: number }} game
 */
export const describeSeriesWin = ({ result, series, own, theirs }) =>
  html`${result} to win the ${series} ${renderSeriesWins(own, theirs)}`;

/**
 * An if-needed game is confirmed once the series guarantees it will be played.
 * @param {{ ifNecessary: boolean, number: number, winsNeeded: number, wins: number[] }} game
 */
export const isNecessaryPlayoffGame = ({ ifNecessary, number, winsNeeded, wins }) =>
  !ifNecessary || number <= Math.max(winsNeeded, wins.reduce((total, won) => total + won, 0) + 1);
