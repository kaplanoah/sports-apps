import { createRosterReader, readTeam, nameRosterKey } from "./adapters/roster.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./wnba.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createRosterServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const loadRoster = createRosterReader({ fetchImpl, now });

  /**
   * @param {URL} url
   * @param {import("../../../../shared/worker/store-reads.js").ReadDoc} [readDoc] the store's documents, when the Worker
   *   has a store
   */
  async function serveRoster(url, readDoc) {
    const team = readTeam(url.searchParams);
    if (!team) return respondError(400, "invalid_argument", "team must name a WNBA team");
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondError(400, "invalid_argument", SEASON_PARAM.rule);
    try {
      const saved = await readKeptDoc(readDoc, nameRosterKey(season, team));
      const current = readDoc && (await readDoc("live/current"))?.season;
      if (!saved && current && season < current)
        return respondError(409, "not_available_yet", "Not available yet");
      return respondJson(saved ?? (await loadRoster(`${team}:${season}`)));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read the WNBA: ${describeError(error)}`);
    }
  }

  return { loadRoster, serveRoster };
}
