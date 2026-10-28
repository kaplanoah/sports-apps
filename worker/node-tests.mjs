import { execFileSync, spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listReachedFiles, readRepoText } from "./browser-scope.mjs";

const NODE_TEST_PATTERNS = [
  "tests/*.test.js",
  "apps/*/tests/*.test.js",
  "services/*/tests/*.test.js",
];
// Each reads every tracked or guidance file by listing them, which no import or path ties to a change.
const LISTING_TESTS = [
  "tests/agent-guidance.test.js",
  "tests/agents-lines.test.js",
  "tests/no-secrets.test.js",
  "tests/rule-files.test.js",
];
const BRANCH_BASE = "origin/main";

const root = new URL("../", import.meta.url);

/** @param {URL} [folder] */
export const listNodeTests = (folder = root) =>
  globSync(NODE_TEST_PATTERNS, { cwd: folder }).sort();

/** @param {string[]} tests */
export function buildNodeTestArgs(tests) {
  if (!tests.length) throw new Error("No Node tests were found.");
  return ["--import", "./tests/no-network.js", "--test", ...tests];
}

/**
 * The tests that changed files reach: each that imports one or names its path, and those that
 * read files by listing them.
 * @param {string[]} changes paths from the repo's root
 * @param {string[]} tests
 * @param {(path: string) => string | null} readText null for a file that isn't there
 */
export function selectChangedTests(changes, tests, readText) {
  /** @param {string} test */
  const isReached = (test) => {
    const reached = listReachedFiles([test], readText);
    const text = readText(test) ?? "";
    return changes.some((path) => reached.has(path) || text.includes(path));
  };
  return tests.filter((test) => LISTING_TESTS.includes(test) || isReached(test));
}

/**
 * The files a branch changes since it left main.
 * @param {URL} folder
 */
function listBranchChanges(folder) {
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", `${BRANCH_BASE}...HEAD`],
      { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new Error(
      `Git couldn't compare the branch with ${BRANCH_BASE}: run git fetch origin main, then try again.`,
    );
  }
}

/**
 * @param {string[]} tests
 * @param {URL} [folder]
 * @param {string[]} [options] Node's options for the run, ahead of the tests
 */
export function testNodeFiles(tests, folder = root, options = []) {
  const result = spawnSync(process.execPath, [...options, ...buildNodeTestArgs(tests)], {
    cwd: folder,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== "--changed"))
    throw new Error("Usage: node worker/node-tests.mjs [--changed]");
  if (arguments_.length)
    testNodeFiles(
      selectChangedTests(listBranchChanges(root), listNodeTests(), readRepoText),
      root,
      ["--test-reporter=dot"],
    );
  else testNodeFiles(listNodeTests());
}
