import { createEspnGameReader } from "./adapters/lead.js";
import { createBoxScoreReader, NOT_YET_STATUSES } from "./adapters/box-score.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

import { readGame } from "./adapters/lead.js";
import { nameGameDetailsKey } from "./store-docs.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */
/** @typedef {NonNullable<ReturnType<typeof readGame>>} Game */

export function createBoxScoreServer({
  fetchImpl = (input, init) => fetch(input, init),
  espnGames = createEspnGameReader({ fetchImpl }),
} = {}) {
  const readBoxScore = createBoxScoreReader({ fetchImpl, espnGames });

  /**
   * @param {Game} game
   * @param {ReadDoc | undefined} readDoc
   */
  async function loadBoxScore(game, readDoc) {
    const kept = (await readKeptDoc(readDoc, nameGameDetailsKey(game.id)))?.boxScore;
    if (kept?.state === "final") return kept;
    try {
      return await readBoxScore(game, readDoc);
    } catch (error) {
      if (kept) return kept;
      throw error;
    }
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveBoxScore(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      return respondJson(await loadBoxScore(game, readDoc));
    } catch (error) {
      if (NOT_YET_STATUSES.includes(/** @type {{ status?: number }} */ (error).status))
        return respondError(
          404,
          "not_found",
          "Neither the WNBA nor ESPN has a box score for that game yet",
        );
      return respondError(
        502,
        "upstream_error",
        `Couldn't read the WNBA or ESPN: ${describeError(error)}`,
      );
    }
  }

  return { serveBoxScore };
}
