import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ESLint } from "eslint";
import { listMutationTests } from "../worker/mutation-tests.mjs";
import { MUTATION_TARGETS, readMutationTarget } from "../worker/mutation-targets.mjs";
import { buildNodeTestArgs, listNodeTests } from "../worker/node-tests.mjs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const RUNNER = fileURLToPath(new URL("worker/mutation-tests.mjs", REPO_ROOT));
const FIXTURE_MODULE = `../${readMutationTarget("search-reading")}`;
const fixtureEnv = { ...process.env };
// A nested test runner needs its own context to actually execute its fixture files.
delete fixtureEnv.NODE_TEST_CONTEXT;

test("mutation testing runs exactly one of three shared page modules with one Stryker lane", () => {
  assert.deepEqual(MUTATION_TARGETS, ["search-reading", "series-text", "season-days"]);
  for (const target of MUTATION_TARGETS) {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import config from "./stryker.config.mjs"; console.log(JSON.stringify(config));',
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, MUTATION_TARGET: target },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.deepEqual(config.mutate, [`shared/page/${target}.js`]);
    assert.equal(config.concurrency, 1);
    assert.equal(config.testRunner, "command");
    assert.equal(config.coverageAnalysis, "off");
    assert.deepEqual(config.ignorePatterns, ["tsconfig.json"]);
    assert.equal(config.commandRunner.command, "node worker/mutation-tests.mjs");
    assert.equal(Object.hasOwn(config, "thresholds"), false);
    assert.ok(config.reporters.includes("event-recorder"));
    assert.equal(config.eventReporter.baseDir, `reports/mutation/${target}/events`);
    assert.equal(config.jsonReporter.fileName, `reports/mutation/${target}/mutation.json`);
    assert.equal(config.htmlReporter.fileName, `reports/mutation/${target}/mutation.html`);
    assert.equal(config.tempDirName, `.stryker-tmp/${target}`);
  }
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  assert.equal(scripts["test:mutation"], "stryker run");
  for (const target of ["", "all"]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", 'await import("./stryker.config.mjs");'],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, MUTATION_TARGET: target },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Choose MUTATION_TARGET/);
  }
});

test("mutation targets reject missing, pooled, unknown, and traversal selectors", () => {
  for (const target of [
    undefined,
    "",
    "all",
    "search-reading,series-text",
    "../search-reading",
    "shared/page/season-days.js",
  ])
    assert.throws(() => readMutationTarget(target), /Choose MUTATION_TARGET/);
  for (const target of MUTATION_TARGETS)
    assert.equal(readMutationTarget(target), `shared/page/${target}.js`);
});

test("mutation discovery follows shared, transitive, cyclic, and dynamic imports for future tests", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "mutation-tests-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const files = {
    "shared/page/target.js": "export const value = 1;",
    "tests/direct.test.js": 'import "../shared/page/target.js";',
    "tests/helper.js": 'export { value } from "#shared/target.js"; import "./cycle.js";',
    "tests/cycle.js": 'import "./helper.js";',
    "apps/future/tests/new.test.js": 'import "../../../tests/helper.js";',
    "services/future/tests/new.test.js": 'await import("../../../tests/cycle.js");',
    "tests/unrelated.test.js": 'import "node:assert"; import "./missing.js";',
    "apps/future/tests/browser/not-node.test.js": 'import "../../../../tests/helper.js";',
  };
  for (const [path, source] of Object.entries(files)) {
    const file = join(folder, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const root = pathToFileURL(`${folder}/`);
  assert.deepEqual(listNodeTests(root), [
    "apps/future/tests/new.test.js",
    "services/future/tests/new.test.js",
    "tests/direct.test.js",
    "tests/unrelated.test.js",
  ]);
  const modules = ["shared/page/target.js"];
  assert.deepEqual(listMutationTests(modules, root), [
    "apps/future/tests/new.test.js",
    "services/future/tests/new.test.js",
    "tests/direct.test.js",
  ]);
  writeFileSync(join(folder, "tests/later.test.js"), 'import "./helper.js";');
  assert.ok(listMutationTests(modules, root).includes("tests/later.test.js"));
  assert.deepEqual(listMutationTests(["shared/page/unreached.js"], root), []);
});

