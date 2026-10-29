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

/** @param {{ id: string, away: string, home: string, start: string }} game */
export function fetchBoxScore({ id, away, home, start }) {
  const query = new URLSearchParams({ id, away, home, start });
  return fetchFromWorker(`box-score?${query}`, {
    reuseMs: BOX_SCORE_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id,
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

/** @param {{ id: string, away: string, home: string, start: string }} game */
export function fetchLead({ id, away, home, start }) {
  const query = new URLSearchParams({ id, away, home, start });
  return fetchFromWorker(`lead?${query}`, {
    reuseMs: BOX_SCORE_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.away === away && body.home === home && body.start === start,
  });
}

/** @param {{ id: string, away: string, home: string, start: string }} game */
export function fetchHighlights({ id, away, home, start }) {
  const query = new URLSearchParams({ id, away, home, start });
  return fetchFromWorker(`highlights?${query}`, {
    reuseMs: HIGHLIGHTS_REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id && Array.isArray(body.plays),
  });
}
