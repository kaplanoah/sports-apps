import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  TIME_ZONE_MANIFEST,
  parseTimeZoneChanges,
  selectTimeZoneTests,
  testInTimeZone,
} from "../worker/test-time-zone.mjs";
import {
  NODE_TEST,
  TIME_ZONE_SOURCE,
  inspectTimeZoneCode,
  verifyTimeZoneCoverage,
} from "../worker/time-zone-scope.mjs";
import { REPO_ROOT, listTrackedFiles, readRepoFile } from "./repo-files.js";

const SCRIPT = JSON.parse(readRepoFile("package.json")).scripts.test;
const TESTS = [
  "tests/days.test.js",
  "tests/build.test.js",
  "services/accounts/tests/accounts.test.js",
];
const MANIFEST = { sensitive: [TESTS[0]], fixed: [] };
const change = (path, status = "M") => ({ path, status });

const readFixture = (path) =>
  path === "package.json"
    ? JSON.stringify({ scripts: { test: SCRIPT } })
    : TESTS.includes(path)
      ? path === TESTS[0]
        ? "new Date(0).toISOString();"
        : "export const number = 1;"
      : null;

test("the explicit manifest covers native time APIs in every current Node test and its imports", () => {
  const tracked = listTrackedFiles();
  const tests = tracked.filter((path) => NODE_TEST.test(path));
  const read = (path) => (existsSync(new URL(path, REPO_ROOT)) ? readRepoFile(path) : null);
  const sources = tracked.filter(
    (path) => TIME_ZONE_SOURCE.test(path) && !path.endsWith(".min.js"),
  );
  verifyTimeZoneCoverage(tests, TIME_ZONE_MANIFEST, read, sources);
  assert.deepEqual(TIME_ZONE_MANIFEST.sensitive, [...TIME_ZONE_MANIFEST.sensitive].sort());
  assert.equal(TIME_ZONE_MANIFEST.fixed.length, 2);
  assert.ok(TIME_ZONE_MANIFEST.fixed.every((path) => path.endsWith("/search-typing.test.js")));
});

test("Date constructors, aliases, parsing, formatters and opaque execution are conservatively recognized", () => {
  for (const text of [
    "new Date(2026, 9, 10);",
    "new Date('2026-10-10T00:00:00Z').toString();",
    "Date.parse('2026-10-10T12:00:00');",
    "Date.parse(input);",
    "const Clock = Date; new Clock();",
    "const { parse } = Date;",
    "globalThis['Date'];",
    "globalThis[constructorName];",
    "Date[method](input);",
    "Intl.DateTimeFormat().format(instant);",
    "new Intl.DateTimeFormat('en', {timeZone:'UTC'});",
    "const Format = Intl.DateTimeFormat;",
    "moment.toLocaleString();",
    "moment.getHours();",
    "import(moduleName);",
    "eval(source);",
    "new Function(source);",
    "vm.runInNewContext(source);",
    "spawnSync('node', ['--eval', source]);",
  ])
    assert.equal(inspectTimeZoneCode(text).hasTimeApi, true, text);
  for (const text of [
    "Date.now();",
    "Date.UTC(2026, 0, 1);",
    "const clock = Date.now;",
    "Intl.NumberFormat();",
    "Intl.RelativeTimeFormat();",
  ])
    assert.equal(inspectTimeZoneCode(text).hasTimeApi, false, text);
  assert.throws(() => inspectTimeZoneCode("const broken = ;"), /Could not classify/);
});

test("a new time API in an existing omitted test or imported source cannot escape the coverage guard", () => {
  const documents = new Map([
    [TESTS[0], "new Date(0);"],
    [TESTS[1], "import './helper.js';"],
    ["tests/helper.js", "export const value = 1;"],
  ]);
  const read = (path) => documents.get(path) ?? null;
  verifyTimeZoneCoverage(TESTS.slice(0, 2), MANIFEST, read);
  for (const path of [TESTS[1], "tests/helper.js"]) {
    const previous = documents.get(path);
    documents.set(path, "Date.parse(input);");
    assert.throws(
      () => verifyTimeZoneCoverage(TESTS.slice(0, 2), MANIFEST, read),
      /tests\/build.test.js/,
    );
    documents.set(path, previous);
  }
});

