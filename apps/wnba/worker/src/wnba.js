import { fetchEspnJson as fetchSharedEspnJson } from "../../../../shared/worker/espn-adapter.js";
import { readEasternDay } from "#shared/days.js";
import { createSeasonParam } from "../../../../shared/worker/seasons.js";
import { fetchFeedJson } from "../../../../shared/worker/upstream.js";
import { ESPN_DAY_REQUEST } from "./adapters/wnba.js";

// Reading the league's own feeds, which every route the Worker serves shares.

export const SEASON_PARAM = createSeasonParam({
  firstSeason: 1997,
  readCurrentSeason: (now) => readEasternDay(now).year,
});

export const FEED_HEADERS = {
  accept: "application/json",
  "accept-encoding": "gzip",
};

// ESPN's site feeds answer a Worker when asked for JSON.
export const ESPN_HEADERS = {
  accept: "application/json",
};

/**
 * Reads one of the league's feeds, letting Cloudflare's edge keep the answer for `cacheSeconds`, or
 * not at all when it's null. A refusal comes back as a web page with a 200, which the edge keeps
 * like any answer, so only JSON that `hasData` finds its data in counts as an answer.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {number | null} cacheSeconds
 * @param {(answer: any) => boolean} hasData
 */
export const fetchWnbaJson = (fetchImpl, url, cacheSeconds, hasData) =>
  fetchFeedJson(fetchImpl, url, {
    feed: "The WNBA",
    headers: FEED_HEADERS,
    cacheSeconds,
    hasData,
  });

/**
 * Reads one of ESPN's feeds, letting Cloudflare's edge keep the answer for `cacheSeconds`.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {number} cacheSeconds
 */
export const fetchEspnJson = (fetchImpl, url, cacheSeconds) =>
  fetchSharedEspnJson(fetchImpl, url, cacheSeconds, ESPN_HEADERS);

// How long the edge keeps an answer with live scores, the league's scoreboard and box score or
// ESPN's backup for them, so each update of the snapshot and of a watched game reads fresh ones.
export const LIVE_CACHE_SECONDS = 5;

/**
 * ESPN's scoreboard of one day.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} day as YYYYMMDD
 */
export const fetchEspnDay = (fetchImpl, day) =>
  fetchEspnJson(fetchImpl, ESPN_DAY_REQUEST(day), LIVE_CACHE_SECONDS);

/**
 * The rows of one of the stats site's tables, each keyed by its column names.
 * @param {any} answer
 * @param {string} name
 * @returns {Record<string, any>[]}
 */
export function readTable(answer, name) {
  const table = (answer?.resultSets ?? []).find((/** @type {any} */ set) => set.name === name);
  if (!table) return [];
  return table.rowSet.map((/** @type {any[]} */ row) =>
    Object.fromEntries(
      table.headers.map((/** @type {string} */ header, /** @type {number} */ index) => [
        header,
        row[index],
      ]),
    ),
  );
}

/** @param {any} table */
function validateTable(table) {
  if (
    !Array.isArray(table?.headers) ||
    !Array.isArray(table?.rowSet) ||
    !table.headers.every((/** @type {unknown} */ header) => typeof header === "string") ||
    new Set(table.headers).size !== table.headers.length ||
    !table.rowSet.every(
      (/** @type {unknown} */ row) => Array.isArray(row) && row.length === table.headers.length,
    )
  )
    throw new Error("Invalid sports table");
}

/** @param {any} answer @param {string} name */
export function readRequiredTable(answer, name) {
  validateTable(
    Array.isArray(answer?.resultSets)
      ? answer.resultSets.find((entry) => entry?.name === name)
      : null,
  );
  return readTable(answer, name);
}

/**
 * An answer from the stats site with only the named columns in each of its tables, so what's kept
 * of it stays small.
 * @param {any} answer
 * @param {string[]} columns
 */
export function trimColumns(answer, columns) {
  if (!Array.isArray(answer?.resultSets)) throw new Error("Invalid sports table");
  return {
    resultSets: answer.resultSets.map((/** @type {any} */ table) => {
      validateTable(table);
      const kept = table.headers.flatMap(
        (/** @type {string} */ header, /** @type {number} */ index) =>
          columns.includes(header) ? [index] : [],
      );
      return {
        name: table.name,
        headers: kept.map((/** @type {number} */ index) => table.headers[index]),
        rowSet: table.rowSet.map((/** @type {any[]} */ row) =>
          kept.map((/** @type {number} */ index) => row[index]),
        ),
      };
    }),
  };
}

/**
 * Whether an answer holds the named table, as one that's really the stats site's does.
 * @param {string} name
 */
export const hasTable = (name) => (/** @type {any} */ answer) =>
  Array.isArray(answer?.resultSets) &&
  answer.resultSets.some((/** @type {any} */ set) => set?.name === name);

/**
 * Whether a season is the one being played now, or one not yet begun.
 * @param {number} season
 * @param {number} now
 */
export const isCurrentSeason = (season, now) =>
  season >= /** @type {number} */ (SEASON_PARAM.readSeason(new URLSearchParams(), now));
