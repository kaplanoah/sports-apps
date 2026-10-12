// Sorts burn-in's failures into the pull request's and everyone else's. A test the pull request
// wrote or edited that failed in any of its runs fails the pull request, since a test that passes
// only some of the time should never merge. Any other test that failed in a spec it changed goes
// to the issue Flaky browser tests (worker/report-flaky-tests.mjs) instead, as a test that passed
// on its retry does, and the pull request goes on. A change in a spec outside every test, like an
// import, a helper, or a test.use, can change how any of its tests runs, so it counts as editing
// them all. A run that broke before its tests could, like on a config error, fails too.
// Usage: git diff -U0 --no-renames <base> <head> -- <specs> | node worker/judge-burn-in.mjs <report>
// It writes the flaky tests beside the report, in burn-in-flaky.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { listFailedTests, readFirstLine } from "./report-flaky-tests.mjs";

/**
 * The lines a diff with no context changes in each file, numbered as the new file has them. A
 * removal names the lines on either side of where it was.
 * @param {string} diff
 * @returns {Map<string, number[]>}
 */
export function readChangedLines(diff) {
  /** @type {Map<string, number[]>} */
  const byPath = new Map();
  /** @type {number[] | null} */
  let lines = null;
  for (const line of diff.split("\n")) {
    const target = line.match(/^\+\+\+ (?:b\/(.+)|\/dev\/null)$/);
    if (target) {
      lines = target[1] ? [] : null;
      if (lines) byPath.set(target[1], lines);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunk || !lines) continue;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    if (count === 0) lines.push(start, start + 1);
    for (let offset = 0; offset < count; offset += 1) lines.push(start + offset);
  }
  return byPath;
}

/** @param {any} node */
const isTestCall = (node) =>
  node.type === "CallExpression" &&
  node.callee.type === "Identifier" &&
  node.callee.name === "test";

/**
 * The first and last line of each test(...) call in a spec, a test in a loop once.
 * @param {string} source
 * @returns {{ line: number, endLine: number }[]}
 */
export function findTestLines(source) {
  const linter = new Linter({ configType: "flat" });
  linter.verify(source, [{ languageOptions: { ecmaVersion: "latest", sourceType: "module" } }]);
  const { ast, visitorKeys } = linter.getSourceCode();
  /** @type {{ line: number, endLine: number }[]} */
  const tests = [];
  /** @param {any} node */
  const visit = (node) => {
    if (isTestCall(node)) tests.push({ line: node.loc.start.line, endLine: node.loc.end.line });
    for (const key of visitorKeys[node.type] ?? []) {
      for (const child of [node[key]].flat()) if (child?.type) visit(child);
    }
  };
  visit(ast);
  return tests;
}

/**
 * Each test the diff wrote or edited, as its spec's path and the line its test(...) starts on.
 * @param {Map<string, number[]>} changedLines
 * @param {(path: string) => string | null} readSource the spec as the pull request leaves it, or
 *   null once it's deleted
 * @returns {Set<string>}
 */
export function listEditedTests(changedLines, readSource) {
  /** @type {Set<string>} */
  const edited = new Set();
  for (const [path, lines] of changedLines) {
    const source = readSource(path);
    if (source === null) continue;
    const tests = findTestLines(source);
    const findTest = (/** @type {number} */ line) =>
      tests.find((test) => test.line <= line && line <= test.endLine);
    const editsEveryTest = lines.some((line) => !findTest(line));
    for (const test of tests) {
      if (editsEveryTest || lines.some((line) => findTest(line) === test)) {
        edited.add(`${path}:${test.line}`);
      }
    }
  }
  return edited;
}

/**
 * A Playwright JSON report with only the specs `isKept` keeps.
 * @param {any} suite
 * @param {(spec: any) => boolean} isKept
 * @returns {any}
 */
const keepSpecs = (suite, isKept) => ({
  ...suite,
  specs: (suite.specs ?? []).filter(isKept),
  suites: (suite.suites ?? []).map((/** @type {any} */ inner) => keepSpecs(inner, isKept)),
});

/**
 * Burn-in's failed tests, those the pull request wrote or edited apart from the rest, and the
 * errors that broke the run outside any test.
 * @param {any} report a Playwright JSON report, with no retry
 * @param {Set<string>} editedTests
 */
export function sortBurnInFailures(report, editedTests) {
  const isEdited = (/** @type {any} */ spec) => editedTests.has(`${spec.file}:${spec.line}`);
  const keep = (/** @type {(spec: any) => boolean} */ isKept) => ({
    ...report,
    suites: (report.suites ?? []).map((/** @type {any} */ suite) => keepSpecs(suite, isKept)),
  });
  return {
    edited: listFailedTests([keep(isEdited)]),
    flaky: listFailedTests([keep((spec) => !isEdited(spec))]),
    runErrors: (report.errors ?? []).map((/** @type {any} */ error) =>
      readFirstLine(error.message),
    ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const reportPath = process.argv[2];
  if (!existsSync(reportPath)) {
    console.log(`::error::Burn-in's run broke before writing its report, ${reportPath}.`);
    process.exit(1);
  }
  const editedTests = listEditedTests(readChangedLines(readFileSync(0, "utf8")), (path) =>
    existsSync(path) ? readFileSync(path, "utf8") : null,
  );
  const { edited, flaky, runErrors } = sortBurnInFailures(
    JSON.parse(readFileSync(reportPath, "utf8")),
    editedTests,
  );
  writeFileSync(join(dirname(reportPath), "burn-in-flaky.json"), JSON.stringify(flaky));
  for (const test of flaky) {
    console.log(
      `::warning::A test this pull request didn't write or edit failed ${test.failures} of ${test.runs} runs, so it goes to the issue Flaky browser tests: ${test.name}`,
    );
  }
  for (const test of edited) {
    console.log(
      `::error::This pull request wrote or edited a test that failed ${test.failures} of ${test.runs} runs: ${test.name}`,
    );
  }
  for (const message of runErrors) console.log(`::error::Burn-in's run broke: ${message}`);
  process.exit(edited.length || runErrors.length ? 1 : 0);
}
