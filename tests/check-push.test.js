import test from "node:test";
import assert from "node:assert/strict";
import { decidePush } from "../.claude/hooks/check-push.mjs";
import { STOP_TOKENS } from "../.claude/hooks/context-limit.mjs";
import { readRepoFile } from "./repo-files.js";

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
  for (const command of ["git push", "git push -u origin claude/x", "  git push origin HEAD"])
    assert.deepEqual(await decide(command), { reason: null, scripts: CHECKS }, command);
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

test("the project's settings run the hook on Bash, with time for the checks", () => {
  const { hooks } = JSON.parse(readRepoFile(".claude/settings.json"));
  const entry = hooks.PreToolUse?.find(({ hooks: commands }) =>
    commands.some(({ command }) => command.endsWith('/.claude/hooks/check-push.mjs"')),
  );
  assert.equal(entry?.matcher, "Bash");
  const hook = entry.hooks.find(({ command }) => command.endsWith('/check-push.mjs"'));
  assert.ok(hook.timeout >= 120);
});
