// Blocks a Bash call that starts with cd or runs more than one command, as the Workflow section of
// AGENTS.md asks, so a session never asks the owner to approve a call it could have made alone.
// A pipe is one command: it hands one program's output to the next.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RULE =
  'AGENTS.md, under "Workflow": "Run each command so it needs no approval: one command per call, ' +
  "from the repo's root ... Never start with `cd`.\" Run each command in a call of its own, from the " +
  "repo's root, with paths relative to it.";

const SUBSTITUTION = "a command substitution";

/**
 * The delimiter a heredoc opened at `at` ends with, where its operator ends, and whether the
 * delimiter is quoted, which keeps the shell from running what its body holds, or null when `<<`
 * there isn't a heredoc.
 * @param {string} command
 * @param {number} at the index of `<<`
 */
function readHeredoc(command, at) {
  const match = /^<<-?[ \t]*(['"]?)([\w.-]+)\1(?=[ \t\n;&|<>]|$)/.exec(command.slice(at));
  if (!match || command[at + 2] === "<") return null;
  return {
    delimiter: match[2],
    end: at + match[0].length,
    isQuoted: match[1] !== "",
    stripsTabs: command[at + 2] === "-",
  };
}

/**
 * Whether text the shell expands holds a command substitution, `$(...)` or backticks.
 * @param {string} text
 */
const holdsSubstitution = (text) => /\$\(|`/.test(text);

/**
 * Whether a command substitution starts at `at`.
 * @param {string} text
 * @param {number} at
 */
const isSubstitutionAt = (text, at) => text.startsWith("$(", at) || text[at] === "`";

/**
 * The index just past a heredoc's body, which starts on the line after `from`.
 * @param {string} command
 * @param {number} from
 * @param {string} delimiter
 * @param {boolean} stripsTabs
 */
function skipHeredocBody(command, from, delimiter, stripsTabs) {
  let lineStart = command.indexOf("\n", from) + 1;
  if (lineStart === 0) return command.length;
  while (lineStart < command.length) {
    const lineEnd = command.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? command.length : lineEnd;
    const line = command.slice(lineStart, end);
    if ((stripsTabs ? line.replace(/^\t+/, "") : line) === delimiter) return end;
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
const SHELL_BEFORE_SCRIPT = /(?:^|[ \t\n(|/])(?:ba|z|da)?sh[ \t]+(?:-[\w-]+[ \t]+)*-\w*c\w*[ \t]+$/;

/**
 * The first operator outside quotes, heredocs, and substitutions that starts another command: `&&`,
 * `||`, `;`, a lone `&`, or a line break, or null when the command is one, and each quoted
 * script the command hands a shell before it. Text inside other quotes or a heredoc's body,
 * like a commit message, runs nothing. Also the first pipe, redirect, or command substitution
 * before that operator, which the shell runs inside double quotes and an unquoted heredoc too.
 * @param {string} command
 * @returns {{ separator: string | null, scripts: string[], pipeOrRedirect: string | null, words: string[] | null }}
 */
function scanCommand(command) {
  let quote = "";
  let scriptStart = -1;
  /** @type {("substitution" | "group")[]} */
  const parentheses = [];
  let isInBackticks = false;
  let hasSubstitutionWord = false;
  /** @type {string | null} */
  let pipeOrRedirect = null;
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const words = [];
  /** @type {NonNullable<ReturnType<typeof readHeredoc>>[]} */
  const heredocs = [];
  let word = "";
  let hasWord = false;
  let hasExpansion = false;
  function finishWord() {
    if (hasWord) words.push(word);
    word = "";
    hasWord = false;
  }
  const text = command.replace(/^[ \t\n]+|[ \t\n]+$/g, "");
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    const hasCurrentWord = parentheses.length > 0 ? hasSubstitutionWord : hasWord;
    if (!quote && !isInBackticks && char === "#" && !hasCurrentWord) {
      const lineEnd = text.indexOf("\n", at);
      at = lineEnd === -1 ? text.length : lineEnd - 1;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      const next = text[at + 1];
      if (next === undefined) hasExpansion = true;
      else if (!quote || /[$`"\\\n]/.test(next)) {
        if (next !== "\n") {
          word += next;
          hasWord = true;
          if (parentheses.length > 0) hasSubstitutionWord = true;
        }
        at += 1;
        continue;
      }
    }
    if (char === "`" && quote !== "'") {
      pipeOrRedirect ??= SUBSTITUTION;
      isInBackticks = !isInBackticks;
      hasWord = true;
      if (parentheses.length > 0) hasSubstitutionWord = true;
      continue;
    }
    if (isInBackticks) continue;
    if (quote) {
      if (char === quote) {
        if (scriptStart !== -1) scripts.push(text.slice(scriptStart, at));
        quote = "";
      } else {
        word += char;
        if (quote === '"' && char === "$") hasExpansion = true;
        if (quote === '"' && isSubstitutionAt(text, at)) pipeOrRedirect ??= SUBSTITUTION;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasWord = true;
      if (parentheses.length > 0) hasSubstitutionWord = true;
      scriptStart = SHELL_BEFORE_SCRIPT.test(text.slice(0, at)) ? at + 1 : -1;
      continue;
    }
    if (char === "$") hasExpansion = true;
    if (char === "$" && text[at + 1] === "(") {
      pipeOrRedirect ??= SUBSTITUTION;
      parentheses.push("substitution");
      hasSubstitutionWord = false;
      at += 1;
      continue;
    }
    if (parentheses.length > 0) {
      if (char === "(") {
        parentheses.push("group");
        hasSubstitutionWord = false;
      } else if (char === ")") {
        hasSubstitutionWord = parentheses.pop() === "substitution";
      } else hasSubstitutionWord = !/[ \t\n;&|<>]/.test(char);
      if (parentheses.length === 0) hasWord = true;
      continue;
    }
    const heredoc = text.startsWith("<<", at) ? readHeredoc(text, at) : null;
    if (heredoc) {
      if (/^\d+$/.test(word)) {
        word = "";
        hasWord = false;
      } else finishWord();
      heredocs.push(heredoc);
      at = heredoc.end - 1;
      continue;
    }
    if (char === "\n" && heredocs.length) {
      finishWord();
      let bodyEnd = at;
      for (const pending of heredocs) {
        const bodyStart = bodyEnd + 1;
        bodyEnd = skipHeredocBody(text, bodyEnd, pending.delimiter, pending.stripsTabs);
        if (!pending.isQuoted) {
          const body = text.slice(bodyStart, bodyEnd);
          if (holdsSubstitution(body)) pipeOrRedirect ??= SUBSTITUTION;
          if (/[$`]/.test(body)) hasExpansion = true;
        }
      }
      heredocs.length = 0;
      at = bodyEnd - 1;
      continue;
    }
    const separator = readSeparatorAt(text, at);
    if (separator) return { separator, scripts, pipeOrRedirect, words: null };
    pipeOrRedirect ??= readPipeOrRedirectAt(text, at);
    if (char === " " || char === "\t") finishWord();
    else {
      if (char === "{") {
        const placeholder = /^\{(?:owner|repo)\}/.exec(text.slice(at));
        if (!placeholder) hasExpansion = true;
      }
      if (/[?*[\]()]/.test(char) || (char === "~" && !hasWord)) hasExpansion = true;
      word += char;
      hasWord = true;
    }
  }
  finishWord();
  return {
    separator: null,
    scripts,
    pipeOrRedirect,
    words: quote || hasExpansion || pipeOrRedirect || heredocs.length ? null : words,
  };
}

/**
 * The pipe, redirect, or command substitution that starts at `at`, outside quotes, or null.
 * @param {string} text
 * @param {number} at
 */
function readPipeOrRedirectAt(text, at) {
  if (text[at] === "|") return "a pipe";
  if (text[at] === ">" || text[at] === "<") return "a redirect";
  return isSubstitutionAt(text, at) ? SUBSTITUTION : null;
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
 * Literal arguments of one command, or null for operators, unfinished quotes, or unsupported
 * expansions. Only the inert {owner}/{repo} placeholders are accepted as unquoted braces.
 * @param {string} command
 */
export const parseCommandWords = (command) => scanCommand(command).words;

/**
 * Why a Bash command breaks the rule, or null when it keeps it.
 * @param {string} command
 */
export function findCommandProblem(command) {
  if (/^[ \t\n(]*cd([ \t\n]|\)|$)/.test(command)) return `It starts with cd. ${RULE}`;
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
