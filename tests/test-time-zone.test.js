import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  SENSITIVE_TESTS,
  parseTimeZoneChanges,
  selectTimeZoneTests,
  testInTimeZone,
} from "../worker/test-time-zone.mjs";
import { listReachedFiles } from "../worker/browser-scope.mjs";
import { REPO_ROOT, listTrackedFiles, readRepoFile } from "./repo-files.js";

const AVAILABLE = ["tests/days.test.js", "tests/seasons.test.js", "tests/build.test.js"];
const change = (path, status = "M") => ({ path, status });

test("the manifest covers every Node test reaching shared days and the independent time tests", () => {
  const tests = listTrackedFiles().filter((path) =>
    /^(?:tests|(?:apps|services)\/[^/]+\/tests)\/[^/]+\.test\.js$/.test(path),
  );
  const read = (path) => (existsSync(new URL(path, REPO_ROOT)) ? readRepoFile(path) : null);
  const reached = tests.filter((path) => listReachedFiles([path], read).has("shared/page/days.js"));
  assert.ok(reached.length > 0, "the import walk must find real sensitive tests");
  const required = [
    ...reached,
    "tests/seasons.test.js",
    "tests/season-store.test.js",
    "tests/poll-schedule.test.js",
    "tests/long-away.test.js",
    "apps/mlb/tests/next-game.test.js",
  ];
  assert.deepEqual(
    required.filter((path) => !SENSITIVE_TESTS.includes(path)),
    [],
  );
  assert.deepEqual(SENSITIVE_TESTS, [...new Set(SENSITIVE_TESTS)].sort());
  assert.deepEqual(
    SENSITIVE_TESTS.filter((path) => !tests.includes(path)),
    [],
  );
});

test("ordinary changes and an empty diff keep the full sensitive list, including unchanged tests", () => {
  for (const changes of [
    [],
    [change("apps/mlb/page/js/games-view.js")],
    [change("tests/build.test.js")],
  ]) {
    const selected = selectTimeZoneTests(changes, AVAILABLE);
    assert.deepEqual(selected.files, ["tests/days.test.js", "tests/seasons.test.js"]);
    assert.match(selected.reason, /explicit date\/time-sensitive/);
  }
});

test("workflow, Node, dependency, runner, selector and shared harness changes repeat everything", () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/flaky.yml",
    ".github/actions/setup/action.yml",
    ".nvmrc",
    ".node-version",
    ".npmrc",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "worker/test-time-zone.mjs",
    "worker/browser-scope.mjs",
    "worker/package-imports.mjs",
    "tests/time-zone-sensitive.json",
    "tests/time-zone.js",
    "tests/no-network.js",
    "tests/repo-files.js",
    "tests/browser/harness.mjs",
    "apps/mlb/tests/read-season.js",
    "services/accounts/tests/helpers/setup.js",
  ]) {
    const selected = selectTimeZoneTests([change(path)], AVAILABLE);
    assert.equal(selected.files, null, path);
    assert.match(selected.reason, /infrastructure changed/, path);
  }
});

test("new unclassified tests and no-renames moves repeat everything in every test root", () => {
  for (const path of [
    "tests/a-new-case.test.js",
    "apps/mlb/tests/a-new-case.test.js",
    "services/accounts/tests/a-new-case.test.js",
  ]) {
    const changes = parseTimeZoneChanges(`D\0tests/build.test.js\0A\0${path}\0`);
    const selected = selectTimeZoneTests(changes, [...AVAILABLE, path]);
    assert.equal(selected.files, null, path);
    assert.match(selected.reason, /added or renamed Node test is unclassified/, path);
  }
});

test("classified additions stay selected and deleted tests are never passed to Node", () => {
  assert.deepEqual(selectTimeZoneTests([change("tests/days.test.js", "A")], AVAILABLE).files, [
    "tests/days.test.js",
    "tests/seasons.test.js",
  ]);
  for (const deleted of ["tests/build.test.js", "tests/days.test.js"]) {
    const available = AVAILABLE.filter((path) => path !== deleted);
    assert.deepEqual(
      selectTimeZoneTests([change(deleted, "D")], available).files,
      ["tests/days.test.js", "tests/seasons.test.js"].filter((path) => path !== deleted),
    );
  }
});

