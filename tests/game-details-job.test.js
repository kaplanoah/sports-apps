import test from "node:test";
import assert from "node:assert/strict";
import { createGameDetailsJob } from "../shared/worker/game-details-job.js";
import { createDeferred } from "./deferred.js";
import { createDocs, createJobStorage } from "./job-context.js";

const NOW = 1_790_000_000_000;
const KEY = "details/1";

test("a slow read of a final never overwrites a field saved while it ran", async () => {
  const docs = createDocs({
    "live/current": { season: 2026 },
    [KEY]: { boxScore: "live", lead: "old" },
  });
  const { promise: started, resolve: announceRead } = createDeferred();
  const { promise: held, resolve: releaseRead } = createDeferred();
  const job = createGameDetailsJob({
    nameKey: (id) => `details/${id}`,
    detailFields: ["boxScore", "lead"],
    listFinals: async () => [{ id: "1" }],
    readDetails: async (context, game, stored) => {
      announceRead();
      await held;
      return { details: { ...stored, boxScore: "final" }, isWhole: true };
    },
  });

  const running = job.updateStore({
    docs,
    storage: createJobStorage(),
    createLoadSnapshot: () => async () => null,
    env: {},
    fetchImpl: async () => new Response("{}"),
    now: () => NOW,
  });
  await started;
  await docs.update(KEY, (latest) => ({ ...latest, lead: "new" }));
  releaseRead();
  await running;

  assert.deepEqual(docs.stored.get(KEY), { boxScore: "final", lead: "new" });
});

test("a read that lost its box score to a newer write leaves the final unkept and read again", async () => {
  const docs = createDocs({
    "live/current": { season: 2026 },
    [KEY]: { boxScore: "live", lead: "old" },
  });
  const storage = createJobStorage();
  const { promise: started, resolve: announceRead } = createDeferred();
  const { promise: held, resolve: releaseRead } = createDeferred();
  let reads = 0;
  const job = createGameDetailsJob({
    nameKey: (id) => `details/${id}`,
    detailFields: ["boxScore", "lead"],
    listFinals: async () => [{ id: "1", end: new Date(NOW - 3 * 60 * 60 * 1000).toISOString() }],
    readDetails: async (context, game, stored) => {
      reads += 1;
      if (reads === 1) {
        announceRead();
        await held;
      }
      return { details: { ...stored, boxScore: "final" }, isWhole: true };
    },
  });
  const runAt = (now) =>
    job.updateStore({
      docs,
      storage,
      createLoadSnapshot: () => async () => null,
      env: {},
      fetchImpl: async () => new Response("{}"),
      now: () => now,
    });

  const running = runAt(NOW);
  await started;
  await docs.update(KEY, (latest) => ({ ...latest, boxScore: "live 2" }));
  releaseRead();
  await running;
  assert.deepEqual(docs.stored.get(KEY), { boxScore: "live 2", lead: "old" });

  await runAt(NOW + 11 * 60 * 1000);
  assert.equal(reads, 2);
});
