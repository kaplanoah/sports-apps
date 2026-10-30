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
    unavailable: null,
  });
  assert.deepEqual(await readSeasonDocs(readDoc, 2025, ["a/2025"]), {
    docs: [2],
    isCurrentSeason: false,
    unavailable: null,
  });
});

test("a failed store read propagates, while an empty store has no documents", async () => {
  const failing = async () => {
    throw new Error("storage is down");
  };
  await assert.rejects(readSeasonDocs(failing, 2026, ["a/2026"]), /storage is down/);
  assert.deepEqual(await readSeasonDocs(async () => null, 2026, ["a/2026"]), {
    docs: [null],
    isCurrentSeason: false,
    unavailable: null,
  });
});
