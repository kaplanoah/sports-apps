// Blocks a Bash call that starts with cd or runs more than one command, as the Workflow section of
// AGENTS.md asks, so a session never asks the owner to approve a call it could have made alone.
// A pipe is one command: it hands one program's output to the next.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RULE =
  'AGENTS.md, under "Workflow": "Run each command so it needs no approval: one command per call, ' +
  "from the repo's root ... Never start with `cd`.\" Run each command in a call of its own, from the " +
  "repo's root, with paths relative to it.";

/**
 * The delimiter a heredoc opened at `at` ends with, and where its operator ends, or null when `<<`
 * there isn't a heredoc.
 * @param {string} command
 * @param {number} at the index of `<<`
 */
function readHeredoc(command, at) {
  const match = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(command.slice(at));
  if (!match || command[at + 2] === "<") return null;
  return { delimiter: match[2], end: at + match[0].length };
}

/**
 * The index just past a heredoc's body, which starts on the line after `from`.
 * @param {string} command
 * @param {number} from
 * @param {string} delimiter
 */
function skipHeredocBody(command, from, delimiter) {
  let lineStart = command.indexOf("\n", from) + 1;
  if (lineStart === 0) return command.length;
  while (lineStart < command.length) {
    const lineEnd = command.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? command.length : lineEnd;
    if (command.slice(lineStart, end).trim() === delimiter) return end;
    lineStart = end + 1;
  }
  return command.length;
}

/**
 * Whether a lone `&` at `at` runs what's before it in the background, rather than redirecting, as
 * `2>&1` and `&>` do, or piping, as `|&` does.
 * @param {string} text
 * @param {number} at
 */
const isBackgroundAmpersand = (text, at) =>
  text[at] === "&" && !/[<>|]/.test(text[at - 1] ?? "") && text[at + 1] !== ">";

// A shell handed its commands as one quoted string, as `bash -c "a; b"` is, still runs each.
const SHELL_BEFORE_SCRIPT = /(?:^|[\s(|])(?:ba|z|da)?sh\s+(?:-[\w-]+\s+)*-\w*c\w*\s+$/;

/**
 * The first operator outside quotes, heredocs, and `$(...)` that starts another command: `&&`,
 * `||`, `;`, a lone `&`, or a line break, or null when the command is one, and each quoted
 * script the command hands a shell before it. Text inside other quotes or a heredoc's body,
 * like a commit message, runs nothing.
 * @param {string} command
 * @returns {{ separator: string | null, scripts: string[] }}
 */
function scanCommand(command) {
  let quote = "";
  let scriptStart = -1;
  let depth = 0;
  /** @type {string[]} */
  const scripts = [];
  const text = command.trim();
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote) {
      if (char === "\\" && quote === '"') at += 1;
      else if (char === quote) {
        if (scriptStart !== -1) scripts.push(text.slice(scriptStart, at));
        quote = "";
      }
      continue;
    }
    if (char === "\\") {
      at += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      scriptStart = SHELL_BEFORE_SCRIPT.test(text.slice(0, at)) ? at + 1 : -1;
      continue;
    }
    if (char === "$" && text[at + 1] === "(") {
      depth += 1;
      at += 1;
      continue;
    }
    if (depth > 0) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      continue;
    }
    const heredoc = text.startsWith("<<", at) ? readHeredoc(text, at) : null;
    if (heredoc) {
      at = skipHeredocBody(text, heredoc.end, heredoc.delimiter) - 1;
      continue;
    }
    const separator = readSeparatorAt(text, at);
    if (separator) return { separator, scripts };
  }
  return { separator: null, scripts };
}

/**
 * The operator that starts at `at` and starts another command, or null.
 * @param {string} text
 * @param {number} at
 */
function readSeparatorAt(text, at) {
  const pair = text.slice(at, at + 2);
  if (pair === "&&" || pair === "||") return pair;
  if (text[at] === ";") return ";";
  if (text[at] === "\n") return "a line break";
  return isBackgroundAmpersand(text, at) ? "&" : null;
}

/**
 * The first separator a command or any script it hands a shell holds, or null when it's one.
 * @param {string} command
 * @returns {string | null}
 */
export function findSeparator(command) {
  const { separator, scripts } = scanCommand(command);
  return separator ?? scripts.map(findSeparator).find(Boolean) ?? null;
}

/**
 * Why a Bash command breaks the rule, or null when it keeps it.
 * @param {string} command
 */
export function findCommandProblem(command) {
  if (/^[\s(]*cd(\s|\)|$)/.test(command)) return `It starts with cd. ${RULE}`;
  const separator = findSeparator(command);
  return separator ? `It joins commands with ${separator}. ${RULE}` : null;
}

/** Reads the hook's input and blocks the call, with exit code 2 and the reason, when it breaks the rule. */
function checkHookInput() {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const problem = findCommandProblem(String(input.tool_input?.command ?? ""));
  if (!problem) return;
  process.stderr.write(`${problem}\n`);
  process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) checkHookInput();
