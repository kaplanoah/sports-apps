import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decidePush, findPushFolder } from "../.claude/hooks/check-push.mjs";
import { STOP_TOKENS } from "../.claude/hooks/context-limit.mjs";
import { readRepoFile } from "./repo-files.js";

const HOOK = `${import.meta.dirname}/../.claude/hooks/check-push.mjs`;
const CHECKS = ["lint", "format:check", "typecheck", "deadcode"];

/**
 * A runner that records each npm script it's asked for, failing those in `failures` with their output.
 * @param {Record<string, string>} [failures]
 */
function fakeRunner(failures = {}) {
  /** @type {string[]} */
  const scripts = [];
  /** @param {string} script */
  const runCheck = async (script) => {
    scripts.push(script);
    return script in failures
      ? { isPassed: false, output: failures[script] }
      : { isPassed: true, output: "" };
  };
  return { scripts, runCheck };
}

/**
 * What the hook decides for a command, with a clean tree, packages, and a small context unless
 * `state` says otherwise, and the scripts it ran.
 * @param {string} command
 * @param {{ isTreeClean?: boolean, hasPackages?: boolean, recentTokens?: number[] }} [state]
 * @param {Record<string, string>} [failures]
 */
async function decide(command, state = {}, failures = {}) {
  const { scripts, runCheck } = fakeRunner(failures);
  const reason = await decidePush(
    { command, isTreeClean: true, hasPackages: true, recentTokens: [50_000], ...state },
    runCheck,
  );
  return { reason, scripts };
}

test("a push runs the four checks and goes when they pass", async () => {
  for (const command of [
    "git push",
    "git push -u origin claude/x",
    "  git push origin HEAD",
    "git -C ../other push",
    "git -c push.default=current push",
  ])
    assert.deepEqual(await decide(command), { reason: null, scripts: CHECKS }, command);
});

test("a push runs in the session's folder, moved by each -C given before push", () => {
  assert.equal(findPushFolder("git push", "/repo"), "/repo");
  assert.equal(findPushFolder("git -C ../other push", "/repo/a"), "/repo/other");
  assert.equal(findPushFolder("git -C /tree -c x=y -C sub push -u", "/repo"), "/tree/sub");
});

test("anything but a push runs no check", async () => {
  for (const command of ["git status", "git pushx", "git log --grep push", "npm run lint"])
    assert.deepEqual(await decide(command), { reason: null, scripts: [] }, command);
});

test("the beta force-push runs no check, since its commit already passed", async () => {
  assert.deepEqual(await decide("git push -f origin claude/x:beta"), { reason: null, scripts: [] });
});

test("a push with uncommitted changes is refused before any check", async () => {
  const { reason, scripts } = await decide("git push", { isTreeClean: false });
  assert.match(reason ?? "", /uncommitted changes/);
  assert.deepEqual(scripts, []);
});

test("a push without node_modules asks for npm ci before any check", async () => {
  const { reason, scripts } = await decide("git push", { hasPackages: false });
  assert.match(reason ?? "", /run npm ci/);
  assert.deepEqual(scripts, []);
});

test("a push at or past the context limit's stop goes unchecked, even with uncommitted changes", async () => {
  for (const tokens of [STOP_TOKENS, STOP_TOKENS + 1])
    assert.deepEqual(
      await decide("git push", { recentTokens: [tokens], isTreeClean: false, hasPackages: false }),
      { reason: null, scripts: [] },
    );
});

test("a push just under the stop is checked", async () => {
  const { scripts } = await decide("git push", { recentTokens: [STOP_TOKENS - 1] });
  assert.deepEqual(scripts, CHECKS);
});

test("a failing check blocks the push with its output", async () => {
  const { reason } = await decide("git push", {}, { typecheck: "page.js(3,1): error TS2304" });
  assert.match(reason ?? "", /^npm run typecheck failed/);
  assert.match(reason ?? "", /page\.js\(3,1\): error TS2304/);
});

