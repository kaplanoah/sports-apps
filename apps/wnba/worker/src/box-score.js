import { readGameState } from "../../page/js/snapshot.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { fetchWnbaJson, LIVE_CACHE_SECONDS } from "./wnba.js";

// Reads the league's box score for one game, for the game sheet: each team's points by quarter,
// its stats, and every player who got in. The store keeps each finished game's
// (game-details-updater.js), so the route reads the league only for a game still being played, or
// one the store hasn't kept yet.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

export const GAME_ID = /^\d{10}$/;
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
export async function fetchBoxScore(fetchImpl, id) {
  const response = await fetchWnbaJson(
    fetchImpl,
    nameBoxScoreRequest(id),
    LIVE_CACHE_SECONDS,
    hasBoxScore,
  );
  return describeBoxScore(response);
}

// A finished game's box score never changes, so the one the store keeps is served as it is.
export function createBoxScoreServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /**
   * @param {string} id
   * @param {ReadDoc | undefined} readDoc
   */
  async function loadBoxScore(id, readDoc) {
    const kept = (await readKeptDoc(readDoc, nameGameDetailsKey(id)))?.boxScore;
    return kept?.state === "final" ? kept : fetchBoxScore(fetchImpl, id);
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveBoxScore(url, readDoc) {
    const id = url.searchParams.get("id") ?? "";
    if (!GAME_ID.test(id))
      return respondError(400, "invalid_argument", "id must be a WNBA game id");
    try {
      return respondJson(await loadBoxScore(id, readDoc));
    } catch (error) {
      if (NOT_YET_STATUSES.includes(/** @type {{ status?: number }} */ (error).status))
        return respondError(404, "not_found", "The WNBA has no box score for that game yet");
      return respondError(502, "upstream_error", `Couldn't read the WNBA: ${describeError(error)}`);
    }
  }

  return { serveBoxScore };
}
