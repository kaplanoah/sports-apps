import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decideHookOutput,
  readRecentContextTokens,
  readSessionTokens,
} from "../.claude/hooks/context-limit.mjs";
import { readRepoFile } from "./repo-files.js";

const HOOK = `${import.meta.dirname}/../.claude/hooks/context-limit.mjs`;
const folder = mkdtempSync(join(tmpdir(), "context-limit-"));

/** @typedef {[string, Record<string, unknown>]} ToolCall a tool's name and its input */

/**
 * A transcript line for a reply that read `tokens` of context, split as the API splits it.
 * @param {number} tokens
 * @param {{ id?: string, isSidechain?: boolean }} [fields]
 */
const writeReplyLine = (tokens, { id = `msg_${tokens}`, ...fields } = {}) =>
  JSON.stringify({
    type: "assistant",
    ...fields,
    message: {
      id,
      content: [{ type: "text", text: "..." }],
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: tokens - 502,
        cache_creation_input_tokens: 500,
        output_tokens: 80,
      },
    },
  });

const USER_LINE = JSON.stringify({ type: "user", message: { content: "next" } });

/**
 * A transcript file, with a user's line before each reply, whose replies read each of `tokens`.
 * @param {number[]} tokens
 */
function writeTranscript(...tokens) {
  const path = join(folder, `${tokens.join("-")}.jsonl`);
  writeFileSync(
    path,
    `${tokens.flatMap((each) => [USER_LINE, writeReplyLine(each)]).join("\n")}\n`,
  );
  return path;
}

/**
 * What the hook writes, and its exit code, for an input.
 * @param {object} input
 */
