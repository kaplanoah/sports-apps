import { createEspnGameReader } from "./adapters/lead.js";
import { createHighlightsReader, nameHighlightsKey } from "./adapters/highlights.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

import { readGame } from "./adapters/lead.js";

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createHighlightsServer({
  fetchImpl = (input, init) => fetch(input, init),
  espnGames = createEspnGameReader({ fetchImpl }),
} = {}) {
  const readHighlights = createHighlightsReader({ fetchImpl, espnGames });

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
        (await readKeptDoc(readDoc, nameHighlightsKey(game.id))) ??
        (await readHighlights(game, readDoc));
      if (!highlights) return respondError(404, "not_found", "ESPN has no such game that day");
      return respondJson(highlights);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read ESPN: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
