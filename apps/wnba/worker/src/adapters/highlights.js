import { describeHighlights } from "../../../../../shared/worker/espn-adapter.js";
import { createEspnGameReader } from "./lead.js";

/** @typedef {import("../../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

const HIGHLIGHTS_COLLECTION = "highlights";

/** @param {string} id */
export const nameHighlightsKey = (id) => `${HIGHLIGHTS_COLLECTION}/${id}`;

export { describeHighlights } from "../../../../../shared/worker/espn-adapter.js";

/**
 * Reads ESPN for a game's highlights afresh, as null when ESPN has no such game that day.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response>, espnGames?: import("./lead.js").EspnGameReader }} [options]
 */
export function createHighlightsReader({
  fetchImpl = (input, init) => fetch(input, init),
  espnGames = createEspnGameReader({ fetchImpl }),
} = {}) {
  /** @param {{ id: string, away: string, home: string, start: string }} game @param {ReadDoc} readDoc */
  return async function readHighlights(game, readDoc) {
    const summary = await espnGames.fetchSummary(game, readDoc);
    return summary ? describeHighlights(game.id, summary) : null;
  };
}