function runHook(input) {
  const { status, stdout } = spawnSync("node", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  return { status, output: stdout ? JSON.parse(stdout).hookSpecificOutput : null };
}

const BRANCH = "claude/x";

/**
 * The hook's answer for a call at 300,000 tokens on `branch`, or null when it lets the call through.
 * @param {string} toolName
 * @param {Record<string, unknown>} [toolInput]
 * @param {string} [branch]
 */
const answerStopCall = (toolName, toolInput = {}, branch = BRANCH) =>
  decideHookOutput(
    { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput },
    [300_000],
    branch,
  );

/** @param {string} command */
const answerStopCommand = (command) => answerStopCall("Bash", { command });

test("under 200,000 tokens the hook writes nothing, on any event", () => {
  const transcript_path = writeTranscript(150_000, 199_999);
  for (const input of [
    { hook_event_name: "UserPromptSubmit", prompt: "next" },
    { hook_event_name: "PostToolUse", tool_name: "Read" },
    { hook_event_name: "PreToolUse", tool_name: "Edit" },
  ])
    assert.deepEqual(runHook({ ...input, transcript_path }), { status: 0, output: null });
});

test("at 200,000 tokens a prompt and a tool's result remind the session to hand off, naming the count", () => {
  const transcript_path = writeTranscript(190_000, 200_000);
  for (const hook_event_name of ["UserPromptSubmit", "PostToolUse"]) {
    const { status, output } = runHook({ hook_event_name, tool_name: "Read", transcript_path });
    assert.equal(status, 0);
    assert.equal(output.hookEventName, hook_event_name);
    assert.match(output.additionalContext, /context is at 200,000 tokens/);
    assert.match(output.additionalContext, /next natural break: after a push, /);
    assert.match(output.additionalContext, /merging the PR and reading its deploy, finish instead/);
    assert.match(output.additionalContext, /Handoff section in the PR description/);
    assert.match(
      output.additionalContext,
      /"Paste this in a new session now\." above it, and stop/,
    );
  }
});

test("between prompts the reminder comes only as a reply passes 200,000 or another 10,000", () => {
  const remind = (latest, previous) =>
    Boolean(decideHookOutput({ hook_event_name: "PostToolUse" }, [latest, previous]));
  assert.equal(remind(200_000, 199_999), true);
  assert.equal(remind(209_999, 200_000), false);
  assert.equal(remind(210_000, 209_999), true);
  assert.equal(remind(235_000, 221_000), true);
  assert.equal(remind(240_000, undefined), true);
  const prompt = decideHookOutput({ hook_event_name: "UserPromptSubmit" }, [205_000, 204_000]);
  assert.match(prompt?.hookSpecificOutput.additionalContext ?? "", /205,000 tokens/);
});

test("at 300,000 tokens the hook denies an edit and a push, and lets a read, a description's PATCH, and a merge through", () => {
  const transcript_path = writeTranscript(299_000, 300_000);
  /** @type {ToolCall[]} */
  const denied = [
    ["Edit", { file_path: "a.js" }],
    ["Bash", { command: "git push -f origin claude/x:beta" }],
  ];
  /** @type {ToolCall[]} */
  const allowed = [
    ["Read", { file_path: "AGENTS.md" }],
    ["Bash", { command: "gh api -X PATCH repos/o/r/pulls/1 -F body=@handoff.md" }],
    ["mcp__github__merge_pull_request", { pullNumber: 1, merge_method: "squash" }],
  ];
  for (const [tool_name, tool_input] of denied) {
    const { status, output } = runHook({
      hook_event_name: "PreToolUse",
      tool_name,
      tool_input,
      transcript_path,
    });
    assert.equal(status, 0);
    assert.equal(output.permissionDecision, "deny", tool_name);
    assert.match(output.permissionDecisionReason, /context is at 300,000 tokens/);
    assert.match(output.permissionDecisionReason, /Past 300,000, only what a handoff needs runs/);
    assert.match(output.permissionDecisionReason, /"Paste this in a new session now\."/);
  }
  for (const [tool_name, tool_input] of allowed)
    assert.deepEqual(
      runHook({ hook_event_name: "PreToolUse", tool_name, tool_input, transcript_path }),
      { status: 0, output: null },
      tool_name,
    );
});

test("under 300,000 tokens an edit goes through", () => {
  const transcript_path = writeTranscript(299_999);
  assert.deepEqual(runHook({ hook_event_name: "PreToolUse", tool_name: "Edit", transcript_path }), {
    status: 0,
    output: null,
  });
});

test("a whole handoff runs under the 300,000 block: reading, commit, push, the PR's description, a reply, and the merge", () => {
  const recentTokens = readRecentContextTokens(
    readFileSync(writeTranscript(310_000, 320_000), "utf8"),
  );
  /** @type {ToolCall[]} */
  const handoff = [
    ["ToolSearch", { query: "select:mcp__github__update_pull_request" }],
    ["mcp__claude-code-remote__get_session", {}],
    ["Grep", { pattern: "context-limit" }],
    ["Bash", { command: "git status" }],
    ["Bash", { command: "git diff origin/main" }],
    ["Bash", { command: "git add .claude/hooks/context-limit.mjs" }],
    ["Bash", { command: "git commit -F - <<'EOF'\nchore: a; b && c | d > e $(f) `g`\nEOF" }],
    ["Bash", { command: "git commit -m 'a $(b) | c > d'" }],
    ["Bash", { command: `git push -u origin ${BRANCH}` }],
    ["Bash", { command: "git push origin HEAD" }],
    ["Bash", { command: "git push" }],
    [
      "Bash",
      { command: "gh pr create --draft --title 'fix: a' --body-file - <<'EOF'\n## Handoff\nEOF" },
    ],
    ["mcp__github__update_pull_request", { pullNumber: 1, body: "## Handoff" }],
    ["Bash", { command: "gh api -X PATCH repos/o/r/pulls/1 -F body=@handoff.md" }],
    ["Bash", { command: "gh api repos/{owner}/{repo}/pulls/1/comments/2/replies -f body=Fixed." }],
    ["Bash", { command: "gh api --method PUT repos/o/r/pulls/1/merge -f merge_method=squash" }],
    ["Bash", { command: "gh api repos/o/r/actions/runs/4/jobs" }],
    ["mcp__github__add_reply_to_pull_request_comment", { commentId: 2, body: "Fixed." }],
    ["mcp__github__resolve_review_thread", { threadId: "t" }],
    ["mcp__github__add_issue_comment", { issue_number: 1, body: "Handed off." }],
    ["mcp__github__pull_request_read", { method: "get_status", pullNumber: 1 }],
    ["mcp__github__merge_pull_request", { pullNumber: 1, merge_method: "squash" }],
    ["Bash", { command: "gh pr merge 1 --squash" }],
    ["mcp__github__actions_list", { method: "list_workflow_runs" }],
    ["mcp__github__get_job_logs", { job_id: 3 }],
    ["Bash", { command: "gh run view 4 --log" }],
  ];
  for (const [tool_name, tool_input] of handoff)
    assert.equal(
      decideHookOutput(
        { hook_event_name: "PreToolUse", tool_name, tool_input },
        recentTokens,
        BRANCH,
      ),
      null,
      `${tool_name} ${JSON.stringify(tool_input)}`,
    );
});

test("at 300,000 tokens every call but a handoff's is denied, through any tool that writes", () => {
  for (const toolName of [
    "Edit",
    "Write",
    "NotebookEdit",
    "Agent",
    "Skill",
    "mcp__github__push_files",
    "mcp__github__create_or_update_file",
    "mcp__github__delete_file",
    "mcp__github__create_branch",
  ])
    assert.equal(answerStopCall(toolName)?.hookSpecificOutput.permissionDecision, "deny", toolName);
  for (const command of [
    "git push -f origin claude/x:beta",
    "git push --force-with-lease",
    "git push origin --delete claude/x",
    "git push origin HEAD:main",
    "git checkout -b claude/y",
    "git switch main",
    "git merge origin/main",
    "git rebase origin/main",
    "git reset --hard origin/main",
    "git restore AGENTS.md",
    "git stash",
    "npm run format",
    "npx playwright test apps/mlb/tests/browser/page.spec.mjs",
    "sed -i s/a/b/ AGENTS.md",
    "gh api graphql -f query=q",
  ])
    assert.equal(
      answerStopCommand(command)?.hookSpecificOutput.permissionDecision,
      "deny",
      command,
    );
});

test("at 300,000 tokens a push lands only on the branch checked out, under its own name, without force", () => {
  for (const command of [
    `git push origin +${BRANCH}`,
    "git push origin claude/another-sessions-branch",
    "git push origin beta",
    "git push --all",
    "git push --tags",
    "git push origin --mirror",
    `git push upstream ${BRANCH}`,
    `git push origin ${BRANCH} main`,
    `git -C /repo push -u origin ${BRANCH}`,
  ])
    assert.ok(answerStopCommand(command), command);
  assert.equal(answerStopCommand(`git push -u origin ${BRANCH}`), null);
  for (const branch of ["beta", "main", ""])
    assert.ok(answerStopCall("Bash", { command: "git push origin HEAD" }, branch), branch);
});

test("at 300,000 tokens gh api reads anything but writes only the PR, its comments, and its merge", () => {
  for (const command of [
    "gh api -X PUT repos/o/r/contents/AGENTS.md -f content=YQ==",
    "gh api -X PATCH repos/o/r/git/refs/heads/beta -f sha=abc",
    "gh api --method DELETE repos/o/r/git/refs/heads/claude/x",
    "gh api repos/o/r/actions/workflows/deploy.yml/dispatches -f ref=main",
    "gh api repos/o/r/actions/runs/4/rerun-failed-jobs -X POST",
    "gh api repos/o/r/issues -f title=t",
  ])
    assert.ok(answerStopCommand(command), command);
  assert.equal(answerStopCommand("gh api repos/o/r/contents/AGENTS.md"), null);
});

for (const command of [
  "gh api -X GET -X DELETE repos/o/r/git/refs/heads/beta",
  "gh api -X 'DELETE' repos/o/r/git/refs/heads/beta",
  'gh api --method="DELETE" repos/o/r/git/refs/heads/beta',
  "gh api -XDELETE repos/o/r/git/refs/heads/beta",
  "gh api repos/o/r/actions/workflows/deploy.yml/dispatches -fref=main",
  "gh api repos/o/r/issues -f title=t -H 'X: -X GET'",
  "gh api repos/o/r/issues -Ftitle=t",
  "gh api repos/o/r/issues --field=title=t",
  "gh api repos/o/r/issues --raw-field=title=t",
  "gh api repos/o/r/issues --input=body.json",
  "gh api -H 'X: --method=GET' -X DELETE repos/o/r/issues",
  "gh api -H '-f title=t' repos/o/r/issues -X DELETE",
  "gh api '-X' 'GET' '--method=DELETE' repos/o/r/git/refs/heads/beta",
  "gh api -X D\\ELETE repos/o/r/git/refs/heads/beta",
  "gh api repos/o/r/issues '-ftitle=t'",
  "gh api repos/o/r/issues '--input=body.json'",
  "gh api repos/o/r/issues -X DELETE # -X GET",
  "gh api -iXDELETE repos/o/r/git/refs/heads/beta",
  "gh api -iX DELETE repos/o/r/git/refs/heads/beta",
  "gh api -if ref=main repos/o/r/actions/workflows/deploy.yml/dispatches",
  "gh api -iFref=main repos/o/r/actions/workflows/deploy.yml/dispatches",
  "gh api -iX=DELETE repos/o/r/git/refs/heads/beta",
  "gh api -iH 'X: -X GET' -iXDELETE repos/o/r/issues",
]) {
  test(`at 300,000 tokens parsed API arguments deny ${command}`, () => {
    assert.ok(answerStopCommand(command), command);
  });
}

test("at 300,000 tokens API methods use the last value and ignore options inside headers", () => {
  for (const command of [
    "gh api -X DELETE -X 'GET' repos/o/r/issues",
    'gh api -XDELETE --method="GET" repos/o/r/issues',
    "gh api -H 'X: -X DELETE -f title=t' repos/o/r/issues",
    "gh api --method='PATCH' -Fbody=@handoff.md repos/o/r/pulls/1",
    "gh api repos/o/r/pulls/1 --method=PATCH --raw-field='body=handoff notes'",
    "gh api -X DELETE --method='GET' repos/o/r/issues --field title=t",
    "gh api -H 'X: --method=DELETE -f title=t' repos/o/r/issues",
    "gh api -X \\\nGET repos/o/r/issues",
    "gh api repos/o/r/issues # -X DELETE",
    "gh api -iXDELETE -iX GET repos/o/r/issues",
    "gh api -iH '-X DELETE' repos/o/r/issues",
    "gh api -iq '-X DELETE' repos/o/r/issues",
    "gh api -it '-X DELETE' repos/o/r/issues",
    "gh api -ip '-X DELETE' repos/o/r/issues",
    "gh api -iXPATCH repos/{owner}/{repo}/pulls/1 -if body=handoff",
  ])
    assert.equal(answerStopCommand(command), null, command);
});

test("at 300,000 tokens heredoc input cannot supply API flags or block a handoff's literal message", () => {
  for (const command of [
    "gh api repos/o/r/issues --input - <<'EOF'\n-X GET\nEOF",
    "gh api -X DELETE repos/o/r/git/refs/heads/beta <<'EOF'\n--method=GET\nEOF",
  ])
    assert.ok(answerStopCommand(command), command);
  for (const command of [
    "git commit -F - <<'EOF'\n--output=AGENTS.md --ext-diff\nEOF",
    "git commit -m '--output=AGENTS.md'",
    "gh api repos/o/r/pulls/1 --input - <<'EOF'\n-X DELETE\nEOF",
    "gh api <<'EOF' repos/o/r/pulls/1 --method PATCH --input -\n-X GET\nEOF",
  ])
    assert.equal(answerStopCommand(command), null, command);
});

for (const command of [
  "git diff --output=AGENTS.md origin/main",
  "git log --output=AGENTS.md",
  "git show --output=AGENTS.md",
  "git diff --output AGENTS.md",
  "git diff '--output=AGENTS.md'",
  "git diff --ext-diff",
  "git log '--ext-diff'",
  "git show --ext-diff",
  "git fetch --upload-pack=x .",
  "git fetch --upload-pack x .",
  "git fetch '--upload-pack=x' .",
  "git fetch --upl=x .",
  "git fetch --upload=x .",
  "git fetch --upl x .",
  "git fetch -o -- --upload-pack=x origin",
  "git fetch --server-option -- --upload=x origin",
  "git fetch --server-o -- --upl=x origin",
  "git fetch --depth -- --upload-pack=x origin",
  "git fetch -j -- --upload-pack=x origin",
  "git fetch -vo -- --upload-pack=x origin",
  "git -C /repo diff --output=AGENTS.md",
]) {
  test(`at 300,000 tokens git cannot write output or launch a helper: ${command}`, () => {
    assert.ok(answerStopCommand(command), command);
  });
}

test("at 300,000 tokens fetch consumes option values before its literal operands", () => {
  for (const command of [
    "git fetch -o -- -- origin",
    "git fetch -o-- origin",
    "git fetch --server-option=-- origin",
    "git fetch --depth 1 origin main",
    "git fetch -- origin '--upload-pack=notes'",
    "git fetch --prune -- origin '--upload-pack=notes'",
  ])
    assert.equal(answerStopCommand(command), null, command);
});

test("at 300,000 tokens an attached equals sign is a short option's value", () => {
  for (const option of ["-t=", "-q=", "-p=", "-H=", "-it=", "-iq=", "-ip=", "-iH="])
    for (const method of ["-X DELETE", "-XDELETE"])
      assert.ok(
        answerStopCommand(`gh api repos/o/r/git/refs/heads/beta ${option} ${method}`),
        `${option} ${method}`,
      );
  assert.equal(answerStopCommand("gh api repos/o/r/issues -X= -XGET"), null);
  assert.equal(answerStopCommand("gh api repos/o/r/issues -t= -XGET"), null);
  assert.equal(answerStopCommand("gh api repos/o/r/issues -t=x -XGET"), null);
});

test("at 300,000 tokens only ASCII shell whitespace separates API options", () => {
  for (const whitespace of ["\u00a0", "\ufeff", "\u2028", "\u2029", "\v", "\f", "\r"])
    for (const option of ["-t x", "-H X:a"])
      assert.ok(
        answerStopCommand(
          `gh api repos/o/r/git/refs/heads/beta -X DELETE ${option}${whitespace}-X${whitespace}GET`,
        ),
        JSON.stringify({ whitespace, option }),
      );
  assert.equal(answerStopCommand("gh\tapi\trepos/o/r/issues\t-X\tGET"), null);
});

test("at 300,000 tokens exact optional fetch flags do not consume the next word", () => {
  for (const option of ["--recurse-submodules", "--recurse-submodules=on-demand"])
    for (const helper of ["--upload-pack=x", "--upl=x"])
      assert.ok(answerStopCommand(`git fetch ${option} ${helper} .`), `${option} ${helper}`);
  assert.equal(
    answerStopCommand("git fetch --recurse-submodules -- origin --upload-pack=notes"),
    null,
  );
  assert.ok(answerStopCommand("git fetch --recurse-submodules-default -- --upload-pack=x origin"));
});

test("at 300,000 tokens no-index diff mode is outside the handoff grammar", () => {
  for (const command of [
    "git diff --no-index -S -- --output=AGENTS.md a b",
    "git diff --no-index -G -- --output=AGENTS.md a b",
    "git diff --no-index -O -- --output=AGENTS.md a b",
    "git diff --no-index --anchored -- --output=AGENTS.md a b",
    "git diff --no-index a b",
    "git -C /repo diff --no-index -S -- --output=AGENTS.md a b",
  ])
    assert.ok(answerStopCommand(command), command);
  assert.equal(answerStopCommand("git diff origin/main -- --no-index"), null);
});

test("at 300,000 tokens diff checks writing and helper flags past every option terminator", () => {
  for (const folder of ["/", "..", "/repo"])
    for (const valueOption of ["-S", "-G", "-O", "--anchored"])
      for (const unsafeOption of ["--output=AGENTS.md", "--output AGENTS.md", "--ext-diff"]) {
        const command = `git -C ${folder} diff ${valueOption} -- ${unsafeOption} a b`;
        assert.ok(answerStopCommand(command), command);
      }
  for (const command of [
    "git diff origin/main -- ./--output=notes.md",
    "git -C /repo diff origin/main -- ./--ext-diff",
    "git log -- --output=notes.md",
    "git show -- --ext-diff",
  ])
    assert.equal(answerStopCommand(command), null, command);
});

test("the stop reason explains literal arguments and the placeholder and heredoc exceptions", () => {
  const reason =
    answerStopCommand("gh pr view $NUMBER")?.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason ?? "", /literal arguments/);
  assert.match(reason ?? "", /variables/);
  assert.match(reason ?? "", /glob/);
  assert.match(reason ?? "", /brace/);
  assert.match(reason ?? "", /leading ~/);
  assert.match(reason ?? "", /\{owner\}\/\{repo\}/);
  assert.match(reason ?? "", /quoted heredoc/);
});

