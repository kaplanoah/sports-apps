import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @typedef {(command: string, arguments_: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => import("node:child_process").SpawnSyncReturns<string>} TimeZoneSpawn */

const ROOT = new URL("../", import.meta.url);
/** @type {string[]} */
export const SENSITIVE_TESTS = JSON.parse(
  readFileSync(new URL("../tests/time-zone-sensitive.json", import.meta.url), "utf8"),
);
const INFRASTRUCTURE_FILES = new Set([
  ".nvmrc",
  ".node-version",
  ".npmrc",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "tests/time-zone-sensitive.json",
  "worker/test-time-zone.mjs",
  "worker/browser-scope.mjs",
  "worker/package-imports.mjs",
]);
const NODE_TEST = /^(?:tests|(?:apps|services)\/[^/]+\/tests)\/[^/]+\.test\.js$/;
const TEST_HELPER = /^(?:tests|(?:apps|services)\/[^/]+\/tests)\/.+\.[cm]?js$/;

/** @param {string} text git diff --name-status --no-renames -z */
export function parseTimeZoneChanges(text) {
  const fields = text.split("\0");
  if (fields.pop() !== "" || fields.length % 2) throw new Error("Incomplete change list.");
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!/^[AMD]$/.test(status) || !path) throw new Error("Unclassified change.");
    changes.push({ status, path });
  }
  return changes;
}

/** @param {string} path */
const isTestInfrastructure = (path) =>
  path.startsWith(".github/") ||
  INFRASTRUCTURE_FILES.has(path) ||
  (TEST_HELPER.test(path) && !NODE_TEST.test(path) && !path.endsWith(".spec.mjs"));

/**
 * @param {{ status: string, path: string }[] | null} changes null when git couldn't list them
 * @param {string[]} availableTests
 */
export function selectTimeZoneTests(changes, availableTests) {
  if (changes === null) return { files: null, reason: "The changes could not be classified." };
  for (const { status, path } of changes) {
    if (isTestInfrastructure(path))
      return { files: null, reason: `Test infrastructure changed: ${path}.` };
    if (status === "A" && NODE_TEST.test(path) && !SENSITIVE_TESTS.includes(path))
      return { files: null, reason: `An added or renamed Node test is unclassified: ${path}.` };
  }
  const files = SENSITIVE_TESTS.filter((path) => availableTests.includes(path));
  if (!files.length) return { files: null, reason: "No classified sensitive tests were found." };
  return {
    files,
    reason: "The explicit date/time-sensitive tests cover this alternate-zone run.",
  };
}

/** @param {string[]} arguments_ */
const readGit = (arguments_) =>
  execFileSync("git", arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** @param {typeof readGit} git */
function readTimeZoneChanges(git) {
  try {
    return parseTimeZoneChanges(
      git(["diff", "--name-status", "--no-renames", "-z", "HEAD^1", "HEAD"]),
    );
  } catch {
    return null;
  }
}

/**
 * @param {{ full?: boolean, git?: typeof readGit, spawnImpl?: TimeZoneSpawn, log?: (message: string) => void }} [options]
 */
export function testInTimeZone({
  full = false,
  git = readGit,
  spawnImpl = spawnSync,
  log = console.log,
} = {}) {
  let selection = { files: null, reason: "A full alternate-zone run was requested." };
  if (!full) {
    let availableTests = [];
    try {
      availableTests = git(["ls-files", "-z"])
        .split("\0")
        .filter((path) => NODE_TEST.test(path) && existsSync(new URL(path, ROOT)));
    } catch {
      // A missing file list must never turn an alternate-zone run into no tests.
    }
    selection = selectTimeZoneTests(readTimeZoneChanges(git), availableTests);
  }
  log(
    `Honolulu: ${selection.files ? `${selection.files.length} sensitive test files` : "every Node test"}. ${selection.reason}`,
  );
  const arguments_ = selection.files
    ? ["--import", "./tests/no-network.js", "--test", ...selection.files]
    : ["test"];
  const result = spawnImpl(selection.files ? process.execPath : "npm", arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, TZ: "Pacific/Honolulu", NODE_OPTIONS: "--test-reporter=dot" },
    stdio: "inherit",
  });
  if (result.error) log(`Could not start the alternate-zone tests: ${result.error.message}`);
  return result.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 1 || arguments_[0] !== "--full"))
    throw new Error("Usage: node worker/test-time-zone.mjs [--full]");
  process.exitCode = testInTimeZone({ full: arguments_.includes("--full") });
}
