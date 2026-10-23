import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TIME_ZONE_SOURCE, verifyTimeZoneCoverage } from "./time-zone-scope.mjs";
import { readRepoText } from "./browser-scope.mjs";
import { buildNodeTestArgs, listNodeTests } from "./node-tests.mjs";

/** @typedef {(command: string, arguments_: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => import("node:child_process").SpawnSyncReturns<string>} TimeZoneSpawn */

const ROOT = new URL("../", import.meta.url);
/** @type {{ sensitive: string[], fixed: string[], browserOnly?: string[] }} */
export const TIME_ZONE_MANIFEST = JSON.parse(
  readFileSync(new URL("../tests/time-zone-sensitive.json", import.meta.url), "utf8"),
);
const TEST_SCRIPT = "node worker/node-tests.mjs";

/**
 * @param {string[]} changes added or modified paths
 * @param {string[]} availableTests
 * @param {typeof TIME_ZONE_MANIFEST} [manifest]
 */
export function selectTimeZoneTests(changes, availableTests, manifest = TIME_ZONE_MANIFEST) {
  const selected = new Set(manifest.sensitive);
  for (const path of changes)
    if (availableTests.includes(path) && !manifest.fixed.includes(path)) selected.add(path);
  return [...selected].filter((path) => availableTests.includes(path)).sort();
}

/** @param {string[]} arguments_ */
const readGit = (arguments_) =>
  execFileSync("git", arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * @param {{ changed?: boolean, git?: typeof readGit, spawnImpl?: TimeZoneSpawn, log?: (message: string) => void, readText?: typeof readRepoText, listTests?: typeof listNodeTests, manifest?: typeof TIME_ZONE_MANIFEST }} [options]
 */
export function testInTimeZone({
  changed = false,
  git = readGit,
  spawnImpl = spawnSync,
  log = console.log,
  readText = readRepoText,
  listTests = listNodeTests,
  manifest = TIME_ZONE_MANIFEST,
} = {}) {
  const scripts = JSON.parse(readText("package.json")).scripts;
  if (scripts.test !== TEST_SCRIPT)
    throw new Error(
      "Update the protected time-zone command and its inventory for package.json's test script.",
    );
  const tracked = git(["ls-files", "-z"]).split("\0");
  const available = listTests();
  const sources = tracked.filter((path) => TIME_ZONE_SOURCE.test(path));
  verifyTimeZoneCoverage(available, manifest, readText, sources);
  const changes = changed
    ? git(["diff", "--name-only", "--no-renames", "--diff-filter=AM", "-z", "HEAD^1", "HEAD"])
        .split("\0")
        .filter(Boolean)
    : [];
  const files = selectTimeZoneTests(changes, available, manifest);
  if (!files.length)
    throw new Error("No sensitive tests were found; refusing an empty Honolulu run.");
  log(`Honolulu: ${files.length} date/time-sensitive or changed Node test files.`);
  const result = spawnImpl(process.execPath, ["--test-reporter=dot", ...buildNodeTestArgs(files)], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: "Pacific/Honolulu" },
    stdio: "inherit",
  });
  if (result.error) log(`Could not start the alternate-zone tests: ${result.error.message}`);
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== "--changed"))
    throw new Error("Usage: node worker/test-time-zone.mjs [--changed]");
  process.exitCode = testInTimeZone({ changed: arguments_.includes("--changed") });
}