test("at 300,000 tokens fetch rejects the update-head-ok shorthand", () => {
  for (const command of ["git fetch -u origin", "git fetch -ux .", "git fetch '-ux' ."])
    assert.ok(answerStopCommand(command), command);
});

test("at 300,000 tokens each fetch value option consumes a literal double dash", () => {
  for (const option of [
    "-o",
    "-j",
    "--server-option",
    "--jobs",
    "--depth",
    "--deepen",
    "--shallow-since",
    "--shallow-exclude",
    "--negotiation-tip",
    "--filter",
    "--refmap",
    "--submodule-prefix",
    "--recurse-submodules-default",
  ]) {
    assert.ok(answerStopCommand(`git fetch ${option} -- --upload-pack=x origin`), option);
    assert.equal(answerStopCommand(`git fetch ${option} -- -- origin`), null, option);
  }
});

test("at 300,000 tokens unsupported shell expansions fail closed", () => {
  for (const command of [
    "git diff {--output=AGENTS.md,HEAD}",
    "git diff ${X:---output=AGENTS.md}",
    'git diff "${X:---output=AGENTS.md}"',
    "git fetch {--upload-pack=x,.}",
    "gh api -X GET repos/o/r/git/refs/heads/beta {-X,DELETE}",
    "git diff {1..3}",
    "git diff $OPTIONS",
    "git diff $'--output=AGENTS.md'",
    "git diff *",
    "git diff ?",
    "git diff [ab]",
    "git diff ~",
    "git push $REMOTE HEAD",
    "gh pr view $NUMBER",
  ])
    assert.ok(answerStopCommand(command), command);
  for (const command of [
    "git commit -m '${X} {a,b} {1..3}'",
    'git commit -m "\\$OPTIONS"',
    "gh api repos/{owner}/{repo}/pulls/1/comments/2/replies -f body=handoff",
  ])
    assert.equal(answerStopCommand(command), null, command);
});

