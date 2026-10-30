import { fetchHighlights, nameHighlightsKey, GAME_ID } from "./adapters/highlights.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./mlb.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createHighlightsServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveHighlights(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id))
      return respondError(400, "invalid_argument", "id must be an MLB game id");
    try {
      const kept = await readKeptDoc(readDoc, nameHighlightsKey(id));
      const current = readDoc && (await readDoc("live/current"))?.season;
      const season = url.searchParams.has("season")
        ? SEASON_PARAM.readSeason(url.searchParams, Date.now())
        : current;
      if (url.searchParams.has("season") && season == null)
        return respondError(400, "invalid_argument", SEASON_PARAM.rule);
      if (!kept && current && season < current)
        return respondError(409, "not_available_yet", "Not available yet");
      return respondJson(kept ?? (await fetchHighlights(fetchImpl, id)));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
