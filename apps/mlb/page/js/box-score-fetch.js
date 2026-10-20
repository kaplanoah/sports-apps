// A game's box score for its sheet, from the Worker, which answers a final's from the store and
// reads MLB for any other.

import { SHEET_FETCH_TIMEOUT_MS } from "#shared/sheet-reads.js";
import { fetchFromWorker } from "#shared/worker-fetch.js";

// A box score read as a finger comes down on its game serves the sheet that opens on the tap.
const REUSE_MS = 5 * 1000;

/** @param {string} id */
export const fetchBoxScore = (id) =>
  fetchFromWorker(`box-score?id=${encodeURIComponent(id)}`, {
    reuseMs: REUSE_MS,
    timeoutMs: SHEET_FETCH_TIMEOUT_MS,
    isExpected: (body) => body.id === id,
  });
