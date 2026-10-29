import { OVERTIME_SECONDS, QUARTER_SECONDS, REGULATION_PERIODS } from "../../page/js/periods.js";
import { findTeamCodeByEspnId, TEAMS } from "../../page/js/teams.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { readKeptDoc } from "../../../../shared/worker/store-reads.js";
import { ESPN_DAY_REQUEST, ESPN_SITE, formatEspnDay } from "../../page/js/snapshot.js";
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
export const nameSummaryRequest = (eventId) => `${ESPN_SITE}/summary?event=${eventId}`;

/** @param {number} period */
const measurePeriod = (period) =>
  period > REGULATION_PERIODS ? OVERTIME_SECONDS : QUARTER_SECONDS;

/**
 * The seconds played when a period's clock reads `clock`, like 7:58 or, in its last minute, 45.2.
 * @param {number} period
 * @param {string} clock
 */
function countSecondsPlayed(period, clock) {
  const [minutes, seconds] = String(clock).includes(":")
    ? String(clock).split(":").map(Number)
    : [0, Number(clock)];
  const before = Array.from({ length: period - 1 }, (_, index) => measurePeriod(index + 1)).reduce(
    (sum, length) => sum + length,
    0,
  );
  const left = Math.min(measurePeriod(period), minutes * 60 + seconds);
  return Math.round(before + measurePeriod(period) - left);
}

/**
 * @param {any} competition
 * @param {"away" | "home"} place
 */
const findCompetitorCode = (competition, place) =>
  findTeamCodeByEspnId(
    competition?.competitors?.find((competitor) => competitor.homeAway === place)?.team?.id,
  );

/**
 * The day's ESPN game between the two teams, home and away as asked.
 * @param {any} scoreboard
 * @param {{ away: string, home: string }} teams
 */
export function findEventId(scoreboard, { away, home }) {
  const event = (scoreboard?.events ?? []).find((each) => {
    const [competition] = each.competitions ?? [];
    return (
      findCompetitorCode(competition, "away") === away &&
      findCompetitorCode(competition, "home") === home
    );
  });
  return event ? String(event.id) : null;
}

/**
 * Each scoring play's time in the game, in seconds from tip-off, with the score after it, from a
 * tied start. A game that went to overtime counts its periods past the fourth.
 * @param {any} summary ESPN's game summary
 */
export function describeLead(summary) {
  const scores = (summary?.plays ?? [])
    .filter((play) => play.scoringPlay && play.period?.number && play.clock?.displayValue)
    .map((play) => [
      countSecondsPlayed(play.period.number, play.clock.displayValue),
      play.awayScore,
      play.homeScore,
    ]);
  const lastPeriod = Math.max(
    REGULATION_PERIODS,
    ...(summary?.plays ?? []).map((play) => play.period?.number ?? 0),
  );
  return {
    periods: lastPeriod,
    isOver: summary?.header?.competitions?.[0]?.status?.type?.completed === true,
    scores: [[0, 0, 0], ...scores],
  };
}

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

/**
 * When the game ended, from the time ESPN logged its last play, or null before ESPN has it.
 * @param {any} summary ESPN's game summary
 */
export const readEndTime = (summary) =>
  (summary?.plays ?? []).findLast((play) => play.type?.text === "End Game")?.wallclock ?? null;

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
