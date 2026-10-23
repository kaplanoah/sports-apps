import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import { buildNodeTestArgs } from "../worker/node-tests.mjs";

const GUARD = new URL("tests/no-network.js", REPO_ROOT).href;
const FEED = "https://example.com/feed";

/** @param {string} script run as a module with the guard loaded first, as every Node test is */
const runWithGuard = (script) =>
  spawnSync(process.execPath, ["--import", GUARD, "--input-type=module", "--eval", script], {
    encoding: "utf8",
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

test("a run that reads only its fakes passes", () => {
  assert.equal(runWithGuard("").status, 0);
});

test("every Node test run loads the guard first", () => {
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  assert.equal(scripts.test, "node worker/node-tests.mjs");
  assert.deepEqual(buildNodeTestArgs(["tests/example.test.js"]), [
    "--import",
    "./tests/no-network.js",
    "--test",
    "tests/example.test.js",
  ]);
});