test("fixed-zone omissions require setup before imports, and malformed manifests fail", () => {
  const fixed = "apps/example/tests/search-typing.test.js";
  const documents = new Map([
    [TESTS[0], "new Date(0);"],
    [fixed, "import '../../../tests/eastern-time-zone.js'; import './source.js';"],
    ["apps/example/tests/source.js", "new Date();"],
  ]);
  const manifest = { sensitive: [TESTS[0]], fixed: [fixed] };
  const read = (path) => documents.get(path) ?? null;
  verifyTimeZoneCoverage([TESTS[0], fixed], manifest, read);
  documents.set(fixed, "import './source.js'; import '../../../tests/eastern-time-zone.js';");
  assert.throws(
    () => verifyTimeZoneCoverage([TESTS[0], fixed], manifest, read),
    /must import.*first/,
  );
  for (const bad of [
    { sensitive: [], fixed: [] },
    { sensitive: [TESTS[0], TESTS[0]], fixed: [] },
    { sensitive: [TESTS[0], "tests/missing.test.js"], fixed: [] },
  ])
    assert.throws(() => verifyTimeZoneCoverage([TESTS[0]], bad, read));
});

test("a native time API in a new production file needs a reachable Node test", () => {
  const documents = new Map([
    [TESTS[0], "new Date(0);"],
    ["shared/page/new-date.js", "Date.parse(input);"],
  ]);
  const read = (path) => documents.get(path) ?? null;
  assert.throws(
    () => verifyTimeZoneCoverage([TESTS[0]], MANIFEST, read, ["shared/page/new-date.js"]),
    /test importing.*new-date/,
  );
  documents.set(TESTS[0], "import '../shared/page/new-date.js';");
  verifyTimeZoneCoverage([TESTS[0]], MANIFEST, read, ["shared/page/new-date.js"]);
});

