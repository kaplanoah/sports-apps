import { createReusedLoader } from "../../../../../shared/worker/upstream.js";
import {
  findEventId as findEspnEventId,
  describeBasketballLead,
  nameEspnSummaryRequest,
} from "../../../../../shared/worker/espn-adapter.js";
import { OVERTIME_SECONDS, QUARTER_SECONDS, REGULATION_PERIODS } from "../../../page/js/periods.js";
import { findTeamCodeByEspnId, TEAMS } from "../../../page/js/teams.js";

import { ESPN_DAY_REQUEST, ESPN_SPORT, formatEspnDay } from "./wnba.js";
import { fetchEspnDay, fetchEspnJson } from "../wnba.js";

/** @typedef {import("../../../../../shared/worker/store-reads.js").ReadDoc} ReadDoc */

// A live game's plays change with every basket.
const SUMMARY_CACHE_SECONDS = 15;
const GAME_ID = /^\d{10}$/;

/** @param {string} start */
const formatGameDay = (start) => formatEspnDay(Date.parse(start));

/** @param {string} start */
export const nameScoreboardRequest = (start) => ESPN_DAY_REQUEST(formatGameDay(start));

/** @param {string} eventId */
export const nameSummaryRequest = (eventId) => nameEspnSummaryRequest(ESPN_SPORT, eventId);

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

/** @param {string} id */
export const nameEspnMatchKey = (id) => `espnMatches/${id}`;

/** @param {any} snapshot @param {any[]} answers */
export function listEspnMatches(snapshot, answers) {
  const games = [...snapshot.games, ...snapshot.nearestGames];
  const matches = new Map();
  for (const game of games) {
    if (!game.start || !game.away.team || !game.home.team) continue;
    const teams = { away: game.away.team, home: game.home.team, start: game.start };
    const day = formatGameDay(game.start);
    const events = answers
      .flatMap((answer) => answer.events ?? [])
      .filter(
        (event) => Number.isFinite(Date.parse(event.date)) && formatGameDay(event.date) === day,
      );
    const eventIds = [
      ...new Set(
        events.flatMap((event) => {
          const id = findEventId({ events: [event] }, teams);
          return id ? [id] : [];
        }),
      ),
    ];
    if (eventIds.length === 1)
      matches.set(game.id, { id: game.id, eventId: eventIds[0], ...teams });
  }
  return [...matches.values()];
}

export { readEndTime } from "../../../../../shared/worker/espn-adapter.js";

const SCOREBOARD_REUSE_MS = 15000;

/**
 * Reads a saved ESPN match, or finds one from a briefly reused day scoreboard.
 * @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options]
 */
export function createEspnGameReader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const loadDay = createReusedLoader(
    (day) => fetchEspnDay(fetchImpl, day),
    SCOREBOARD_REUSE_MS,
    () => Date.now(),
  );

  /** @param {{ id?: string, away: string, home: string, start: string }} game @param {ReadDoc | undefined} readDoc */
  async function findGameEventId(game, readDoc) {
    const kept = game.id && readDoc && (await readDoc(nameEspnMatchKey(game.id)));
    if (kept && kept.away === game.away && kept.home === game.home) return kept.eventId;
    const scoreboard = await loadDay(formatGameDay(game.start));
    return findEventId(scoreboard, game);
  }

  return {
    /**
     * The game's summary, or null when ESPN has no such game that day.
     * @param {{ id?: string, away: string, home: string, start: string }} game
     * @param {ReadDoc} [readDoc]
     */
    async fetchSummary(game, readDoc) {
      const eventId = await findGameEventId(game, readDoc);
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
  summary
    ? { away: game.away, home: game.home, start: game.start, ...describeLead(summary) }
    : null;
