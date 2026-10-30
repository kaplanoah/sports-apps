import { describeHighlights } from "../../../../shared/worker/espn-adapter.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { createEspnGameReader, readGame } from "./lead.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

// One finished game's highlights for its sheet's Highlights section, from ESPN's game summary:
// its recap video, its written recap, and the clips of the game's plays, in the order ESPN posted
// them, which follows the game. ESPN takes each clip down a while after the game, so each says
// when. The store keeps each game's (highlights-updater.js), so the route reads ESPN only for a
// game the store hasn't kept.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

const HIGHLIGHTS_COLLECTION = "highlights";

/** @param {string} id */
export const nameHighlightsKey = (id) => `${HIGHLIGHTS_COLLECTION}/${id}`;

export { describeHighlights } from "../../../../shared/worker/espn-adapter.js";

/**
 * Reads ESPN for a game's highlights afresh, as null when ESPN has no such game that day.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options]
 */
export function createHighlightsReader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const espnGames = createEspnGameReader({ fetchImpl });
  /** @param {{ id: string, away: string, home: string, start: string }} game */
  return async function readHighlights({ id, ...game }) {
    const summary = await espnGames.fetchSummary(game);
    return summary ? describeHighlights(id, summary) : null;
  };
}

export function createHighlightsServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const readHighlights = createHighlightsReader({ fetchImpl });

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveHighlights(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      const highlights =
        (await readKeptDoc(readDoc, nameHighlightsKey(game.id))) ?? (await readHighlights(game));
      if (!highlights) return respondError(404, "not_found", "ESPN has no such game that day");
      return respondJson(highlights);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read ESPN: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
