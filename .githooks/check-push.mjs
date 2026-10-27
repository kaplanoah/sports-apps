import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const CHECK_SCRIPTS = ["lint", "format:check", "typecheck", "deadcode"];
const OUTPUT_LINE_LIMIT = 40;

/**
 * @typedef {object} PushState
 * @property {boolean} isTreeClean whether `git status --porcelain` lists nothing
 * @property {boolean} hasPackages whether node_modules is there
 */

/** @typedef {{ isPassed: boolean, output: string }} CheckResult */

/**
 * A check's output, up to its first lines, without blank ones.
 * @param {string} output
 */
function trimOutput(output) {
  const lines = output.split("\n").filter((line) => line.trim());
  const shown = lines.slice(0, OUTPUT_LINE_LIMIT);
  if (lines.length > shown.length) shown.push(`... and ${lines.length - shown.length} more lines`);
  return shown.join("\n");
}

/**
 * Why a push is blocked, or null when the clean working tree passes every check.
 * @param {PushState} state
 * @param {(script: string) => Promise<CheckResult>} runCheck runs one npm script
 * @returns {Promise<string | null>}
 */
export async function decidePush({ isTreeClean, hasPackages }, runCheck) {
  if (!isTreeClean)
    return (
      "The working tree has uncommitted changes, so the checks would judge it rather than the commit being pushed. " +
      "Commit or remove them, as git status lists them, then push again."
    );
  if (!hasPackages)
    return "node_modules is missing, so the checks can't run: run npm ci, then push again.";
  const results = await Promise.all(CHECK_SCRIPTS.map(runCheck));
  const failedIndex = results.findIndex(({ isPassed }) => !isPassed);
  if (failedIndex === -1) return null;
  return (
    `npm run ${CHECK_SCRIPTS[failedIndex]} failed, so the push would turn CI red. ` +
    `Fix it, commit, and push again.\n${trimOutput(results[failedIndex].output)}`
  );
}

/**
 * Runs an npm script in a folder, with what it wrote.
 * @param {string} folder
 * @param {string} script
 * @returns {Promise<CheckResult>}
 */
async function runNpmScript(folder, script) {
  try {
    const { stdout, stderr } = await promisify(execFile)("npm", ["run", "--silent", script], {
      cwd: folder,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { isPassed: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const {
      stdout = "",
      stderr = "",
      message,
    } = /** @type {{ stdout?: string, stderr?: string, message: string }} */ (error);
    return { isPassed: false, output: `${stdout}${stderr}` || message };
  }
}

/**
 * Whether a folder's git working tree has nothing to commit.
 * @param {string} folder
 */
const isTreeCleanIn = (folder) =>
  execFileSync("git", ["status", "--porcelain"], { cwd: folder, encoding: "utf8" }).trim() === "";

/** @param {string[]} args */
const readGit = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** @param {string} line */
function readPushedCommit(line) {
  const fields = line.trim().split(/\s+/);
  const object = fields[1];
  if (fields.length !== 4 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object))
    throw new Error("Git supplied an invalid pre-push ref update.");
  if (/^0+$/.test(object)) return null;
  return readGit(["rev-parse", "--verify", `${object}^{commit}`]);
}

/** @param {string} input */
function listPushedCommits(input) {
  const commits = input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(readPushedCommit)
    .filter((commit) => commit !== null);
  return [...new Set(commits)];
}

/** @param {string} commit */
const isOnOrigin = (commit) =>
  readGit([
    "for-each-ref",
    `--contains=${commit}`,
    "--format=%(refname)",
    "refs/remotes/origin/",
  ]) !== "";

/** Checks only unpublished commits, using the working tree only when it is the pushed commit. */
async function checkPush() {
  const unpublished = listPushedCommits(readFileSync(0, "utf8")).filter(
    (commit) => !isOnOrigin(commit),
  );
  if (!unpublished.length) return;
  const head = readGit(["rev-parse", "HEAD"]);
  if (unpublished.some((commit) => commit !== head)) {
    process.stderr.write(
      "The push includes an unpublished commit other than HEAD. Check out that commit and push it separately so the checks judge the code being pushed.\n",
    );
    process.exitCode = 1;
    return;
  }
  const folder = process.cwd();
  const reason = await decidePush(
    {
      isTreeClean: isTreeCleanIn(folder),
      hasPackages: existsSync(join(folder, "node_modules")),
    },
    (script) => runNpmScript(folder, script),
  );
  if (!reason) return;
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await checkPush();
