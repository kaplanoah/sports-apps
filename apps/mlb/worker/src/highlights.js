import { GAME_ID } from "./adapters/mlb.js";
import { fetchHighlights, nameHighlightsKey } from "./adapters/highlights.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readSeasonDocs } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./mlb.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createHighlightsServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  /**
   * @param {URL} url
   * @param {ReadDoc} readDoc the store's documents
   */
  async function serveHighlights(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id))
      return respondError(400, "invalid_argument", "id must be an MLB game id");
    try {
      const season = url.searchParams.has("season")
        ? SEASON_PARAM.readSeason(url.searchParams, now())
        : null;
      if (url.searchParams.has("season") && season == null)
        return respondError(400, "invalid_argument", SEASON_PARAM.rule);
      const {
        docs: [kept],
        unavailable,
      } = await readSeasonDocs(readDoc, season, [nameHighlightsKey(id)]);
      if (unavailable) return unavailable;
      return respondJson(kept ?? (await fetchHighlights(fetchImpl, id)));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveHighlights };
}
