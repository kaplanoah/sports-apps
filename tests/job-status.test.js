import test from "node:test";
import assert from "node:assert/strict";
import { catchFailure, noteFailure, runWithStatus } from "../shared/worker/job-status.js";
import { createDocs, createJobStorage } from "./job-context.js";

/**
 * Runs `work` with console.error held, and answers what it logged.
 * @param {test.TestContext} context
 * @param {() => Promise<unknown> | unknown} work
 */
async function listLogged(context, work) {
  const logged = context.mock.method(console, "error", () => {});
  await work();
  return logged.mock.calls.map((call) => call.arguments.join(" "));
}

test("a failure is logged and kept for the run's status, named for what failed", async (context) => {
  /** @type {string[]} */
  const failures = [];

  const logged = await listLogged(context, () =>
    noteFailure(failures, "Reading 2026's stats", new Error("The league is down")),
  );

  assert.deepEqual(failures, ["Reading 2026's stats failed: The league is down"]);
  assert.deepEqual(logged, failures);
});

test("work that fails has its failure noted rather than thrown, and work that doesn't notes nothing", async (context) => {
  /** @type {string[]} */
  const failures = [];
  const done = [];

  await listLogged(context, async () => {
    await catchFailure(failures, "Keeping 2026's players", async () => {
      throw new Error("The store is full");
    });
    await catchFailure(failures, "Filling a past season's players", async () => {
      done.push("filled");
    });
  });

  assert.deepEqual(failures, ["Keeping 2026's players failed: The store is full"]);
  assert.deepEqual(done, ["filled"]);
});

test("a run saves its status with what the job adds, notes a failure it doesn't catch, and keeps the last failure through a run that has none", async (context) => {
  context.mock.method(console, "error", () => {});
  const docs = createDocs();
  const clock = { now: Date.parse("2026-10-06T12:00:00Z") };
  const jobContext = /** @type {any} */ ({
    docs,
    storage: createJobStorage(),
    env: {},
    fetchImpl: async () => new Response("{}"),
    now: () => clock.now,
  });
  const job = {
    statusKey: "games/status",
    describeRun: async () => ({ saved: 1 }),
  };

  await runWithStatus(jobContext, {
    ...job,
    updateStore: async ({ fetchImpl }) => {
      await fetchImpl("https://league.example/feed");
      throw new Error("The store is full");
    },
  });
  const failed = docs.stored.get("games/status");
  assert.deepEqual(failed, {
    ranAt: "2026-10-06T12:00:00.000Z",
    durationMs: 0,
    requests: 1,
    lastFailure: { at: "2026-10-06T12:00:00.000Z", message: "The run failed: The store is full" },
    saved: 1,
  });

  clock.now += 60_000;
  await runWithStatus(jobContext, { ...job, updateStore: async () => {} });
  const after = docs.stored.get("games/status");
  assert.equal(after.ranAt, "2026-10-06T12:01:00.000Z");
  assert.equal(after.requests, 0);
  assert.deepEqual(after.lastFailure, failed.lastFailure);
});
