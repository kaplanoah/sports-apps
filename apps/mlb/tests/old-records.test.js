import test from "node:test";
import assert from "node:assert/strict";
import { createOldRecordsJob } from "../worker/src/old-records.js";

/** @param {Record<string, any>} stored */
async function runJob(stored) {
  const documents = new Map(Object.entries(stored));
  const removed = [];
  const docs = {
    read: async (key) => documents.get(key) ?? null,
    list: async (collection) =>
      [...documents].filter(([key]) => key.startsWith(`${collection}/`)).map(([, doc]) => doc),
    write: async (key, doc) => {
      documents.set(key, doc);
    },
    remove: async (key) => {
      removed.push(key);
      documents.delete(key);
    },
  };
  await createOldRecordsJob().updateStore(
    /** @type {any} */ ({ docs, loadSnapshot: async () => null, now: () => 0 }),
  );
  return { keys: [...documents.keys()].sort(), removed };
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
