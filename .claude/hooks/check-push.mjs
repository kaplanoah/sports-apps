// Runs AGENTS.md's fast checks before a push, so a push that would turn CI red stops here instead,
// in seconds rather than a CI run and a review. The beta force-push skips them, since it pushes a
// commit that already passed, and so does any push past the context limit's stop, so a session
// handing off can always push.

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { readRecentContextTokens, STOP_TOKENS } from "./context-limit.mjs";

const PUSH = /^git\s+push(?:\s|$)/;
const BETA_PUSH = /^git\s+push\s+-f\s+origin\s+\S+:beta$/;
const CHECK_SCRIPTS = ["lint", "format:check", "typecheck", "deadcode"];
const OUTPUT_LINE_LIMIT = 40;

/**
 * @typedef {object} PushState
 * @property {string} command the Bash command
 * @property {boolean} isTreeClean whether `git status --porcelain` lists nothing
 * @property {boolean} hasPackages whether node_modules is there
 * @property {number[]} recentTokens the context of the transcript's last replies, latest first
 */

/** @typedef {{ isPassed: boolean, output: string }} CheckResult */

/**
 * Whether a command pushes and isn't the beta force-push.
 * @param {string} command
 */
function isCheckedPush(command) {
  const trimmed = command.trim();
  return PUSH.test(trimmed) && !BETA_PUSH.test(trimmed);
}

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
 * Why a push is blocked, or null to let the call through. Checks run only once the push is one
 * they judge: the commit being pushed is the working tree, and the packages they run on are there.
 * @param {PushState} state
 * @param {(script: string) => Promise<CheckResult>} runCheck runs one npm script
 * @returns {Promise<string | null>}
 */
export async function decidePush({ command, isTreeClean, hasPackages, recentTokens }, runCheck) {
  if (!isCheckedPush(command)) return null;
  if ((recentTokens[0] ?? 0) >= STOP_TOKENS) return null;
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
    const { stdout = "", stderr = "", message } = /** @type {any} */ (error);
    return { isPassed: false, output: `${stdout}${stderr}` || message };
  }
}

/**
 * Whether a folder's git working tree has nothing to commit.
 * @param {string} folder
 */
const isTreeCleanIn = (folder) =>
  execFileSync("git", ["status", "--porcelain"], { cwd: folder, encoding: "utf8" }).trim() === "";

/**
 * The context of the transcript's last replies, or none for a subagent's call, whose context is
 * its own, or when there's no transcript.
 * @param {{ transcript_path?: string, agent_id?: string }} input
 */
const readSessionTokens = ({ transcript_path: transcriptPath, agent_id: agentId }) =>
  agentId || !transcriptPath ? [] : readRecentContextTokens(readFileSync(transcriptPath, "utf8"));

/** Reads the hook's input and blocks a push, with exit code 2 and the reason, when it shouldn't go. */
async function checkHookInput() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const command = String(input.tool_input?.command ?? "");
  if (!isCheckedPush(command)) return;
  const folder = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const reason = await decidePush(
    {
      command,
      isTreeClean: isTreeCleanIn(folder),
      hasPackages: existsSync(join(folder, "node_modules")),
      recentTokens: readSessionTokens(input),
    },
    (script) => runNpmScript(folder, script),
  );
  if (!reason) return;
  process.stderr.write(`${reason}\n`);
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await checkHookInput();
