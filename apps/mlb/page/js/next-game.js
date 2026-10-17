// Which of a club's games its standings row's Next column shows: its game under way today, from
// the slate, or else its next game still to start, from its row.

import { isPlayedBy } from "#shared/game-clubs.js";

/**
 * @typedef {{ at?: string, tbd?: boolean, postseason?: boolean }} RowGame a game a standings row
 *   lists still to come
 */

/**
 * @param {RowGame | undefined} game
 * @param {number} now
 */
const hasStarted = (game, now) => !!game?.at && !game.tbd && Date.parse(game.at) <= now;

/**
 * A club's next game, from its standings row, which lists only games still to come. One that has
 * started isn't next, even before the standings refresh.
 * @param {{ next?: RowGame, then?: RowGame }} row
 * @param {number} now
 */
export function findNextGame(row, now) {
  if (!hasStarted(row.next, now)) return row.next;
  return hasStarted(row.then, now) ? null : row.then;
}

/**
 * Whether the Next column shows a club's next game: a club out of the table's race still shows a
 * playoff game, since it only has one while alive.
 * @param {RowGame | null | undefined} next
 * @param {boolean} isOut
 */
export const isNextShown = (next, isOut) => !!next?.at && (!isOut || !!next.postseason);

/** @param {{ tbd?: boolean, start: string }} game @param {number} now */
const hasPassedStart = (game, now) => !game.tbd && Date.parse(game.start) <= now;

/**
 * A game still to start that's about to, as MLB can call a start delayed before its scheduled
 * time.
 * @param {{ state: string, delay?: string, tbd?: boolean, start: string }} game
 * @param {number} now
 */
const isAboutToStart = (game, now) =>
  game.state === "pre" && (!!game.delay || hasPassedStart(game, now));

/**
 * A club's game under way today, or about to start, or null.
 * @template {{ state: string, away?: string, home?: string, delay?: string, tbd?: boolean, start: string, postseason?: boolean }} Game
 * @param {Game[]} todayGames the slate's games today
 * @param {string} id
 * @param {number} now
 * @returns {Game | null}
 */
export function findGameUnderWay(todayGames, id, now) {
  const games = todayGames.filter((game) => isPlayedBy(game, id));
  return (
    games.find((game) => game.state === "live") ||
    games.find((game) => isAboutToStart(game, now)) ||
    null
  );
}