test("at 300,000 tokens quotes, escapes, descriptors, and word comments keep their meanings", () => {
  for (const command of [
    "gh api repos/o/r/issues -X 'DELETE",
    "gh api 0<<'EOF' repos/o/r/git/refs/heads/beta -X DELETE\nx\nEOF",
    'gh api -H "a\\b" repos/o/r/issues -X DELETE',
    "gh api repos/o/r/issues -X DELETE x#y",
    "gh api repos/o/r/issues -X DELETE \\",
    "gh api repos/o/r/issues <<< '-X GET' -X DELETE",
  ])
    assert.ok(answerStopCommand(command), command);
  assert.equal(answerStopCommand("gh api 0<<'EOF' repos/o/r/pulls/1 -X PATCH\nx\nEOF"), null);
});

test("at 300,000 tokens a heredoc cannot hide a joined force push", () => {
  for (const operator of ["&&", ";", "|", "||", "&"])
    assert.ok(
      answerStopCommand(`git commit -F - <<'EOF' ${operator} git push -f origin main\nmsg\nEOF`),
      operator,
    );
});

test("at 300,000 tokens a handoff's command can't pipe, redirect, or substitute another in", () => {
  for (const command of [
    "git status > AGENTS.md",
    "git diff >> AGENTS.md",
    "git log < input",
    "git diff | sh",
    "git diff origin/main | node worker/red-change.mjs",
    'git commit -m "$(npm run format)"',
    "git commit -m $(npm run format)",
    "git commit -m `npm run format`",
    "git commit -F - <<EOF\n$(npm run format)\nEOF",
    "git status && npm run format",
    "gh pr view 1 > notes.md",
  ])
    assert.ok(answerStopCommand(command), command);
});

