// Hands a session off to a fresh one once its context grows large, since every turn re-reads all
// of it: past the reminder it asks the session to hand off at its next break, and past the stop it
// blocks every call a handoff doesn't need. A subagent's calls pass, since its context is its own.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseCommandWords } from "./one-command.mjs";

const REMINDER_TOKENS = 200_000;
const REMINDER_STEP_TOKENS = 10_000;
export const STOP_TOKENS = 300_000;

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
const HANDOFF_GIT_COMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "fetch",
  "rev-parse",
  "add",
  "commit",
]);
const HANDOFF_COMMANDS = [
  /^gh\s+pr\s+(?:view|checks|diff|create|edit|comment|merge)\b/,
  /^gh\s+run\s+(?:view|list|watch)\b/,
];
const PUSH_OPTIONS = new Set(["-u", "--set-upstream"]);
const SHARED_BRANCHES = new Set(["main", "beta"]);
const GH_API_VALUE_OPTIONS = new Set([
  "-X",
  "--method",
  "-H",
  "--header",
  "-f",
  "--raw-field",
  "-F",
  "--field",
  "--input",
  "-q",
  "--jq",
  "-t",
  "--template",
  "--hostname",
  "--cache",
  "-p",
  "--preview",
]);
const FETCH_VALUE_OPTIONS = [
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
];
// The PR, its comments and replies, and its merge: what a handoff writes through REST.
const PULL_REQUEST_ENDPOINT =
  /^\/?repos\/[^/\s]+\/[^/\s]+\/(?:pulls(?:\/\d+(?:\/(?:merge|comments(?:\/\d+\/replies)?))?)?|issues\/\d+\/comments)(?:\?\S*)?$/;

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
 * @property {string} [cwd]
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

/**
 * The context the session's last two replies read, latest first, or none for a subagent's call,
 * whose context is its own, or when there's no transcript or it can't be read.
 * @param {HookInput} input
 * @returns {number[]}
 */
export function readSessionTokens({ transcript_path: transcriptPath, agent_id: agentId }) {
  if (agentId || !transcriptPath) return [];
  try {
    return readRecentContextTokens(readFileSync(transcriptPath, "utf8"));
  } catch {
    return [];
  }
}

/** @param {number} tokens */
const countReminderSteps = (tokens) =>
  tokens < REMINDER_TOKENS ? 0 : 1 + Math.floor((tokens - REMINDER_TOKENS) / REMINDER_STEP_TOKENS);

/**
 * Whether a push's arguments push only the branch checked out, to its own name on origin, with
 * no force: `git push [-u] [origin] [HEAD | <branch>]`.
 * @param {string[]} pushArguments
 * @param {string} branch the branch checked out, or "" when it couldn't be read
 */
function isOwnBranchPush(pushArguments, branch) {
  if (!branch || SHARED_BRANCHES.has(branch)) return false;
  const [remote = "origin", target = branch, ...rest] = pushArguments.filter(
    (word) => !PUSH_OPTIONS.has(word),
  );
  return remote === "origin" && (target === "HEAD" || target === branch) && rest.length === 0;
}

/**
 * The endpoint a `gh api` call names: its first word that's neither an option nor an option's value.
 * @param {string[]} words
 */
function findApiEndpoint(words) {
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === "--") return words[index + 1] ?? "";
    if (GH_API_VALUE_OPTIONS.has(words[index])) index += 1;
    else if (!words[index].startsWith("-")) return words[index];
  }
  return "";
}

/**
 * Separate gh's shorthand flags, stopping each cluster at its first value-taking flag.
 * @param {string[]} words
 * @returns {string[] | null}
 */
function expandApiOptions(words) {
  /** @type {string[]} */
  const expanded = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") return expanded.concat(words.slice(index));
    if (!word.startsWith("-") || word.startsWith("--") || word === "-") {
      expanded.push(word);
      if (GH_API_VALUE_OPTIONS.has(word)) expanded.push(words[++index] ?? "");
      continue;
    }
    for (let at = 1; at < word.length; at += 1) {
      const option = `-${word[at]}`;
      if (GH_API_VALUE_OPTIONS.has(option)) {
        const attached = word.slice(at + 1);
        const value = attached.length > 1 && attached[0] === "=" ? attached.slice(1) : attached;
        expanded.push(option, attached ? value : (words[++index] ?? ""));
        break;
      }
      if (option !== "-i" && option !== "-h") return null;
      expanded.push(option);
    }
  }
  return expanded;
}

/**
 * @param {string} word
 * @param {string} fullOption
 * @param {number} minimumLength
 */
function isOptionPrefix(word, fullOption, minimumLength) {
  const [option] = word.split("=");
  return option.length >= minimumLength && fullOption.startsWith(option);
}

/** @param {string[]} words */
function isHandoffFetch(words) {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") break;
    const [option] = word.split("=");
    if (isOptionPrefix(word, "--upload-pack", 5) || word.startsWith("-u")) return false;
    if (/^-[^-]/.test(word) && word.length > 2 && !/^-[oj]/.test(word)) return false;
    if (option === "--recurse-submodules") continue;
    const takesValue =
      word === "-o" ||
      word === "-j" ||
      (option.startsWith("--") && FETCH_VALUE_OPTIONS.some((name) => name.startsWith(option)));
    if (takesValue && !word.includes("=")) index += 1;
  }
  return true;
}

/**
 * Whether Git reads or commits without writing a read's output or starting a helper.
 * @param {string[]} words
 */
