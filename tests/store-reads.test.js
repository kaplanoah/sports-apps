import test from "node:test";
import assert from "node:assert/strict";
import { readSeasonDocs } from "../shared/worker/store-reads.js";

/** @param {Record<string, unknown>} docs */
const createReadDoc = (docs) => async (/** @type {string} */ key) => docs[key] ?? null;

test("a season's documents come with whether it's the store's current season", async () => {
  const readDoc = createReadDoc({ "live/current": { season: 2026 }, "a/2026": 1, "a/2025": 2 });
  assert.deepEqual(await readSeasonDocs(readDoc, 2026, ["a/2026", "b/2026"]), {
    docs: [1, null],
    isCurrentSeason: true,
  });
  assert.deepEqual(await readSeasonDocs(readDoc, 2025, ["a/2025"]), {
    docs: [2],
    isCurrentSeason: false,
  });
});

test("a store that can't be read, or no store, keeps no documents and no current season", async (t) => {
  const failing = async () => {
    throw new Error("storage is down");
  };
  t.mock.method(console, "error", () => {});
  assert.deepEqual(await readSeasonDocs(failing, 2026, ["a/2026"]), {
    docs: null,
    isCurrentSeason: false,
  });
  assert.deepEqual(await readSeasonDocs(undefined, 2026, ["a/2026"]), {
    docs: null,
    isCurrentSeason: false,
  });
});
