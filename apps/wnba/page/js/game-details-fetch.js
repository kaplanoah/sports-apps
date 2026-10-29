// A game's details for its sheet, from the Worker, which answers from the store, or reads the
// league for what the store doesn't keep: the box score of a game that has started and the score
// through it for its lead chart, the meetings that preview one that hasn't, and the highlights of
// one that's over.

import { SHEET_FETCH_TIMEOUT_MS } from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";

// A box score read as a finger comes down on its game serves the sheet that opens on the tap.
const BOX_SCORE_REUSE_MS = 5 * 1000;
// The meetings change at most a few times a day, so a sheet opened again soon reuses them.
const PREVIEW_REUSE_MS = 10 * 60 * 1000;
// Highlights post over hours, so a sheet opened again in the next minute reuses them.
const HIGHLIGHTS_REUSE_MS = 60 * 1000;

/** @typedef {{ id: string, away: string, home: string, start: string }} GameRead */

/**
 * The query that names a game to the Worker's reads of it.
 * @param {GameRead} game
 */
const nameGameQuery = ({ id, away, home, start }) => new URLSearchParams({ id, away, home, start });

/** @param {GameRead} game */
export function fetchBoxScore(game) {
  return fetchFromWorker(`box-score?${nameGameQuery(game)}`, {
    reuseMs: BOX_SCORE_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === game.id,
  });
}

/** @param {{ season: number, away: string, home: string }} game */
export function fetchPreview({ season, away, home }) {
  const query = new URLSearchParams({ season: String(season), away, home });
  return fetchFromWorker(`preview?${query}`, {
    reuseMs: PREVIEW_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.season === season && body.away === away && body.home === home,
  });
}

/** @param {GameRead} game */
export function fetchLead(game) {
  const { away, home, start } = game;
  return fetchFromWorker(`lead?${nameGameQuery(game)}`, {
    reuseMs: BOX_SCORE_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.away === away && body.home === home && body.start === start,
  });
}

/** @param {GameRead} game */
export function fetchHighlights(game) {
  return fetchFromWorker(`highlights?${nameGameQuery(game)}`, {
    reuseMs: HIGHLIGHTS_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === game.id && Array.isArray(body.plays),
  });
}