test("at 300,000 tokens quoted git folders and literal file names keep their argument meanings", () => {
  assert.equal(answerStopCommand("git -C '/repo folder' diff origin/main"), null);
  assert.equal(answerStopCommand("git -C /repo\\ folder status"), null);
  assert.ok(answerStopCommand("git diff origin/main -- '--output=notes.md'"));
  assert.ok(answerStopCommand("git -C '/repo folder' diff '--output=AGENTS.md'"));
  assert.ok(answerStopCommand("git -C '/repo folder' fetch '--upload-pack=x' ."));
  assert.ok(answerStopCommand("git -C '/repo folder' push"));
});

test("at 300,000 tokens git -C lets a listed read or commit through, but never a push", () => {
  assert.equal(answerStopCommand("git -C /repo status"), null);
  assert.equal(answerStopCommand("git -C /repo commit -m handoff"), null);
  assert.ok(answerStopCommand("git -C /repo push"));
  assert.ok(answerStopCommand("git -C /repo reset --hard"));
});

test("the hook reads the branch checked out from the session's folder to judge a push", () => {
  const repo = mkdtempSync(join(tmpdir(), "context-limit-repo-"));
  spawnSync("git", ["init", "--initial-branch", BRANCH, repo]);
  const transcript_path = writeTranscript(300_000);
  /** @param {string} command */
  const push = (command) =>
    runHook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
      transcript_path,
      cwd: repo,
    }).output;
  assert.equal(push(`git push -u origin ${BRANCH}`), null);
  assert.ok(push("git push origin claude/another-sessions-branch"));
});

