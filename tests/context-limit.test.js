import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideHookOutput, readRecentContextTokens } from "../.claude/hooks/context-limit.mjs";
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

/**
 * The hook's answer for a call at 300,000 tokens, or null when it lets the call through.
 * @param {string} toolName
 * @param {Record<string, unknown>} [toolInput]
 */
const answerStopCall = (toolName, toolInput = {}) =>
  decideHookOutput(
    { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput },
    [300_000],
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
    ["Bash", { command: "git commit -F - <<'EOF'\nchore: a; b && c\nEOF" }],
    ["Bash", { command: "git push -u origin claude/serene-heisenberg-uksdx3" }],
    ["mcp__github__update_pull_request", { pullNumber: 1, body: "## Handoff" }],
    ["Bash", { command: "gh api -X PATCH repos/o/r/pulls/1 -F body=@handoff.md" }],
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
      decideHookOutput({ hook_event_name: "PreToolUse", tool_name, tool_input }, recentTokens),
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

test("a git command run with -C another folder is judged as the command it runs", () => {
  assert.equal(answerStopCommand("git -C /repo status"), null);
  assert.equal(answerStopCommand("git -C /repo push -u origin claude/x"), null);
  assert.ok(answerStopCommand("git -C /repo push -f origin claude/x"));
  assert.ok(answerStopCommand("git -C /repo reset --hard"));
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
