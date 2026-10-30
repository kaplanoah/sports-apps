import { createEspnGameReader, describeGameLead, readGame } from "./adapters/lead.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

import { nameGameDetailsKey } from "./store-docs.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createLeadServer({
  fetchImpl = (input, init) => fetch(input, init),
  espnGames = createEspnGameReader({ fetchImpl }),
} = {}) {
  /** @param {{ away: string, home: string, start: string }} game */
  const readLead = async (game, readDoc) =>
    describeGameLead(game, await espnGames.fetchSummary(game, readDoc));

  /**
   * @param {{ id: string, away: string, home: string, start: string }} game
   * @param {ReadDoc | undefined} readDoc
   */
  async function loadLead(game, readDoc) {
    const kept = (await readKeptDoc(readDoc, nameGameDetailsKey(game.id)))?.lead;
    if (kept?.isOver) return kept;
    try {
      return await readLead(game, readDoc);
    } catch (error) {
      if (kept) return kept;
      throw error;
    }
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveLead(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      const lead = await loadLead(game, readDoc);
      if (!lead) return respondError(404, "not_found", "ESPN has no such game that day");
      return respondJson(lead);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read ESPN: ${describeError(error)}`);
    }
  }

  return { serveLead };
}
