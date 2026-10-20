// What the matchup sheet reads from the Worker, which keeps it from MLB: a pitcher's side, or the
// last starters of a club that hasn't named one.

import { SHEET_FETCH_TIMEOUT_MS } from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";

// A pitcher's numbers and a club's starts change at most once a game, so a sheet opened again
// soon reuses them.
const REUSE_MS = 10 * 60 * 1000;
// What the Worker doesn't keep, like a past season's pitcher, it reads from MLB one read after
// another, the qualified starters and then their people in batches, which can take longer than the
// shared wait for a sheet's read.
const MATCHUP_FETCH_TIMEOUT_MS = SHEET_FETCH_TIMEOUT_MS + 5 * 1000;

/**
 * @param {number} id
 * @param {number} season
 */
export const fetchPitcher = (id, season) =>
  fetchFromWorker(`pitcher?id=${id}&season=${season}`, {
    reuseMs: REUSE_MS,
    timeoutMs: MATCHUP_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id,
  });

/**
 * @param {string} club
 * @param {string} date the league's day of the game the club hasn't named a starter for
 */
export const fetchRotation = (club, date) =>
  fetchFromWorker(`rotation?club=${club}&date=${date}`, {
    reuseMs: REUSE_MS,
    timeoutMs: MATCHUP_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.club === club && Array.isArray(body.starters),
  });
