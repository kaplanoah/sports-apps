import {
  createPlayerReader,
  composePlayer,
  readId,
  nameRanksKey,
  nameNumbersKey,
} from "./adapters/player.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { readSeasonDocs, noteLeagueRead } from "../../../../shared/worker/store-reads.js";
import { SEASON_PARAM } from "./wnba.js";
import { nameRosterKey, readTeam } from "./adapters/roster.js";
/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export function createPlayerServer({
  loadRoster,
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
}) {
  const readPlayerFromLeague = createPlayerReader({ loadRoster, fetchImpl, now });

  /**
   * Her sheet from what the store keeps, undefined when it does not keep the season, and whether the season is the store's current one.
   * @param {{ id: string, team: string, season: number }} asked
   * @param {ReadDoc} readDoc
   */
  async function readPlayerFromStore({ id, team, season }, readDoc) {
    const kept = await readSeasonDocs(readDoc, season, [
      nameRanksKey(season),
      nameNumbersKey(season, id),
      nameRosterKey(season, team),
    ]);
    const [ranks, numbers, roster] = kept.docs ?? [];
    return {
      player: ranks ? composePlayer({ id, team, season, numbers, roster, ranks }) : undefined,
      isCurrentSeason: kept.isCurrentSeason,
      unavailable: kept.unavailable,
    };
  }

  /**
   * Her sheet from the store, or from the league for a season the store hasn't saved, counted when
   * the season is the store's current one, which the store keeps as it goes.
   * @param {{ id: string, team: string, season: number }} asked
   * @param {ReadDoc} readDoc
   * @param {() => Promise<void>} [countLeagueRead]
   */
  async function readPlayer(asked, readDoc, countLeagueRead) {
    const saved = await readPlayerFromStore(asked, readDoc);
    if (saved.player !== undefined) return saved.player;
    if (saved.unavailable) return saved.unavailable;
    const [player] = await Promise.all([
      readPlayerFromLeague(asked),
      saved.isCurrentSeason && countLeagueRead && noteLeagueRead("a player", countLeagueRead),
    ]);
    return player;
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} readDoc the store's documents
   * @param {() => Promise<void>} [countLeagueRead] adds one to the store's count of sheets read
   *   from the league
   */
  async function servePlayer(url, readDoc, countLeagueRead) {
    const id = readId(url.searchParams);
    if (!id)
      return respondError(
        400,
        "invalid_argument",
        "id must be a player's number in the WNBA's stats",
      );
    const team = readTeam(url.searchParams);
    if (!team) return respondError(400, "invalid_argument", "team must name a WNBA team");
    const season = SEASON_PARAM.readSeason(url.searchParams, now());
    if (season == null) return respondError(400, "invalid_argument", SEASON_PARAM.rule);
    try {
      const player = await readPlayer({ id, team, season }, readDoc, countLeagueRead);
      if (player instanceof Response) return player;
      if (!player)
        return respondError(404, "not_found", `The WNBA has no player ${id} in ${season}`);
      return respondJson(player);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read the WNBA: ${describeError(error)}`);
    }
  }

  return { servePlayer };
}
