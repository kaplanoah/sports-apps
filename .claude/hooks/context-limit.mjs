// Hands a session off to a fresh one once its context grows large, since every turn re-reads all
// of it: past the reminder it asks the session to hand off at its next break, and past the stop it
// blocks every call a handoff doesn't need. A subagent's calls pass, since its context is its own.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REMINDER_TOKENS = 200_000;
const REMINDER_STEP_TOKENS = 10_000;
const STOP_TOKENS = 300_000;

const HANDOFF_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "ToolSearch",
  "mcp__claude-code-remote__get_session",
  "mcp__github__pull_request_read",
  "mcp__github__actions_get",
  "mcp__github__actions_list",
  "mcp__github__create_pull_request",
  "mcp__github__update_pull_request",
  "mcp__github__add_issue_comment",
  "mcp__github__add_reply_to_pull_request_comment",
  "mcp__github__resolve_review_thread",
  "mcp__github__merge_pull_request",
]);
const READ_ONLY_GITHUB_TOOL = /^mcp__github__(?:get|list|search)_/;
const GIT = String.raw`^git\s+(?:-C\s+\S+\s+)?`;
const HANDOFF_COMMANDS = [
  new RegExp(`${GIT}(?:status|log|diff|show|fetch|rev-parse|add|commit)\\b`),
  /^gh\s+pr\s+(?:view|checks|diff|create|edit|comment|merge)\b/,
  /^gh\s+run\s+(?:view|list|watch)\b/,
  /^gh\s+api\s+(?!graphql\b)/,
];
const PUSH = new RegExp(`${GIT}push\\b(.*)$`, "s");
// A push that forces, deletes, or names where it lands, as a push to beta does.
const UNSAFE_PUSH_OPTION = /\s(?:-\w*[fd]|--force|--delete|--mirror|--prune)|:/;

const HANDOFF_STEPS =
  "To hand off, commit and push your work, " +
  "and write a Handoff section in the PR description, opening the PR as a draft if there's none: " +
  "what happened, what was done, what's known, and what isn't. " +
  "Then give the owner a standalone prompt for a new session that takes over the PR and its branch, " +
  'with the line "Paste this in a new session now." above it, and stop. ' +
  "Don't start the new session yourself.";

/**
 * @typedef {object} HookInput
 * @property {string} [hook_event_name]
 * @property {string} [tool_name]
 * @property {Record<string, unknown>} [tool_input]
 * @property {string} [transcript_path]
 * @property {string} [agent_id]
 */

/**
 * The context a transcript line's reply read, in tokens, with the reply's id, or null for a line
 * that isn't a reply of this session's own, or that read none, like an API error the CLI writes.
 * @param {string} line
 */
function parseReply(line) {
  if (!line.includes('"usage"')) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = entry?.message?.usage;
  if (entry.type !== "assistant" || entry.isSidechain || !usage) return null;
  const tokens =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return tokens > 0 ? { id: entry.message.id, tokens } : null;
}

/**
 * The context the transcript's last two replies read, latest first, in tokens. The CLI writes a
 * reply as one entry for each of its blocks, which all count as one.
 * @param {string} transcript
 * @returns {number[]}
 */
export function readRecentContextTokens(transcript) {
  const lines = transcript.split("\n");
  /** @type {number[]} */
  const tokens = [];
  let latestId;
  for (let index = lines.length - 1; index >= 0 && tokens.length < 2; index -= 1) {
    const reply = parseReply(lines[index]);
    if (!reply || (tokens.length && reply.id === latestId)) continue;
    latestId = reply.id;
    tokens.push(reply.tokens);
  }
  return tokens;
}

/** @param {number} tokens */
const countReminderSteps = (tokens) =>
  tokens < REMINDER_TOKENS ? 0 : 1 + Math.floor((tokens - REMINDER_TOKENS) / REMINDER_STEP_TOKENS);

/**
 * Whether a Bash command is one a handoff needs: reading the branch and the PR, committing,
 * pushing the session's own branch, and updating, answering, and merging the PR.
 * @param {string} command
 */
function isHandoffCommand(command) {
  const trimmed = command.trim();
  const push = PUSH.exec(trimmed);
  if (push) return !UNSAFE_PUSH_OPTION.test(push[1]);
  return HANDOFF_COMMANDS.some((pattern) => pattern.test(trimmed));
}

/**
 * Whether a call is one a handoff needs.
 * @param {HookInput} input
 */
function isHandoffCall({ tool_name: toolName = "", tool_input: toolInput }) {
  if (toolName === "Bash") return isHandoffCommand(String(toolInput?.command ?? ""));
  return HANDOFF_TOOLS.has(toolName) || READ_ONLY_GITHUB_TOOL.test(toolName);
}

/** @param {number} tokens */
const describeContext = (tokens) =>
  `This session's context is at ${tokens.toLocaleString("en-US")} tokens, and every turn re-reads all of it.`;

/** @param {number} tokens */
const writeReminder = (tokens) =>
  `${describeContext(tokens)} ` +
  "Hand off to a fresh session at your next natural break: " +
  "after a push, after answering a review, or while waiting on CI or beta. " +
  "If all that's left is merging the PR and reading its deploy, finish instead. " +
  HANDOFF_STEPS;

/** @param {number} tokens */
const writeStopReason = (tokens) =>
  `${describeContext(tokens)} ` +
  `Past ${STOP_TOKENS.toLocaleString("en-US")}, only what a handoff needs runs: reading, ` +
  "committing and pushing your own branch without force, updating the PR's description, " +
  "replying on the PR, merging a PR whose check passed, reading its Deploy runs, and get_session. " +
  HANDOFF_STEPS;

/**
 * What the hook answers for an event, given the context of the transcript's last two replies,
 * or null to let it be. The reminder comes with each prompt, and between prompts only as a reply
 * passes another step, so it never fills the context it's there to keep small.
 * @param {HookInput} input
 * @param {number[]} recentTokens
 */
export function decideHookOutput(input, [latest = 0, previous = 0]) {
  const event = input.hook_event_name;
  const isReminded =
    (event === "UserPromptSubmit" && latest >= REMINDER_TOKENS) ||
    (event === "PostToolUse" && countReminderSteps(latest) > countReminderSteps(previous));
  if (isReminded)
    return {
      hookSpecificOutput: { hookEventName: event, additionalContext: writeReminder(latest) },
    };
  if (event === "PreToolUse" && latest >= STOP_TOKENS && !isHandoffCall(input))
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: "deny",
        permissionDecisionReason: writeStopReason(latest),
      },
    };
  return null;
}

/** Reads the hook's input and the transcript it names, and writes what the hook answers, if anything. */
function answerHookInput() {
  try {
    /** @type {HookInput} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    if (input.agent_id || !input.transcript_path) return;
    const transcript = readFileSync(input.transcript_path, "utf8");
    const output = decideHookOutput(input, readRecentContextTokens(transcript));
    if (output) process.stdout.write(JSON.stringify(output));
  } catch {
    // The hook never stops a session or CI: any error lets the call through.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) answerHookInput();