test("mutation discovery includes both typing sweeps and the focused module tests", () => {
  const tests = listMutationTests(MUTATION_TARGETS.map(readMutationTarget));
  for (const file of [
    "apps/mlb/tests/search-typing.test.js",
    "apps/wnba/tests/search-typing.test.js",
    "apps/mlb/tests/page.test.js",
    "apps/wnba/tests/page.test.js",
    "apps/wnba/tests/game-sheet.test.js",
    "tests/game-search.test.js",
    "tests/series-text.test.js",
    "tests/season-days.test.js",
  ]) {
    assert.ok(tests.includes(file), file);
  }
  assert.ok(!tests.includes("tests/mutation-testing.test.js"));
  assert.deepEqual(listMutationTests([readMutationTarget("search-reading")]), [
    "apps/mlb/tests/search-typing.test.js",
    "apps/wnba/tests/search-typing.test.js",
    "tests/game-search.test.js",
  ]);
  assert.ok(
    !listMutationTests([readMutationTarget("season-days")]).includes("tests/series-text.test.js"),
  );
});

test("Node runner arguments preserve paths and refuse an empty full-suite fallback", () => {
  const tests = ["tests/one.test.js", "apps/future/tests/two words.test.js"];
  assert.deepEqual(buildNodeTestArgs(tests), [
    "--import",
    "./tests/no-network.js",
    "--test",
    ...tests,
  ]);
  assert.throws(() => buildNodeTestArgs([]), /No Node tests were found/);
});

