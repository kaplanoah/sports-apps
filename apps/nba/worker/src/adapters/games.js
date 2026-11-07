import {
  readBasketballGames,
  fetchEspnJson,
  nameEspnDayRequest,
  nameEspnStandingsRequest,
  readConferenceStandings,
  ESPN_GAME_LIMIT,
} from "../../../../../shared/worker/espn-adapter.js";
import { findTeamCodeByEspnId } from "../teams.js";

/** @param {typeof fetch} fetchImpl */
export function createGameAdapter(fetchImpl) {
  return async function readDay(season, day) {
    if (!Number.isInteger(season) || season < 2000 || season > 2100)
      throw new Error("Invalid NBA season");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day).toISOString().slice(0, 10) !== day)
      throw new Error("Invalid NBA day");
    const url = `${nameEspnDayRequest("basketball/nba", day.replaceAll("-", ""))}&limit=${ESPN_GAME_LIMIT}`;
    const answer = await fetchEspnJson(fetchImpl, url, 5, { accept: "application/json" });
    return readBasketballGames(answer, {
      leagueId: "46",
      season,
      seasonYear: season + 1,
      day,
      findTeam: findTeamCodeByEspnId,
      seasonTypes: { 1: "preseason", 2: "regular", 3: "playoffs", 5: "play-in" },
      playoffRounds: { FINAL: 4 },
      cupFinalType: "CC",
    });
  };
}

/** @param {typeof fetch} fetchImpl */
export function createStandingsAdapter(fetchImpl) {
  return async function readStandings(season) {
    if (!Number.isInteger(season) || season < 2000 || season > 2100)
      throw new Error("Invalid NBA season");
    const answer = await fetchEspnJson(
      fetchImpl,
      nameEspnStandingsRequest("basketball/nba", season + 1),
      5,
      { accept: "application/json" },
    );
    return {
      season,
      teams: readConferenceStandings(answer, {
        leagueId: "46",
        seasonYear: season + 1,
        findTeam: findTeamCodeByEspnId,
        conferenceSize: 15,
      }),
    };
  };
}
