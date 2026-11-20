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
