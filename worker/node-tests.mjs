import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NODE_TEST_PATTERNS = [
  "tests/*.test.js",
  "apps/*/tests/*.test.js",
  "services/*/tests/*.test.js",
];

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
 * @param {string[]} tests
 * @param {URL} [folder]
 */
export function testNodeFiles(tests, folder = root) {
  const result = spawnSync(process.execPath, buildNodeTestArgs(tests), {
    cwd: folder,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) testNodeFiles(listNodeTests());