test("the context is the latest reply's, with a reply written as several entries counted once", () => {
  const sameReply = writeReplyLine(205_000, { id: "msg_b" });
  const transcript = [writeReplyLine(195_000, { id: "msg_a" }), USER_LINE, sameReply, sameReply];
  assert.deepEqual(readRecentContextTokens(transcript.join("\n")), [205_000, 195_000]);
});

test("a subagent's reply, a reply that read nothing, and a line that doesn't parse are skipped", () => {
  const transcript = [
    writeReplyLine(120_000),
    writeReplyLine(305_000, { isSidechain: true }),
    writeReplyLine(310_000),
    JSON.stringify({ type: "assistant", message: { id: "msg_error", usage: { input_tokens: 0 } } }),
    '{"type":"assistant","message":{"usage"',
  ];
  assert.deepEqual(readRecentContextTokens(transcript.join("\n")), [310_000, 120_000]);
});

test("the session's context is read from its transcript, but not for a subagent or a transcript that can't be read", () => {
  const transcript_path = writeTranscript(150_000, 310_000);
  assert.deepEqual(readSessionTokens({ transcript_path }), [310_000, 150_000]);
  assert.deepEqual(readSessionTokens({ transcript_path, agent_id: "agent-1" }), []);
  assert.deepEqual(readSessionTokens({ transcript_path: join(folder, "missing.jsonl") }), []);
  assert.deepEqual(readSessionTokens({}), []);
});

