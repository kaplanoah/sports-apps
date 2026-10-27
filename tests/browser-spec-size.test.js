import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./repo-files.js";

// Burn-in repeats each selected spec ten times, including its helpers' tests, so the size limit
// keeps one change from repeating too many tests.
const MOST_TESTS_PER_SPEC = 30;

/**
 * Each project's tests grouped under their outer owning spec.
 * @param {any} report
 * @returns {Map<string, number>} keyed by project and spec
 */
const countReportedTests = (report) => {
  const counts = new Map();
  /** @param {any} suite @param {string} ownerFile */
  const countSuite = (suite, ownerFile) => {
    for (const child of suite.suites ?? []) countSuite(child, ownerFile);
    for (const spec of suite.specs ?? [])
      for (const { projectName } of spec.tests) {
        const key = `[${projectName}] ${ownerFile}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
  };
  for (const suite of report.suites) countSuite(suite, suite.file);
  return counts;
};

/** @returns {Map<string, number>} */
const countTestsPerSpec = () => {
  const playwright = fileURLToPath(new URL("node_modules/.bin/playwright", REPO_ROOT));
  const output = execFileSync(playwright, ["test", "--list", "--reporter=json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return countReportedTests(JSON.parse(output));
};

/** @param {number} count @param {string} file */
const createReportedSpecs = (count, file) =>
  Array.from({ length: count }, () => ({ file, tests: [{ projectName: "wnba" }] }));

test("direct and helper declarations share their owning spec's size limit", () => {
  const file = "apps/wnba/tests/browser/notifications.spec.mjs";
  const helper = "tests/browser/game-reminders.mjs";
  const counts = countReportedTests({
    suites: [
      {
        file,
        specs: createReportedSpecs(2, file),
        suites: [{ file: helper, specs: createReportedSpecs(MOST_TESTS_PER_SPEC - 1, helper) }],
      },
    ],
  });
  assert.equal(counts.get(`[wnba] ${file}`), MOST_TESTS_PER_SPEC + 1);
});

test("shared declarations stay separate for each importing spec", () => {
  const files = ["apps/wnba/tests/browser/a.spec.mjs", "apps/wnba/tests/browser/b.spec.mjs"];
  const helper = "tests/browser/shared.mjs";
  const counts = countReportedTests({
    suites: files.map((file) => ({ file, specs: createReportedSpecs(2, helper) })),
  });
  assert.deepEqual(
    [...counts],
    files.map((file) => [`[wnba] ${file}`, 2]),
  );
});

test(`every browser spec holds ${MOST_TESTS_PER_SPEC} tests at most`, () => {
  const counts = countTestsPerSpec();
  assert.ok(counts.size > 0);
  const tooBig = [...counts]
    .filter(([, count]) => count > MOST_TESTS_PER_SPEC)
    .map(([spec, count]) => `${spec}: ${count} tests`);
  assert.deepEqual(tooBig, [], "split each of these by what its tests are about");
});
