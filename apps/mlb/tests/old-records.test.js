import test from "node:test";
import assert from "node:assert/strict";
import { createOldRecordsJob } from "../worker/src/old-records.js";
import { createDocs } from "../../../tests/job-context.js";

/** @param {Record<string, any>} stored */
async function runJob(stored) {
  const docs = createDocs(stored);
  await createOldRecordsJob().updateStore(
    /** @type {any} */ ({ docs, loadSnapshot: async () => null, now: () => 0 }),
  );
  return { keys: [...docs.stored.keys()].sort(), removed: docs.removals };
}

test("each season's old live scores and standings go, and its record and the store's own keys stay", async () => {
  const { keys } = await runJob({
    "live/current": { season: 2026 },
    "live/status": { ok: true },
    "live/2025": { season: 2025 },
    "live/2026": { season: 2026 },
    "standings/2025": { al: [] },
    "standings/2026": { al: [] },
    "seasons/2025": { year: 2025 },
    "seasons/2026": { year: 2026 },
  });

  assert.deepEqual(keys, ["live/current", "live/status", "seasons/2025", "seasons/2026"]);
});

test("a store with nothing old left removes nothing", async () => {
  const { removed } = await runJob({
    "live/current": { season: 2026 },
    "seasons/2026": { year: 2026 },
  });

  assert.deepEqual(removed, []);
});
