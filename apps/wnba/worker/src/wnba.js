import { readEasternDay } from "#shared/days.js";
import { createSeasonParam } from "../../../../shared/worker/seasons.js";
import { fetchFeedJson } from "../../../../shared/worker/upstream.js";
import { ESPN_DAY_REQUEST } from "../../page/js/snapshot.js";

// Reading the league's own feeds, which every route the Worker serves shares.

export const SEASON_PARAM = createSeasonParam({
  firstSeason: 1997,
  readCurrentSeason: (now) => readEasternDay(now).year,
});

// The league's feeds answer only what looks like its own site in a browser: without these, the
// CDN answers with a web page and the stats site never answers at all. The stats site also hangs
// on a caller that can't take a compressed answer, and can answer anything but gzip alone from a
// months-old copy.
export const FEED_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip",
  "accept-language": "en-US,en;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  origin: "https://www.wnba.com",
  referer: "https://www.wnba.com/",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

// ESPN's site feeds answer a Worker when asked for JSON.
export const ESPN_HEADERS = {
  accept: "application/json",
  "user-agent": FEED_HEADERS["user-agent"],
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
  fetchFeedJson(fetchImpl, url, {
    feed: "ESPN",
    headers: ESPN_HEADERS,
    cacheSeconds,
  });

// ESPN's backup reads live scores from a day's scoreboard, so every read of one keeps it this long.
const ESPN_DAY_CACHE_SECONDS = 5;

/**
 * ESPN's scoreboard of one day.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} day as YYYYMMDD
 */
export const fetchEspnDay = (fetchImpl, day) =>
  fetchEspnJson(fetchImpl, ESPN_DAY_REQUEST(day), ESPN_DAY_CACHE_SECONDS);

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

/**
 * An answer from the stats site with only the named columns in each of its tables, so what's kept
 * of it stays small.
 * @param {any} answer
 * @param {string[]} columns
 */
export function trimColumns(answer, columns) {
  return {
    resultSets: answer.resultSets.map((/** @type {any} */ table) => {
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
