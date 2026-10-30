import {
  createScheduleReader,
  readTeams,
  nameMeetingsKey,
  describePreview,
} from "./adapters/preview.js";
import { respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./wnba.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createPreviewServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const readSchedule = createScheduleReader({ fetchImpl, now });

  /**
   * @param {URL} url
   * @param {ReadDoc} readDoc the store's documents
   */
  async function servePreview(url, readDoc) {
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondError(400, "invalid_argument", SEASON_PARAM.rule);
    const teams = readTeams(url.searchParams);
    if (!teams)
      return respondError(400, "invalid_argument", "away and home must be two WNBA teams");
    const [away, home] = teams;
    const kept = await readKeptDoc(readDoc, nameMeetingsKey(season, teams));
    if (kept) return respondJson({ season, away, home, meetings: kept.meetings });
    const schedule = await readSchedule().catch(() => null);
    if (!schedule)
      return respondError(
        502,
        "upstream_error",
        "Couldn't read the WNBA: its schedule didn't answer",
      );
    return respondJson(describePreview(schedule, { season, away, home }));
  }

  return { servePreview };
}