test("Eastern setup controls a tested module's initialization under both inherited zones", () => {
  const folder = mkdtempSync(join(tmpdir(), "calendar-import-"));
  try {
    const fixture = join(folder, "calendar.mjs");
    writeFileSync(
      fixture,
      "export const atLoad = { zone:process.env.TZ, hour:new Date('2026-10-10T00:00:00Z').getHours() };",
    );
    const setup = new URL("./eastern-time-zone.js", import.meta.url).href;
    const script = `import ${JSON.stringify(setup)}; import {atLoad} from ${JSON.stringify(pathToFileURL(fixture).href)}; console.log(JSON.stringify(atLoad));`;
    for (const zone of ["UTC", "Pacific/Honolulu"]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
        encoding: "utf8",
        env: { ...process.env, TZ: zone },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { zone: "America/New_York", hour: 20 });
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("ordinary and empty diffs keep the sensitive list, while every changed Node test is included", () => {
  for (const changes of [[], [change("apps/mlb/page/js/app.js")], [change("package-lock.json")]])
    assert.deepEqual(selectTimeZoneTests(changes, TESTS, MANIFEST), [TESTS[0]]);
  for (const path of [TESTS[1], TESTS[2]])
    for (const status of ["A", "M"])
      assert.deepEqual(
        selectTimeZoneTests([change(path, status)], TESTS, MANIFEST),
        [TESTS[0], path].sort(),
      );
  assert.deepEqual(selectTimeZoneTests([change(TESTS[1], "D")], TESTS.slice(0, 1), MANIFEST), [
    TESTS[0],
  ]);
  const fixed = { sensitive: [TESTS[0]], fixed: [TESTS[1]] };
  assert.deepEqual(selectTimeZoneTests([change(TESTS[1])], TESTS, fixed), [TESTS[0]]);
});

test("NUL diffs preserve names and classify renamed tests as deletion plus addition", () => {
  const changes = parseTimeZoneChanges(`D\0tests/old.test.js\0A\0${TESTS[1]}\0`);
  assert.deepEqual(selectTimeZoneTests(changes, TESTS, MANIFEST), [TESTS[0], TESTS[1]].sort());
  assert.deepEqual(parseTimeZoneChanges("M\0a b\nc.js\0"), [change("a b\nc.js")]);
  for (const text of ["M\0missing-terminator", "A\0", "M\0\0", "R100\0old\0new\0", "T\0file\0"])
    assert.throws(() => parseTimeZoneChanges(text));
});

/** @param {{changed?: boolean, diff?: string, failingCommand?: string, status?: number, error?: Error, readText?: typeof readFixture}} [options] */
function captureInvocation({
  changed = false,
  diff = "",
  failingCommand,
  status = 0,
  error,
  readText = readFixture,
} = {}) {
  const calls = [];
  const gitCalls = [];
  const messages = [];
  const git = (arguments_) => {
    gitCalls.push(arguments_);
    if (arguments_[0] === failingCommand) throw new Error("git failed");
    return arguments_[0] === "diff" ? diff : TESTS.join("\0") + "\0";
  };
  /** @type {import("../worker/test-time-zone.mjs").TimeZoneSpawn} */
  const spawnImpl = (command, arguments_, options) => {
    calls.push({ command, arguments_, options });
    return { pid: 0, output: [], stdout: "", stderr: "", signal: null, status, error };
  };
  const result = testInTimeZone({
    changed,
    git,
    spawnImpl,
    log: (message) => messages.push(message),
    manifest: MANIFEST,
    readText,
  });
  return { result, calls, gitCalls, messages };
}

test("the protected focused command keeps inherited Node options and reports failures at the end", (context) => {
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--max-old-space-size=2048";
  context.after(() => {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  });
  const { result, calls, gitCalls } = captureInvocation({ status: 7 });
  assert.equal(result, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].arguments_, [
    "--import",
    "./tests/no-network.js",
    "--test-reporter=dot",
    "--test",
    TESTS[0],
  ]);
  assert.equal(calls[0].options.env.TZ, "Pacific/Honolulu");
  assert.equal(calls[0].options.env.NODE_OPTIONS, "--max-old-space-size=2048");
  assert.equal(calls[0].options.stdio, "inherit");
  assert.deepEqual(gitCalls, [["ls-files", "-z"]]);
});

test("PR mode includes modified tests without requesting a full second suite", () => {
  const result = captureInvocation({ changed: true, diff: `M\0${TESTS[1]}\0` });
  assert.deepEqual(result.calls[0].arguments_.slice(4), [TESTS[0], TESTS[1]].sort());
  assert.deepEqual(result.gitCalls[1], [
    "diff",
    "--name-status",
    "--no-renames",
    "-z",
    "HEAD^1",
    "HEAD",
  ]);
});

test("unreadable changes, unclassified time APIs and test-command drift fail closed", () => {
  for (const options of [
    { changed: true, diff: "bad diff" },
    { changed: true, failingCommand: "diff" },
    { failingCommand: "ls-files" },
  ])
    assert.throws(() => captureInvocation(options));
  assert.throws(
    () =>
      captureInvocation({
        readText: (path) => (path === TESTS[1] ? "new Date(2026,1,1);" : readFixture(path)),
      }),
    /coverage/,
  );
  assert.throws(
    () =>
      captureInvocation({
        readText: (path) =>
          path === "package.json"
            ? JSON.stringify({ scripts: { test: SCRIPT + " extra" } })
            : readFixture(path),
      }),
    /Update the protected/,
  );
  const failed = captureInvocation({ status: null, error: new Error("spawn failed") });
  assert.equal(failed.result, 1);
  assert.match(failed.messages.join("\n"), /spawn failed/);
});

test("the CLI includes changed tests and propagates the child test failure", () => {
  const script = `
    import childProcess from 'node:child_process';
    import fileSystem from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {fileURLToPath} from 'node:url';
    const read = fileSystem.readFileSync;
    fileSystem.readFileSync = (path, ...options) => {
      if (String(path).endsWith('/tests/time-zone-sensitive.json')) return JSON.stringify({sensitive:['tests/days.test.js'],fixed:[]});
      if (String(path).endsWith('/tests/days.test.js')) return 'new Date(0);';
      if (String(path).endsWith('/tests/html.test.js')) return 'export const value = 1;';
      return read(path, ...options);
    };
    childProcess.execFileSync = (_, args) => args[0] === 'diff'
      ? 'M\\0tests/html.test.js\\0' : 'tests/days.test.js\\0tests/html.test.js\\0';
    childProcess.spawnSync = (command, arguments_, options) => {
      console.log(JSON.stringify({command, arguments_, zone:options.env.TZ}));
      return {status:7};
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, fileURLToPath(new URL('./worker/test-time-zone.mjs', ${JSON.stringify(REPO_ROOT.href)})), '--changed'];
    await import('./worker/test-time-zone.mjs');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 7, result.stderr);
  const invocation = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(invocation.arguments_.slice(4), ["tests/days.test.js", "tests/html.test.js"]);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.zone, "Pacific/Honolulu");
});
