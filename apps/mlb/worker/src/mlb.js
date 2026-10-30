import { readEasternDay } from "#shared/days.js";
import { MLB_API } from "./adapters/mlb.js";
import { createSeasonParam, LAST_SEASON } from "../../../../shared/worker/seasons.js";
import { fetchFeedJson } from "../../../../shared/worker/upstream.js";

const FIRST_SEASON = 1995;
// MLB's live feed changes with every pitch, so a read of it is reused only moments.
export const LIVE_FEED_CACHE_SECONDS = 5;
const MLB_HEADERS = { accept: "application/json", "user-agent": "mlb-postseason-page/1.0" };
export const SEASON_PARAM = createSeasonParam({
  firstSeason: FIRST_SEASON,
  readCurrentSeason: (now) => readEasternDay(now).year,
});
export const DATE_RULE = `date must be a day written YYYY-MM-DD from ${FIRST_SEASON} to ${LAST_SEASON}`;

/**
 * The "YYYY-MM-DD" day a request names, or null when it names none or one that isn't a real day.
 * @param {URLSearchParams} searchParams
 */
export function readDateParam(searchParams) {
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const isRealDay = new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(date);
  return isRealDay && year >= FIRST_SEASON && year <= LAST_SEASON ? date : null;
}

/**
 * Reads a path from MLB's Stats API, letting Cloudflare's edge keep the answer for `cacheSeconds`.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} path
 * @param {number} cacheSeconds
 */
export const fetchMlbJson = (fetchImpl, path, cacheSeconds) =>
  fetchFeedJson(fetchImpl, MLB_API + path, {
    feed: "MLB Stats API",
    headers: MLB_HEADERS,
    cacheSeconds,
  });
