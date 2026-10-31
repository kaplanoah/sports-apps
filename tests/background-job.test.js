import test from "node:test";
import assert from "node:assert/strict";
import {
  createPerStoreJob,
  createSavedDocs,
  createVersionForgetter,
  listPastSeasons,
  nameVersionedKey,
  tryPastSeason,
} from "../shared/worker/background-job.js";

import { createJobStorage } from "./job-context.js";
import { RequestBudgetExhausted } from "../shared/worker/request-budget.js";

const MINUTE_MS = 60 * 1000;

/** @param {Record<string, any>} [initial] */
function createDocs(initial = {}) {
  const stored = new Map(Object.entries(initial));
  /** @type {string[]} */
  const reads = [];
  /** @type {string[]} */
  const writes = [];
  return {
    reads,
    writes,
    read: async (/** @type {string} */ key) => {
      reads.push(key);
      return structuredClone(stored.get(key)) ?? null;
    },
    write: async (/** @type {string} */ key, /** @type {any} */ doc) => {
      writes.push(key);
      stored.set(key, structuredClone(doc));
    },
    list: async (/** @type {string} */ collection) =>
      [...stored]
        .filter(([key]) => key.startsWith(`${collection}/`))
        .map(([, doc]) => structuredClone(doc)),
  };
}

/** @param {ReturnType<typeof createDocs>} docs */
const createContext = (docs) => /** @type {any} */ ({ docs, now: () => 0 });

test("a per-store job waits its delay, and keeps one update for each store, made on its first run", async () => {
  /** @type {any[]} */
  const runs = [];
  let made = 0;
  const job = createPerStoreJob(5 * MINUTE_MS, () => {
    made += 1;
    const update = { made, count: 0 };
    return async (context) => {
      update.count += 1;
      runs.push({ docs: context.docs, made: update.made, count: update.count });
    };
  });
  const first = createDocs();
  const second = createDocs();

  await job.updateStore(createContext(first));
  await job.updateStore(createContext(first));
  await job.updateStore(createContext(second));

  assert.equal(job.chooseDelay(0), 5 * MINUTE_MS);
  assert.deepEqual(runs, [
    { docs: first, made: 1, count: 1 },
    { docs: first, made: 1, count: 2 },
    { docs: second, made: 2, count: 1 },
  ]);
});

test("saved docs write a document only when it differs from the store's, reading the store once", async () => {
  const docs = createDocs({ "players/1": { name: "A", games: 3 } });
  const { readDoc, saveDoc } = createSavedDocs();

  assert.equal(await saveDoc(docs, "players/1", { games: 3, name: "A" }), false);
  assert.equal(await saveDoc(docs, "players/1", { name: "A", games: 4 }), true);
  assert.equal(await saveDoc(docs, "players/1", { name: "A", games: 4 }), false);
  assert.deepEqual(await readDoc(docs, "players/1"), { name: "A", games: 4 });
  assert.deepEqual(docs.reads, ["players/1"]);
  assert.deepEqual(docs.writes, ["players/1"]);
});

test("saved docs write a document the store doesn't have", async () => {
  const docs = createDocs();
  const { saveDoc } = createSavedDocs();

  assert.equal(await saveDoc(docs, "ranks/2026", { leaders: [] }), true);
  assert.deepEqual(docs.writes, ["ranks/2026"]);
});

test("the past seasons are the store's seasons before the current one, newest first", async () => {
  const docs = createDocs({
    "seasons/2024": { year: 2024 },
    "seasons/2026": { year: 2026 },
    "seasons/2023": { year: 2023 },
    "seasons/2025": { year: 2025 },
    "seasons/broken": { games: [] },
  });

  assert.deepEqual(await listPastSeasons(docs, 2026), [2025, 2024, 2023]);
  assert.deepEqual(await listPastSeasons(docs, 2023), []);
});

test("a version forgetter deletes each earlier version's key once while the store stays in memory, and never the current one's", async () => {
  /** @type {string[]} */
  const deleted = [];
  const storage = /** @type {any} */ ({
    delete: async (/** @type {string} */ key) => {
      deleted.push(key);
      return true;
    },
  });
  /** @param {number} version */
  const nameKey = (version) => nameVersionedKey("game-logs:2026", version);
  const forgetEarlierVersions = createVersionForgetter();

  await forgetEarlierVersions(storage, nameKey, 3);
  await forgetEarlierVersions(storage, nameKey, 3);

  assert.deepEqual(deleted, ["game-logs:2026", "game-logs:2026:v2"]);
});

test("past-season attempts share persisted retry timing, incomplete fills, failure and recovery", async () => {
  const storage = createJobStorage();
  const context = { storage, now: () => time };
  let time = 0;
  let attempts = 0;
  const fill = async () => {
    attempts += 1;
    return false;
  };
  assert.equal(await tryPastSeason(context, 2025, fill), true);
  const retryAt = storage.stored.get("past-retry:2025");
  assert.ok(retryAt > time);
  time = retryAt - 1;
  assert.equal(await tryPastSeason(context, 2025, fill), false);
  assert.equal(attempts, 1);
  assert.equal(await tryPastSeason(context, 2024, async () => true), true);
  time = retryAt;
  await assert.rejects(
    tryPastSeason(context, 2025, async () => {
      throw new Error("unavailable");
    }),
    /unavailable/,
  );
  assert.ok(storage.stored.get("past-retry:2025") > time);
  time = storage.stored.get("past-retry:2025");
  assert.equal(await tryPastSeason(context, 2025, async () => true), true);
  assert.equal(storage.stored.has("past-retry:2025"), false);
});

test("history budget stops leave the newest season immediately resumable", async () => {
  const storage = createJobStorage();
  const context = { storage, now: () => 0, remainingRequests: () => 0 };
  assert.equal(await tryPastSeason(context, 2025, async () => false), true);
  assert.equal(await storage.get("past-retry:2025"), undefined);
  await assert.rejects(
    tryPastSeason(context, 2025, async () => {
      throw new RequestBudgetExhausted("No requests left");
    }),
    RequestBudgetExhausted,
  );
  assert.equal(await storage.get("past-retry:2025"), undefined);
  assert.equal(await tryPastSeason(context, 2025, async () => true), true);
});
