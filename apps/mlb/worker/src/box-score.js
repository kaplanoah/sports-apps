import { fetchBoxScore, nameGameDetailsKey, GAME_ID } from "./adapters/box-score.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createBoxScoreServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveBoxScore(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id))
      return respondError(400, "invalid_argument", "id must be an MLB game id");
    try {
      const kept = await readKeptDoc(readDoc, nameGameDetailsKey(id));
      if (kept?.state === "final") return respondJson(kept);
      try {
        return respondJson(await fetchBoxScore(fetchImpl, id));
      } catch (error) {
        if (kept) return respondJson(kept);
        throw error;
      }
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveBoxScore };
}
