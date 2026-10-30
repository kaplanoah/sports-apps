// A finished game's highlights for its sheet, from the Worker, which answers from the store and
// reads MLB for a game the store doesn't keep.

import { SHEET_FETCH_TIMEOUT_MS } from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";

// Highlights post over hours, so a sheet opened again in the next minute reuses them.
const REUSE_MS = 60 * 1000;

/** @param {string} id @param {number} season */
export const fetchHighlights = (id, season) =>
  fetchFromWorker(`highlights?id=${encodeURIComponent(id)}&season=${season}`, {
    reuseMs: REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id && Array.isArray(body.plays),
  });