test("with more than one failing check, the first in order is shown", async () => {
  const { reason } = await decide("git push", {}, { deadcode: "unused export", lint: "no-undef" });
  assert.match(reason ?? "", /^npm run lint failed/);
  assert.doesNotMatch(reason ?? "", /unused export/);
});

test("a long failure shows its first lines and how many more there are", async () => {
  const output = Array.from({ length: 50 }, (_, index) => `error ${index + 1}`).join("\n\n");
  const { reason } = await decide("git push", {}, { lint: output });
  assert.match(reason ?? "", /error 40\n\.\.\. and 10 more lines$/);
  assert.doesNotMatch(reason ?? "", /error 41/);
});

/**
 * A git repo with a commit, node_modules, and npm scripts for the four checks, each passing but
 * those named in `failingScripts`, which print "<script> broke" and fail.
 * @param {string[]} [failingScripts]
 */
function makeRepo(failingScripts = []) {
  const repo = mkdtempSync(join(tmpdir(), "check-push-"));
  const scripts = Object.fromEntries(
    CHECKS.map((script) => [
      script,
      failingScripts.includes(script) ? `echo ${script} broke && exit 1` : "true",
    ]),
  );
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts }));
  mkdirSync(join(repo, "node_modules"));
  const git = ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.com"];
  spawnSync("git", ["init", repo]);
  spawnSync("git", [...git, "add", "package.json"]);
  spawnSync("git", [...git, "-c", "commit.gpgsign=false", "commit", "-m", "start"]);
  return repo;
}

/**
 * The hook's exit code and what it wrote, for a Bash command run in `folder`, with the project's
 * folder somewhere else.
 * @param {string} command
 * @param {string} folder
 * @param {object} [input] more of the hook's input
 */
function runHook(command, folder, input = {}) {
  const { status, stdout, stderr } = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: folder, ...input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: makeRepo(["lint"]) },
    encoding: "utf8",
  });
  return { status, stdout, stderr };
}

test("the hook lets anything but a push through, saying nothing", () => {
  const repo = makeRepo(["lint"]);
  writeFileSync(join(repo, "notes.md"), "draft");
  assert.deepEqual(runHook("git status", repo), { status: 0, stdout: "", stderr: "" });
});

test("the hook lets a push through, saying nothing, when the checks pass in the push's folder", () => {
  assert.deepEqual(runHook("git push", makeRepo()), { status: 0, stdout: "", stderr: "" });
});

test("the hook blocks a push from a tree with uncommitted changes, saying why", () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "notes.md"), "draft");
  const { status, stdout, stderr } = runHook("git push", repo);
  assert.deepEqual({ status, stdout }, { status: 2, stdout: "" });
  assert.match(stderr, /^The working tree has uncommitted changes/);
});

test("the hook blocks a push whose check fails, with what the check wrote", () => {
  const { status, stderr } = runHook("git push", makeRepo(["typecheck"]));
  assert.equal(status, 2);
  assert.match(stderr, /^npm run typecheck failed/);
  assert.match(stderr, /typecheck broke/);
});

test("the hook checks a push when the session's transcript can't be read", () => {
  const repo = makeRepo(["lint"]);
  const transcript_path = join(repo, "missing.jsonl");
  assert.equal(runHook("git push", repo, { transcript_path }).status, 2);
});

test("the hook checks a push run with -C in the folder it names", () => {
  const parent = makeRepo();
  const other = makeRepo(["deadcode"]);
  assert.match(runHook(`git -C ${other} push`, parent).stderr, /^npm run deadcode failed/);
});

test("the project's settings run the hook on Bash, with time for the checks", () => {
  const { hooks } = JSON.parse(readRepoFile(".claude/settings.json"));
  const entry = hooks.PreToolUse?.find(({ hooks: commands }) =>
    commands.some(({ command }) => command.endsWith('/.claude/hooks/check-push.mjs"')),
  );
  assert.equal(entry?.matcher, "Bash");
  const hook = entry.hooks.find(({ command }) => command.endsWith('/check-push.mjs"'));
  assert.ok(hook.timeout >= 120);
});
