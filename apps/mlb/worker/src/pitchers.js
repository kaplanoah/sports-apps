import {
  createPitcherReader,
  readPersonId,
  namePitcherKey,
  nameStartersKey,
  composePitcher,
} from "./adapters/pitchers.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readSeasonDocs, noteLeagueRead } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./mlb.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createPitcherServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const { fetchPitcher, loadQualified } = createPitcherReader({ fetchImpl, now });

  /**
   * What the store keeps of the sheet, each part null when it doesn't keep it, when it has not been filled.
   * @param {number} id
   * @param {number} season
   * @param {ReadDoc} readDoc
   */
  async function readSaved(id, season, readDoc) {
    const { docs, isCurrentSeason } = await readSeasonDocs(readDoc, season, [
      namePitcherKey(season, id),
      nameStartersKey(season),
    ]);
    const [pitcher = null, qualified = null] = docs ?? [];
    return { pitcher, qualified, isCurrentSeason };
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} readDoc the store's documents
   * @param {() => Promise<void>} [countLeagueRead] adds one to the store's count of sheets read
   *   from MLB
   */
  async function servePitcher(url, readDoc, countLeagueRead) {
    const id = readPersonId(url.searchParams);
    if (id == null) return respondError(400, "invalid_argument", "id must be an MLB person id");
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondError(400, "invalid_argument", SEASON_PARAM.rule);
    try {
      const saved = await readSaved(id, season, readDoc);
      const hasStoreGap = saved.isCurrentSeason && (!saved.pitcher || !saved.qualified);
      const [pitcher, qualified] = await Promise.all([
        saved.pitcher ?? fetchPitcher(id, season),
        saved.qualified ?? loadQualified(season),
        hasStoreGap && countLeagueRead && noteLeagueRead("a pitcher", countLeagueRead),
      ]);
      if (!pitcher) return respondError(404, "not_found", "MLB has no pitcher with that id");
      return respondJson(composePitcher(pitcher, qualified, now()));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { servePitcher };
}
