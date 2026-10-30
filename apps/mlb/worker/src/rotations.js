import {
  createRotationReader,
  coversDay,
  nameRotationKey,
  describeRotation,
} from "./adapters/rotations.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readSeasonDocs, noteLeagueRead } from "../../../../shared/worker/store-reads.js";
import { DATE_RULE, readDateParam } from "./mlb.js";
import { readMlbTeamId } from "./adapters/mlb.js";
import { readEasternDay } from "#shared/days.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createRotationServer({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const fetchClubStarts = createRotationReader({ fetchImpl });

  /**
   * The club's starts the store keeps, null when they don't reach the two weeks before `date` or
   * the store has not filled it, and whether `date` is in the store's current season. Storage errors stop the read.
   * @param {string} club
   * @param {string} date
   * @param {((key: string) => Promise<any>) | undefined} readDoc
   */
  async function readSavedStarts(club, date, readDoc) {
    const season = Number(date.slice(0, 4));
    const { docs, isCurrentSeason } = await readSeasonDocs(readDoc, season, [
      nameRotationKey(season, club),
    ]);
    const saved = docs?.[0] ?? null;
    return {
      clubStarts: saved && coversDay(saved, date, readEasternDay(now()).date) ? saved : null,
      isCurrentSeason,
    };
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} readDoc the store's documents
   * @param {() => Promise<void>} [countLeagueRead] adds one to the store's count of sheets read
   *   from MLB
   */
  async function serveRotation(url, readDoc, countLeagueRead) {
    const club = url.searchParams.get("club") ?? "";
    if (!readMlbTeamId(club))
      return respondError(400, "invalid_argument", "club must be an MLB club");
    const date = readDateParam(url.searchParams);
    if (date == null) return respondError(400, "invalid_argument", DATE_RULE);
    try {
      const saved = await readSavedStarts(club, date, readDoc);
      const hasStoreGap = saved.isCurrentSeason && !saved.clubStarts;
      const [clubStarts] = await Promise.all([
        saved.clubStarts ?? fetchClubStarts(club, date),
        hasStoreGap && countLeagueRead && noteLeagueRead(`${club}'s starts`, countLeagueRead),
      ]);
      return respondJson(describeRotation(clubStarts, date));
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read MLB: ${describeError(error)}`);
    }
  }

  return { serveRotation };
}