/** @param {import("node:test").TestContext} t */
function makeRunnerFixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "mutation-runner-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const [path, source] of Object.entries({
    "package.json": '{"type":"module"}',
    "shared/page/search-reading.js": "export const value = 1;",
    "tests/no-network.js": readRepoFile("tests/no-network.js"),
    "tests/selected.test.js": `import test from "node:test"; import { value } from ${JSON.stringify(FIXTURE_MODULE)}; import assert from "node:assert/strict"; test("selected fixture", () => assert.equal(value, 1));`,
    "tests/unrelated.test.js":
      'import test from "node:test"; test("unrelated fixture", () => { throw new Error("UNRELATED_TEST_RAN"); });',
  })) {
    const file = join(folder, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return folder;
}

/** @param {string} folder @param {string[]} [args] */
const invokeRunner = (folder, args = ["--target", "search-reading"]) =>
  spawnSync(process.execPath, [RUNNER, "--root", folder, ...args], {
    encoding: "utf8",
    env: fixtureEnv,
  });

/** @param {string} folder */
function copyOrdinaryRunner(folder) {
  mkdirSync(join(folder, "worker"), { recursive: true });
  const runner = join(folder, "worker/node-tests.mjs");
  writeFileSync(runner, readRepoFile("worker/node-tests.mjs"));
  return runner;
}

/** @param {string} folder */
const listCliFixtures = (folder) => [
  { runner: RUNNER, args: ["--target", "search-reading", "--root", folder] },
  { runner: copyOrdinaryRunner(folder), args: [] },
];

/**
 * @param {string} folder
 * @param {string} runner
 * @param {string} executable
 * @param {string[]} [args]
 */
function invokeLauncher(folder, runner, executable, args = []) {
  const script = `process.execPath = ${JSON.stringify(executable)};
    process.argv = ${JSON.stringify(["node", runner, ...args])};
    await import(${JSON.stringify(pathToFileURL(runner).href)});`;
  const launcher = join(folder, "launcher.mjs");
  writeFileSync(launcher, script);
  return spawnSync(process.execPath, [launcher], { encoding: "utf8", env: fixtureEnv });
}

test("the mutation CLI propagates a selected test's failure and excludes unrelated tests", (t) => {
  const folder = makeRunnerFixture(t);
  const passing = invokeRunner(folder);
  assert.equal(passing.status, 0, passing.stderr + passing.stdout);
  assert.doesNotMatch(passing.stderr + passing.stdout, /UNRELATED_TEST_RAN/);
  writeFileSync(join(folder, "shared/page/search-reading.js"), "export const value = 2;");
  const failing = invokeRunner(folder);
  assert.equal(failing.status, 1, failing.stderr + failing.stdout);
  assert.match(failing.stderr + failing.stdout, /ERR_ASSERTION/);
});

test("the mutation CLI keeps the network guard and refuses invalid or empty selections", (t) => {
  const folder = makeRunnerFixture(t);
  writeFileSync(
    join(folder, "tests/selected.test.js"),
    `import test from "node:test"; import ${JSON.stringify(FIXTURE_MODULE)}; test("blocked network fixture", async () => { await fetch("https://example.com/feed"); });`,
  );
  const network = invokeRunner(folder);
  assert.equal(network.status, 1);
  assert.match(
    network.stderr + network.stdout,
    /A Node test tried to read https:\/\/example\.com\/feed/,
  );
  const empty = invokeRunner(folder, ["--target", "series-text"]);
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /No Node tests were found/);
  const invalid = invokeRunner(folder, ["--target", "../search-reading"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Choose MUTATION_TARGET/);
});

test("both Node CLIs expose a child process startup failure", (t) => {
  const folder = makeRunnerFixture(t);
  for (const { runner, args } of listCliFixtures(folder)) {
    const result = invokeLauncher(folder, runner, join(folder, "missing-node"), args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOENT/);
  }
});

test("both Node CLIs fail when their child is terminated by a signal", (t) => {
  const folder = makeRunnerFixture(t);
  const executable = join(folder, "signaled-node");
  writeFileSync(executable, "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 });
  for (const { runner, args } of listCliFixtures(folder)) {
    const result = invokeLauncher(folder, runner, executable, args);
    assert.equal(result.status, 1, result.stderr + result.stdout);
  }
});

test("both Node CLIs pass the exact selected arguments and working directory to their child", (t) => {
  const folder = makeRunnerFixture(t);
  const executable = join(folder, "record-node.mjs");
  const record = join(folder, "command.json");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
  `,
    { mode: 0o755 },
  );
  for (const { runner, args } of listCliFixtures(folder)) {
    const result = invokeLauncher(folder, runner, executable, args);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const tests =
      runner === RUNNER
        ? ["tests/selected.test.js"]
        : ["tests/selected.test.js", "tests/unrelated.test.js"];
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), {
      args: buildNodeTestArgs(tests),
      cwd: folder,
    });
  }
});

test("the ordinary Node runner hands its arguments to Node ahead of the tests", (t) => {
  const folder = makeRunnerFixture(t);
  const executable = join(folder, "record-node.mjs");
  const record = join(folder, "command.json");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
    import { writeFileSync } from "node:fs";
    writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)));
  `,
    { mode: 0o755 },
  );
  const result = invokeLauncher(folder, copyOrdinaryRunner(folder), executable, [
    "--test-reporter=dot",
  ]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), [
    "--test-reporter=dot",
    ...buildNodeTestArgs(["tests/selected.test.js", "tests/unrelated.test.js"]),
  ]);
});

test("the ordinary Node runner uses the same discovery and propagates fixture failures", (t) => {
  const folder = makeRunnerFixture(t);
  const runner = copyOrdinaryRunner(folder);
  const failed = spawnSync(process.execPath, [runner], { encoding: "utf8", env: fixtureEnv });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout + failed.stderr, /UNRELATED_TEST_RAN/);
  rmSync(join(folder, "tests/unrelated.test.js"));
  const passed = spawnSync(process.execPath, [runner], { encoding: "utf8", env: fixtureEnv });
  assert.equal(passed.status, 0, passed.stderr + passed.stdout);
});

test("ESLint ignores abandoned mutation sandboxes while still linting normal source", async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(REPO_ROOT) });
  assert.equal(await eslint.isPathIgnored(".stryker-tmp/sandbox123/shared/page/example.js"), true);
  assert.equal(await eslint.isPathIgnored("shared/page/search-reading.js"), false);
  const [result] = await eslint.lintText("notDefined();", {
    filePath: "shared/page/search-reading.js",
  });
  assert.ok(result.messages.some(({ ruleId }) => ruleId === "no-undef"));
});
