import test from "node:test";
import assert from "node:assert/strict";
import { catchFailure, noteFailure } from "../shared/worker/job-status.js";

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
