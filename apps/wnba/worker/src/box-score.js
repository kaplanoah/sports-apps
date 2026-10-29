import { namePlayerIndexKey } from "#shared/page-search.js";
import { readAnyGameSeason, readGameState } from "../../page/js/snapshot.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { describeEspnBoxScore } from "./espn-box-score.js";
import { createEspnGameReader, readGame } from "./lead.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { fetchWnbaJson, LIVE_CACHE_SECONDS } from "./wnba.js";

// Reads the league's box score for one game, for the game sheet: each team's points by quarter,
// its stats, and every player who got in, or ESPN's while the league doesn't answer. The store
// keeps each finished game's (game-details-updater.js), so the route reads the league only for a
// game still being played, or one the store hasn't kept yet.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */
/** @typedef {NonNullable<ReturnType<typeof readGame>>} Game */

// The league's CDN has no box score for a game that hasn't started, and says so with a 403.
const NOT_YET_STATUSES = [403, 404];

/** @param {string} id */
export const nameBoxScoreRequest = (id) =>
  `https://cdn.wnba.com/static/json/liveData/boxscore/boxscore_${id}.json`;

// The feed writes durations like PT26M; whole minutes are all the sheet shows.
const readMinutes = (duration) => Number(String(duration ?? "").match(/^PT(\d+)M/)?.[1] ?? 0);

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
  return {
    id: String(game.gameId),
    state: readGameState(game.gameStatus),
    period: game.period ?? null,
    leadChanges: stats.leadChanges ?? null,
    timesTied: stats.timesTied ?? null,
    away: describeTeam(game.awayTeam),
    home: describeTeam(game.homeTeam),
  };
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
   * @param {ReadDoc | undefined} readDoc
   * @param {() => Promise<any>} readSummary
   */
  async function readEspnBoxScore(game, readDoc, readSummary) {
    const summary = await readSummary();
    if (!summary) return null;
    const season = readAnyGameSeason(game.id);
    const index = season && (await readKeptDoc(readDoc, namePlayerIndexKey(season)));
    return describeEspnBoxScore(summary, game.id, index);
  }

  /**
   * @param {Game} game
   * @param {ReadDoc} [readDoc] the store's documents, when there's a store
   * @param {() => Promise<any>} [readSummary] ESPN's summary of the game, as a caller that reads it
   *   anyway shares it
   */
  return async function readBoxScore(
    game,
    readDoc,
    readSummary = () => espnGames.fetchSummary(game),
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

// A finished game's box score never changes, so the one the store keeps is served as it is.
export function createBoxScoreServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const readBoxScore = createBoxScoreReader({ fetchImpl });

  /**
   * @param {Game} game
   * @param {ReadDoc | undefined} readDoc
   */
  async function loadBoxScore(game, readDoc) {
    const kept = (await readKeptDoc(readDoc, nameGameDetailsKey(game.id)))?.boxScore;
    return kept?.state === "final" ? kept : readBoxScore(game, readDoc);
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveBoxScore(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      return respondJson(await loadBoxScore(game, readDoc));
    } catch (error) {
      if (NOT_YET_STATUSES.includes(/** @type {{ status?: number }} */ (error).status))
        return respondError(
          404,
          "not_found",
          "Neither the WNBA nor ESPN has a box score for that game yet",
        );
      return respondError(
        502,
        "upstream_error",
        `Couldn't read the WNBA or ESPN: ${describeError(error)}`,
      );
    }
  }

  return { serveBoxScore };
}