function isHandoffGitCommand(words) {
  const commandIndex = words[1] === "-C" ? 3 : 1;
  const command = words[commandIndex];
  if (!HANDOFF_GIT_COMMANDS.has(command)) return false;
  const hasDiffOptions = command === "diff" || command === "log" || command === "show";
  const argumentsAfterCommand = words.slice(commandIndex + 1);
  if (command === "fetch") return isHandoffFetch(argumentsAfterCommand);
  const endOfOptions = argumentsAfterCommand.indexOf("--");
  const options =
    endOfOptions < 0 ? argumentsAfterCommand : argumentsAfterCommand.slice(0, endOfOptions);
  const readArguments = command === "diff" ? argumentsAfterCommand : options;
  return !(
    (hasDiffOptions &&
      readArguments.some(
        (word) => /^--output(?:=|$)/.test(word) || isOptionPrefix(word, "--ext-diff", 5),
      )) ||
    (command === "diff" && options.some((word) => /^--no-index(?:=|$)/.test(word)))
  );
}

/**
 * Whether a `gh api` call only reads, or writes only the PR: its description, comments, replies,
 * and merge. A call that sends fields and names no method posts them.
 * @param {string[]} apiArguments
 */
function isHandoffApiCall(apiArguments) {
  const words = expandApiOptions(apiArguments);
  if (!words) return false;
  let method;
  let hasFields = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") break;
    if (word === "-X" || word === "--method") method = words[index + 1] ?? "";
    else if (word.startsWith("--method=")) method = word.slice("--method=".length);
    if (/^(?:-[fF]|--field|--raw-field|--input)/.test(word)) hasFields = true;
    if (GH_API_VALUE_OPTIONS.has(word)) index += 1;
  }
  const resolvedMethod = method?.toUpperCase() ?? (hasFields ? "POST" : "GET");
  return resolvedMethod === "GET" || PULL_REQUEST_ENDPOINT.test(findApiEndpoint(words));
}

/**
 * Whether a Bash command is one a handoff needs: reading the branch and the PR, committing,
 * pushing the branch checked out, and updating, answering, and merging the PR, each alone,
 * with nothing piped, redirected, or substituted into it.
 * @param {string} command
 * @param {string} branch
 */
function isHandoffCommand(command, branch) {
  const words = parseCommandWords(command);
  if (!words) return false;
  if (words[0] === "git" && words[1] === "push") return isOwnBranchPush(words.slice(2), branch);
  if (words[0] === "gh" && words[1] === "api") return isHandoffApiCall(words.slice(2));
  if (words[0] === "git") return isHandoffGitCommand(words);
  return HANDOFF_COMMANDS.some((pattern) => pattern.test(words.join(" ")));
}

/**
 * Whether a call is one a handoff needs.
 * @param {HookInput} input
 * @param {string} branch
 */
function isHandoffCall({ tool_name: toolName = "", tool_input: toolInput }, branch) {
  if (toolName === "Bash") return isHandoffCommand(String(toolInput?.command ?? ""), branch);
  return HANDOFF_TOOLS.has(toolName) || READ_ONLY_GITHUB_TOOL.test(toolName);
}

/**
 * The branch checked out in a folder, or "" when none is, as on a detached HEAD, or git can't say.
 * @param {string | undefined} folder
 */
function readCurrentBranch(folder) {
  try {
    return execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: folder,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
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
  "committing, pushing the branch you're on to its own name without force, " +
  "opening the PR or updating its description, replying on it and resolving its threads, " +
  "merging a PR whose check passed, reading its Deploy runs, and get_session. " +
  "Run each command alone, with literal arguments: no variables, glob or brace expansions, " +
  "leading ~, pipes, redirects, or command substitutions. " +
  "The literal {owner}/{repo} placeholders are allowed. " +
  "Use a quoted heredoc on stdin for a commit message or PR body, as git commit -F - <<'EOF' does. " +
  HANDOFF_STEPS;

/**
 * What the hook answers for an event, given the context of the transcript's last two replies,
 * or null to let it be. The reminder comes with each prompt, and between prompts only as a reply
 * passes another step, so it never fills the context it's there to keep small.
 * @param {HookInput} input
 * @param {number[]} recentTokens
 * @param {string} [branch] the branch checked out, which only a push past the stop needs
 */
export function decideHookOutput(input, [latest = 0, previous = 0], branch = "") {
  const event = input.hook_event_name;
  const isReminded =
    (event === "UserPromptSubmit" && latest >= REMINDER_TOKENS) ||
    (event === "PostToolUse" && countReminderSteps(latest) > countReminderSteps(previous));
  if (isReminded)
    return {
      hookSpecificOutput: { hookEventName: event, additionalContext: writeReminder(latest) },
    };
  if (event === "PreToolUse" && latest >= STOP_TOKENS && !isHandoffCall(input, branch))
    return {
      hookSpecificOutput: {
        hookEventName: event,
        permissionDecision: "deny",
        permissionDecisionReason: writeStopReason(latest),
      },
    };
  return null;
}

/** Reads the hook's input and the session's context, and writes what the hook answers, if anything. */
function answerHookInput() {
  try {
    /** @type {HookInput} */
    const input = JSON.parse(readFileSync(0, "utf8"));
    const recentTokens = readSessionTokens(input);
    const branch = recentTokens[0] >= STOP_TOKENS ? readCurrentBranch(input.cwd) : "";
    const output = decideHookOutput(input, recentTokens, branch);
    if (output) process.stdout.write(JSON.stringify(output));
  } catch {
    // The hook never stops a session or CI: any error lets the call through.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) answerHookInput();
