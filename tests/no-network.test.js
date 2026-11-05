import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import { buildNodeTestArgs } from "../worker/node-tests.mjs";

const GUARD = new URL("tests/no-network.js", REPO_ROOT).href;
const FEED = "https://example.com/feed";
const WITHOUT_RUNNER_CONTEXT = { ...process.env, NODE_TEST_CONTEXT: undefined };

/** @param {string} script run as a module with the guard loaded first, as every Node test is */
const runWithGuard = (script) =>
  spawnSync(process.execPath, ["--import", GUARD, "--input-type=module", "--eval", script], {
    encoding: "utf8",
    env: WITHOUT_RUNNER_CONTEXT,
  });

test("a read that reaches the network fails with its address", () => {
  const run = runWithGuard(`await fetch(${JSON.stringify(FEED)});`);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /A Node test tried to read https:\/\/example\.com\/feed/);
});

test("a read that reaches the network fails the run even when the code catches it", () => {
  const run = runWithGuard(`await fetch(${JSON.stringify(FEED)}).catch(() => {});`);
  assert.equal(run.status, 1);
  assert.match(
    run.stderr,
    /may not reach the network, but tried to read:\nhttps:\/\/example\.com\/feed/,
  );
});

/**
 * Runs a test file under the dot reporter with the guard loaded, as CI does, and returns what CI's
 * log shows: the runner's stdout and stderr.
 * @param {string} body the test file's code after its imports
 */
function runUnderDotReporter(body) {
  const folder = mkdtempSync(join(tmpdir(), "no-network-"));
  try {
    const file = join(folder, "example.test.js");
    writeFileSync(file, `import test from "node:test";\n${body}`);
    return spawnSync(process.execPath, buildNodeTestArgs([file]), {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: WITHOUT_RUNNER_CONTEXT,
    });
  } finally {
    rmSync(folder, { recursive: true });
  }
}

const shownBy = (/** @type {import("node:child_process").SpawnSyncReturns<string>} */ run) =>
  run.stdout + run.stderr;

test("under the dot reporter, a caught read fails the run and shows its address", () => {
  const run = runUnderDotReporter(
    'test("catches", async () => { await fetch("https://example.com/feed").catch(() => {}); });',
  );
  assert.notEqual(run.status, 0);
  assert.match(shownBy(run), /tried to read:\s+https:\/\/example\.com\/feed/);
});

test("under the dot reporter, an uncaught read fails the run and shows its address", () => {
  const run = runUnderDotReporter(
    'test("reads", async () => { await fetch("https://example.com/feed"); });',
  );
  assert.notEqual(run.status, 0);
  assert.match(shownBy(run), /A Node test tried to read https:\/\/example\.com\/feed/);
});

test("under the dot reporter, a file that reads only its fakes passes", () => {
  const run = runUnderDotReporter(`test("fakes", () => {});`);
  assert.equal(run.status, 0);
});

test("a run that reads only its fakes passes", () => {
  assert.equal(runWithGuard("").status, 0);
});

test("every Node test run loads the guard first", () => {
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  assert.equal(scripts.test, "node worker/node-tests.mjs");
  assert.deepEqual(buildNodeTestArgs(["tests/example.test.js"]), [
    "--test-reporter=dot",
    "--import",
    "./tests/no-network.js",
    "--test",
    "tests/example.test.js",
  ]);
});
