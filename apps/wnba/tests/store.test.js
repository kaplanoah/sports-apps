import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_JOBS } from "../page/js/background-jobs.js";
import { SeasonStore } from "../worker/src/store.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";

test("every background job saves how its run went where the Diagnostics report reads it", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const now = Date.parse("2026-09-30T20:00:00Z");
  const store = new SeasonStore(
    ctx,
    {},
    {
      fetchImpl: async () => new Response("", { status: 503 }),
      loadSnapshot: async () => {
        throw new Error("The WNBA didn't answer");
      },
      now: () => now,
    },
  );

  await store.startDueJobs(now);
  await Promise.all(store.jobRuns.values());

  const saved = [...stored.keys()].filter((key) => key.endsWith("/status"));
  assert.deepEqual(saved.sort(), BACKGROUND_JOBS.map((name) => `${name}/status`).sort());
});
