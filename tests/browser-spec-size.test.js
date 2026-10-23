import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "./repo-files.js";

// CI's burn-in runs every test in each browser spec a pull request changes ten times over, so a
// spec stays small enough that a one-line change to it repeats only a few tests.
const MOST_TESTS_PER_SPEC = 30;

/**
 * Playwright's own count of each spec's tests in each project, a test in a loop once per pass.
 * @returns {Map<string, number>} keyed by project and spec
 */
const countTestsPerSpec = () => {
  const playwright = fileURLToPath(new URL("node_modules/.bin/playwright", REPO_ROOT));
  const output = execFileSync(playwright, ["test", "--list", "--reporter=json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const counts = new Map();
  /** @param {any} suite @param {string} file */
  const countSuite = (suite, file) => {
    for (const child of suite.suites ?? []) countSuite(child, child.file ?? file);
    for (const spec of suite.specs ?? [])
      for (const { projectName } of spec.tests) {
        const key = `[${projectName}] ${spec.file ?? file}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
  };
  for (const suite of JSON.parse(output).suites) countSuite(suite, suite.file);
  return counts;
};

test(`every browser spec holds ${MOST_TESTS_PER_SPEC} tests at most`, () => {
  const counts = countTestsPerSpec();
  assert.ok(counts.size > 0);
  const tooBig = [...counts]
    .filter(([, count]) => count > MOST_TESTS_PER_SPEC)
    .map(([spec, count]) => `${spec}: ${count} tests`);
  assert.deepEqual(tooBig, [], "split each of these by what its tests are about");
});