test("a subagent's call, a missing transcript, a transcript that doesn't parse, or input that doesn't, gets no answer", () => {
  const atStop = writeTranscript(300_000);
  const broken = join(folder, "broken.jsonl");
  writeFileSync(broken, '{"type":"assistant","message":{"usage"\nnot json\n');
  const edit = { hook_event_name: "PreToolUse", tool_name: "Edit" };
  for (const input of [
    { ...edit, transcript_path: atStop, agent_id: "agent-1" },
    { ...edit, transcript_path: join(folder, "missing.jsonl") },
    { ...edit, transcript_path: broken },
    { ...edit },
  ])
    assert.deepEqual(runHook(input), { status: 0, output: null }, JSON.stringify(input));
  const { status, stdout } = spawnSync("node", [HOOK], { input: "not json", encoding: "utf8" });
  assert.deepEqual({ status, stdout }, { status: 0, stdout: "" });
});

test("the project's settings run the hook on every tool call, before and after, and on every prompt", () => {
  const { hooks } = JSON.parse(readRepoFile(".claude/settings.json"));
  for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit"]) {
    const entry = hooks[event]?.find(({ hooks: commands }) =>
      commands.some(({ command }) => command.endsWith('/.claude/hooks/context-limit.mjs"')),
    );
    assert.ok(entry, event);
    assert.ok(entry.matcher === undefined || entry.matcher === "*", event);
  }
});
