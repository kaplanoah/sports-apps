import { listSlateGames } from "../../page/js/slate.js";
import { fetchBoxScore } from "./adapters/box-score.js";

// The box score of each game a page has open, which the store reads with each update and pushes to
// the pages watching: the lineups of one to be played today, as the clubs post them, and every play
// of one being played. A game on a later day has no lineups yet, and one whose final box score is
// saved needs no more. A read that fails keeps what was saved.

/**
 * @param {any} slate
 * @param {any} game
 */
const mayHaveChanged = (slate, game) =>
  game.state === "live" ||
  game.state === "final" ||
  (game.state === "pre" && game.date === slate.today.date);

/** @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options] */
export function createWatchedGameLoader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {string} id
   * @param {any} snapshot
   * @param {any} stored the box score saved last
   */
  return async function loadWatchedGame(id, snapshot, stored) {
    const slate = snapshot.slate;
    const game = slate && listSlateGames(slate).find((each) => each.id === id);
    if (!game || stored?.state === "final" || !mayHaveChanged(slate, game)) return null;
    return fetchBoxScore(fetchImpl, id).catch(() => null);
  };
}
