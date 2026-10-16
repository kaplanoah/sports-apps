import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { findCommandProblem, findSeparator } from "../.claude/hooks/one-command.mjs";

const HOOK = `${import.meta.dirname}/../.claude/hooks/one-command.mjs`;

test("a call that starts with cd is blocked, and a word that only starts with cd isn't", () => {
  assert.match(findCommandProblem("cd apps/wnba") ?? "", /^It starts with cd\./);
  assert.match(findCommandProblem("  cd") ?? "", /^It starts with cd\./);
  assert.equal(findCommandProblem("cdk deploy"), null);
});

test("commands joined with &&, ||, ;, or a line break are blocked", () => {
  assert.equal(findSeparator("git fetch origin main && git status"), "&&");
  assert.equal(findSeparator("npm run lint || true"), "||");
  assert.equal(findSeparator("git status; git log"), ";");
  assert.equal(findSeparator("git status\ngit log"), "a line break");
});

test("one command passes, with a pipe, quotes, a subshell, a line continuation, or a heredoc", () => {
  assert.equal(findSeparator("git diff origin/main | node worker/red-change.mjs"), null);
  assert.equal(findSeparator(`node -e "a(); b()"`), null);
  assert.equal(findSeparator("node -e 'a && b'"), null);
  assert.equal(findSeparator("echo $(date; uptime)"), null);
  assert.equal(findSeparator("npx playwright test \\\n  tests/browser/a.spec.mjs"), null);
  assert.equal(findSeparator("npm test 2>&1"), null);
  assert.equal(findSeparator("git commit -F - <<'EOF'\nfix: a; b && c\n\nmore\nEOF"), null);
});

test("a command run in the background before another is blocked, and a redirect or pipe of its errors isn't", () => {
  assert.equal(findSeparator("npm run dev & npx playwright test"), "&");
  assert.equal(findSeparator("npm run dev &"), "&");
  assert.equal(findSeparator("npm test 2>&1 | tail"), null);
  assert.equal(findSeparator("npm test &> out.txt"), null);
  assert.equal(findSeparator("npm test >&2"), null);
  assert.equal(findSeparator("npm test |& tail"), null);
  assert.equal(findSeparator("curl 'https://example.com/?a=1&b=2'"), null);
});

test("a subshell that starts with cd is blocked", () => {
  assert.match(findCommandProblem("(cd apps/wnba)") ?? "", /^It starts with cd\./);
  assert.match(findCommandProblem("( cd apps/wnba npm test )") ?? "", /^It starts with cd\./);
  assert.equal(findCommandProblem("(cdk deploy)"), null);
});

test("commands a shell is handed as one string are blocked as if typed", () => {
  for (const command of [
    'bash -c "git status; git log"',
    "sh -c 'npm ci && npm test'",
    'bash -lc "a || b"',
    'bash --norc -c "a & b"',
    'npx something | bash -c "a; b"',
  ])
    assert.match(findCommandProblem(command) ?? "", /^It joins commands with /, command);
  assert.equal(findCommandProblem('bash -c "npm test"'), null);
  assert.equal(findCommandProblem(`node -e "a(); b()"`), null);
  assert.match(findCommandProblem('echo $(bash -c "a; b")') ?? "", /^It joins commands with ;/);
});

test("a message or heredoc that only mentions a shell's script runs nothing, so it passes", () => {
  for (const command of [
    `git commit -m "fix: bash -c \\"a; b\\" is now blocked"`,
    `git commit -m "fix: sh -c 'a; b' is now blocked"`,
    "git commit -F - <<'EOF'\nfix: block bash -c \"a; b\"\nEOF",
    "gh pr comment 1 --body-file - <<EOF\nsh -c 'a && b' and bash -c \"c; d\"\nEOF",
  ])
    assert.equal(findCommandProblem(command), null, command);
});

test("parentheses inside $(...) nest, so what follows them is still inside it", () => {
  assert.equal(findSeparator("echo $(f (x); g)"), null);
  assert.equal(findSeparator("echo $(f $(g; h) (i); j)"), null);
  assert.equal(findSeparator("echo $(f (x)); git status"), ";");
});

test("a heredoc's end lets the check go on to what follows it", () => {
  assert.equal(findSeparator("cat <<EOF\nbody;\nEOF\ngit push"), "a line break");
});

test("the hook blocks a broken call with exit code 2 and its reason, and passes one command", () => {
  const blocked = spawnSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "cd apps && ls" } }),
    encoding: "utf8",
  });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /AGENTS\.md, under "Workflow"/);
  const passed = execFileSync("node", [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }),
    encoding: "utf8",
  });
  assert.equal(passed, "");
});
