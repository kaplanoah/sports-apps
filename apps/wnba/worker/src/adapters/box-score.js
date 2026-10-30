import {
  BasketballBoxScore,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { readAnyGameSeason, readStrictGameState } from "./wnba.js";
import { describeEspnBoxScore, isFromEspn } from "./espn-box-score.js";
import { createEspnGameReader } from "./lead.js";

import { fetchWnbaJson, LIVE_CACHE_SECONDS } from "../wnba.js";

/** @typedef {import("../../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */
/** @typedef {NonNullable<ReturnType<typeof import("./lead.js").readGame>>} Game */

// The league's CDN has no box score for a game that hasn't started, and says so with a 403.
export const NOT_YET_STATUSES = [403, 404];

/** @param {any} boxScore */
export const isLeagueFinal = (boxScore) => boxScore?.state === "final" && !isFromEspn(boxScore);

/** @param {string} id */
export const nameBoxScoreRequest = (id) =>
  `https://cdn.wnba.com/static/json/liveData/boxscore/boxscore_${id}.json`;

// The feed writes durations like PT26M; whole minutes are all the sheet shows.
const readMinutes = (duration) => Number(String(duration ?? "").match(/^PT(\d+)M/)?.[1] ?? NaN);

const describePlayer = ({ personId, firstName, familyName, statistics }) => ({
  id: personId,
  firstName,
  lastName: familyName,
  minutes: readMinutes(statistics.minutesCalculated),
  points: statistics.points,
  rebounds: statistics.reboundsTotal,
  assists: statistics.assists,
  fouls: statistics.foulsPersonal,
});

const describeTeamStats = (stats) => ({
  fieldGoals: [stats.fieldGoalsMade, stats.fieldGoalsAttempted],
  threePointers: [stats.threePointersMade, stats.threePointersAttempted],
  freeThrows: [stats.freeThrowsMade, stats.freeThrowsAttempted],
  rebounds: stats.reboundsTotal,
  assists: stats.assists,
  turnovers: stats.turnoversTotal,
  paintPoints: stats.pointsInThePaint,
  benchPoints: stats.benchPoints,
  biggestLead: stats.biggestLead,
});

const describeTeam = (team) => ({
  team: team.teamTricode,
  score: team.score,
  periods: (team.periods ?? []).map((period) => period.score),
  timeouts: team.timeoutsRemaining ?? null,
  stats: describeTeamStats(team.statistics ?? {}),
  players: (team.players ?? [])
    .filter((player) => player.played === "1" && player.statistics)
    .map(describePlayer),
});

/** @param {any} answer */
const hasBoxScore = (answer) => !!answer?.game?.homeTeam && !!answer.game.awayTeam;

/** @param {any} response the league's box score */
export function describeBoxScore(response) {
  const { game } = response;
  const stats = game.homeTeam.statistics ?? {};
  return validateSportsData(BasketballBoxScore, {
    id: String(game.gameId),
    state: readStrictGameState(game.gameStatus),
    period: game.period ?? null,
    leadChanges: stats.leadChanges ?? null,
    timesTied: stats.timesTied ?? null,
    away: describeTeam(game.awayTeam),
    home: describeTeam(game.homeTeam),
  });
}

/**
 * The league's box score for one game, read afresh.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} id
 */
async function fetchBoxScore(fetchImpl, id) {
  const response = await fetchWnbaJson(
    fetchImpl,
    nameBoxScoreRequest(id),
    LIVE_CACHE_SECONDS,
    hasBoxScore,
  );
  return describeBoxScore(response);
}

/**
 * Reads a game's box score afresh: the league's, or, while the league doesn't answer, ESPN's once
 * ESPN has one, with the league's ids for the players the store's list of the season's names.
 * Without either, it fails as the league did.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response>, espnGames?: import("./lead.js").EspnGameReader }} [options]
 */
export function createBoxScoreReader({
  fetchImpl = (input, init) => fetch(input, init),
  espnGames = createEspnGameReader({ fetchImpl }),
} = {}) {
  /**
   * @param {Game} game
   * @param {ReadDoc} readDoc
   * @param {() => Promise<any>} readSummary
   */
  async function readEspnBoxScore(game, readDoc, readSummary) {
    const summary = await readSummary();
    if (!summary) return null;
    const season = readAnyGameSeason(game.id);
    const index = season && (await readDoc(namePlayerIndexKey(season)));
    return describeEspnBoxScore(summary, game.id, index);
  }

  /**
   * @param {Game} game
   * @param {ReadDoc} readDoc the store's documents
   * @param {() => Promise<any>} [readSummary] ESPN's summary of the game, as a caller that reads it
   *   anyway shares it
   */
  return async function readBoxScore(
    game,
    readDoc,
    readSummary = () => espnGames.fetchSummary(game, readDoc),
  ) {
    try {
      return await fetchBoxScore(fetchImpl, game.id);
    } catch (error) {
      const backup = await readEspnBoxScore(game, readDoc, readSummary).catch(() => null);
      if (backup) return backup;
      throw error;
    }
  };
}