test("NUL-delimited changes preserve whitespace, and malformed or unknown changes cannot narrow coverage", () => {
  assert.deepEqual(parseTimeZoneChanges("M\0apps/mlb/page/a b\nc.js\0"), [
    change("apps/mlb/page/a b\nc.js"),
  ]);
  for (const text of ["M\0missing-terminator", "A\0", "M\0\0", "R100\0old\0new\0", "T\0test.js\0"])
    assert.throws(() => parseTimeZoneChanges(text));
  assert.equal(selectTimeZoneTests(null, AVAILABLE).files, null);
  assert.equal(selectTimeZoneTests([], []).files, null);
});

/** @param {{ full?: boolean, diff?: string, failingCommand?: string, status?: number, error?: Error }} [options] */
function captureTestInvocation({
  full = false,
  diff = "",
  failingCommand,
  status = 0,
  error,
} = {}) {
  const calls = [];
  const gitCalls = [];
  const messages = [];
  const git = (arguments_) => {
    gitCalls.push(arguments_);
    if (arguments_[0] === failingCommand) throw new Error("git failed");
    return arguments_[0] === "diff" ? diff : `${AVAILABLE.join("\0")}\0`;
  };
  /** @type {import("../worker/test-time-zone.mjs").TimeZoneSpawn} */
  const spawnImpl = (command, arguments_, options) => {
    calls.push({ command, arguments_, options });
    return { pid: 0, output: [], stdout: "", stderr: "", signal: null, status, error };
  };
  const result = testInTimeZone({ full, git, spawnImpl, log: (message) => messages.push(message) });
  assert.equal(calls.length, 1);
  return { result, invocation: calls[0], gitCalls, messages };
}

test("the scoped runner keeps no-network protection, Honolulu, the failure-at-end reporter and exit status", () => {
  const { result, invocation, gitCalls, messages } = captureTestInvocation({ status: 7 });
  assert.equal(result, 7);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.arguments_, [
    "--import",
    "./tests/no-network.js",
    "--test",
    "tests/days.test.js",
    "tests/seasons.test.js",
  ]);
  assert.equal(invocation.options.env.TZ, "Pacific/Honolulu");
  assert.equal(invocation.options.env.NODE_OPTIONS, "--test-reporter=dot");
  assert.equal(invocation.options.stdio, "inherit");
  assert.deepEqual(invocation.options.cwd, REPO_ROOT);
  assert.deepEqual(gitCalls, [
    ["ls-files", "-z"],
    ["diff", "--name-status", "--no-renames", "-z", "HEAD^1", "HEAD"],
  ]);
  assert.match(messages.join("\n"), /2 sensitive test files/);
});

test("full requests and conservative fallbacks invoke the complete protected npm script", () => {
  for (const options of [
    { full: true },
    { diff: "M\0package-lock.json\0" },
    { diff: "A\0tests/unknown.test.js\0" },
    { diff: "bad diff" },
    { failingCommand: "diff" },
    { failingCommand: "ls-files" },
  ]) {
    const { invocation, gitCalls, messages } = captureTestInvocation(options);
    assert.equal(invocation.command, "npm");
    assert.deepEqual(invocation.arguments_, ["test"]);
    assert.equal(invocation.options.env.TZ, "Pacific/Honolulu");
    assert.equal(invocation.options.env.NODE_OPTIONS, "--test-reporter=dot");
    assert.match(messages.join("\n"), /every Node test/);
    if (options.full) assert.deepEqual(gitCalls, []);
  }
  assert.match(
    readRepoFile("package.json"),
    /"test": "node --import \.\/tests\/no-network\.js --test /,
  );
});

test("an unstarted or interrupted test process cannot pass", () => {
  const failed = captureTestInvocation({ status: null, error: new Error("spawn failed") });
  assert.equal(failed.result, 1);
  assert.match(failed.messages.join("\n"), /Could not start.*spawn failed/);
});

test("the CLI honors full mode and propagates the test command's failure", () => {
  const script = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { fileURLToPath } from 'node:url';
    childProcess.execFileSync = () => { throw new Error('Full mode must not read git'); };
    childProcess.spawnSync = (command, arguments_, options) => {
      console.log(JSON.stringify({command, arguments_, zone: options.env.TZ}));
      return { status: 7 };
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, fileURLToPath(new URL('./worker/test-time-zone.mjs', ${JSON.stringify(REPO_ROOT.href)})), '--full'];
    await import('./worker/test-time-zone.mjs');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stdout, /A full alternate-zone run was requested/);
  const invocation = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(invocation, { command: "npm", arguments_: ["test"], zone: "Pacific/Honolulu" });
});
