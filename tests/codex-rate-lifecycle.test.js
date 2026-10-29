import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  readProcessLifetime,
  inspectProcessLifetime,
  monitorNativeLifetime,
} from "../worker/codex-rate-lifecycle.mjs";

function createStat(pid, start, state = "S", name = "native (parent)") {
  return `${pid} (${name}) ${[state, ...Array(18).fill("0"), start, "0"].join(" ")}`;
}

test("parent identity includes kernel start time and handles parentheses in the process name", () => {
  assert.deepEqual(readProcessLifetime(createStat(45, "123456")), {
    pid: 45,
    start: "123456",
    state: "S",
  });
  for (const value of ["", "invalid", createStat(1, "123"), createStat(45, "bad")])
    assert.throws(() => readProcessLifetime(value));
  assert.equal(
    inspectProcessLifetime(45, () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
    null,
  );
  assert.throws(() =>
    inspectProcessLifetime(45, () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    }),
  );
});

async function observeLifetime(inspections, deadline = 1000) {
  let time = 0;
  const calls = [];
  const outcome = await monitorNativeLifetime({
    parent: { pid: 45, start: "123456" },
    deadline,
    inspect: () => inspections.shift() ?? null,
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
    stop: async () => calls.push("stop"),
    finalize: async (result) => calls.push(result),
  });
  return { outcome, calls };
}

test("parent exit, zombie and PID reuse close the limiter before finalizing once", async () => {
  const live = { pid: 45, start: "123456", state: "S" };
  for (const end of [null, { ...live, start: "654321" }, { ...live, state: "Z" }]) {
    const { outcome, calls } = await observeLifetime([live, end]);
    assert.equal(outcome, "parent-exited");
    assert.equal(calls[0], "stop");
    assert.deepEqual(calls[1], { termination: "parent-exited", completedAt: 100 });
    assert.equal(calls.length, 2);
  }
});

test("the bounded lifetime closes an invocation that never exits", async () => {
  const live = { pid: 45, start: "123456", state: "S" };
  const { outcome, calls } = await observeLifetime(Array(10).fill(live), 250);
  assert.equal(outcome, "deadline");
  assert.deepEqual(calls, ["stop", { termination: "deadline", completedAt: 250 }]);
});

test("unreadable process state still stops and cannot publish a finalized handoff", async () => {
  let stopped = false;
  let finalized = false;
  await assert.rejects(
    monitorNativeLifetime({
      parent: { pid: 45, start: "123456" },
      deadline: 10,
      now: () => 0,
      inspect: () => {
        throw new Error("unreadable");
      },
      stop: async () => {
        stopped = true;
      },
      finalize: async () => {
        finalized = true;
      },
    }),
    /unreadable/,
  );
  assert.equal(stopped, true);
  assert.equal(finalized, false);
});

test(
  "the actual Linux parent lifetime stops before final quota publication",
  { skip: process.platform !== "linux" },
  async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      await once(child, "spawn");
      const parent = inspectProcessLifetime(child.pid);
      assert.ok(parent);
      const calls = [];
      const finished = monitorNativeLifetime({
        parent,
        deadline: Date.now() + 5000,
        stop: async () => {
          calls.push("stopped");
        },
        finalize: async (state) => {
          calls.push(state.termination);
        },
      });
      child.kill("SIGTERM");
      await finished;
      assert.deepEqual(calls, ["stopped", "parent-exited"]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  },
);
