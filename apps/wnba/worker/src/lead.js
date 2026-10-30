import {
  findEventId as findEspnEventId,
  describeBasketballLead,
  nameEspnSummaryRequest,
} from "../../../../shared/worker/espn-adapter.js";
import { OVERTIME_SECONDS, QUARTER_SECONDS, REGULATION_PERIODS } from "../../page/js/periods.js";
import { findTeamCodeByEspnId, TEAMS } from "../../page/js/teams.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { ESPN_DAY_REQUEST, formatEspnDay } from "./adapters/wnba.js";
import { fetchEspnDay, fetchEspnJson } from "./wnba.js";

// Reads ESPN for the score through one game, for the game sheet's chart of the lead: the score
// after each basket, and when in the game it came, from the scoring plays in ESPN's game summary.
// The store keeps each finished game's (game-details-updater.js), so the route reads ESPN only for
// a game still being played, or one the store hasn't kept yet.

/** @typedef {import("../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

// A live game's plays change with every basket.
const SUMMARY_CACHE_SECONDS = 15;
const GAME_ID = /^\d{10}$/;

/** @param {string} start */
const formatGameDay = (start) => formatEspnDay(Date.parse(start));

/** @param {string} start */
export const nameScoreboardRequest = (start) => ESPN_DAY_REQUEST(formatGameDay(start));

/** @param {string} eventId */
export const nameSummaryRequest = (eventId) => nameEspnSummaryRequest("basketball/wnba", eventId);

export const findEventId = (scoreboard, teams) =>
  findEspnEventId(scoreboard, teams, findTeamCodeByEspnId);
export const describeLead = (summary) =>
  describeBasketballLead(summary, {
    regulationPeriods: REGULATION_PERIODS,
    quarterSeconds: QUARTER_SECONDS,
    overtimeSeconds: OVERTIME_SECONDS,
  });

/**
 * The game a sheet's read names by its id, teams, and start, or null when it names none.
 * @param {URLSearchParams} searchParams
 */
export function readGame(searchParams) {
  const id = searchParams.get("id") ?? "";
  const away = searchParams.get("away") ?? "";
  const home = searchParams.get("home") ?? "";
  const start = searchParams.get("start") ?? "";
  const isValid =
    GAME_ID.test(id) &&
    Object.hasOwn(TEAMS, away) &&
    Object.hasOwn(TEAMS, home) &&
    away !== home &&
    Number.isFinite(Date.parse(start));
  return isValid ? { id, away, home, start } : null;
}

/** @param {{ away: string, home: string, start: string }} game */
const nameGameKey = ({ away, home, start }) => `${away}-${home}-${start}`;

export { readEndTime } from "../../../../shared/worker/espn-adapter.js";

/**
 * Reads ESPN's summary of a WNBA game, finding the game on ESPN's scoreboard for its day once.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options]
 */
export function createEspnGameReader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  /** @type {Map<string, string>} */
  const eventIds = new Map();

  /** @param {{ away: string, home: string, start: string }} game */
  async function findGameEventId(game) {
    const key = nameGameKey(game);
    if (eventIds.has(key)) return eventIds.get(key);
    const scoreboard = await fetchEspnDay(fetchImpl, formatGameDay(game.start));
    const eventId = findEventId(scoreboard, game);
    if (eventId) eventIds.set(key, eventId);
    return eventId;
  }

  return {
    /**
     * The game's summary, or null when ESPN has no such game that day.
     * @param {{ away: string, home: string, start: string }} game
     */
    async fetchSummary(game) {
      const eventId = await findGameEventId(game);
      return (
        eventId && fetchEspnJson(fetchImpl, nameSummaryRequest(eventId), SUMMARY_CACHE_SECONDS)
      );
    },
  };
}

/** @typedef {ReturnType<typeof createEspnGameReader>} EspnGameReader */

/**
 * A game's lead from ESPN's summary of it, or null when ESPN has no such game that day.
 * @param {{ away: string, home: string, start: string }} game
 * @param {any} summary ESPN's game summary, or null
 */
export const describeGameLead = (game, summary) =>
  summary ? { ...game, ...describeLead(summary) } : null;

// A finished game's lead never changes, so the one the store keeps is served as it is.
export function createLeadServer({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const espnGames = createEspnGameReader({ fetchImpl });

  /** @param {{ away: string, home: string, start: string }} game */
  const readLead = async (game) => describeGameLead(game, await espnGames.fetchSummary(game));

  /**
   * @param {{ id: string, away: string, home: string, start: string }} game
   * @param {ReadDoc | undefined} readDoc
   */
  async function loadLead({ id, ...game }, readDoc) {
    const kept = (await readKeptDoc(readDoc, nameGameDetailsKey(id)))?.lead;
    return kept?.isOver ? kept : readLead(game);
  }

  /**
   * @param {URL} url
   * @param {ReadDoc} [readDoc] the store's documents, when the Worker has a store
   */
  async function serveLead(url, readDoc) {
    const game = readGame(url.searchParams);
    if (!game)
      return respondError(
        400,
        "invalid_argument",
        "id, away, home, and start must name a WNBA game",
      );
    try {
      const lead = await loadLead(game, readDoc);
      if (!lead) return respondError(404, "not_found", "ESPN has no such game that day");
      return respondJson(lead);
    } catch (error) {
      return respondError(502, "upstream_error", `Couldn't read ESPN: ${describeError(error)}`);
    }
  }

  return { serveLead };
}
