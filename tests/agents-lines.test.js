import { test } from "node:test";
import assert from "node:assert/strict";
import { isRuleFile } from "../worker/rule-files.mjs";
import { listTrackedFiles, readRepoFile, readSkillName } from "./repo-files.js";

// Two changes to a guidance file conflict only when they touch the same or neighboring lines, so
// each sentence starts a line of its own and a long one breaks after its commas.
const isGuidance = (/** @type {string} */ path) =>
  ["AGENTS.md", "REVIEW.md"].includes(path) || isRuleFile(path) || Boolean(readSkillName(path));
const GUIDANCE = listTrackedFiles().filter(isGuidance);
const LONGEST_LINE = 240;
// Claude Code reads AGENTS.md whole into every session, and follows less of a longer one.
const MOST_AGENTS_LINES = 200;

// Past about this many words a reader loses a sentence's subject, so a long catalog is a list.
const MOST_SENTENCE_WORDS = 60;

const readProse = (line) => line.replace(/^\s*\d+\. /, "").replaceAll(/`[^`]*`/g, "``");

const startsUnit = (/** @type {string} */ line) =>
  /^\s*(?:---|#|$)/.test(line) || /^\s*(?:[-*]|\d+\.)\s/.test(line);

// A sentence ends at a period, question mark, or exclamation mark, past any closing quote,
// parenthesis, or bold, but never at an ellipsis's dots.
const SENTENCE_END = /(?<!\.)[.?!]["')*]*$/;
const SENTENCE_BREAK = /(?<=(?<!\.)[.?!]["')*]*)\s+/;

/**
 * A line's prose, without its list or heading mark, and with each code span as one word.
 * @param {string} line
 */
const readSentenceProse = (line) =>
  line.replace(/^\s*(?:[-*]|\d+\.|#+)\s+/, "").replaceAll(/`[^`]*`/g, "code");

/** @param {string} piece */
const countWords = (piece) => piece.split(/\s+/).filter(Boolean).length;

/**
 * Each sentence of a text, as the line it starts on and its words. A sentence runs across lines
 * until it ends, or until a list item, a heading, or a blank line starts a new one.
 * @param {string} text
 */
function listSentences(text) {
  /** @type {{ line: number, words: number }[]} */
  const sentences = [];
  /** @type {{ line: number, words: number } | null} */
  let current = null;
  const endSentence = () => {
    if (current) sentences.push(current);
    current = null;
  };
  text.split("\n").forEach((line, index) => {
    if (startsUnit(line)) endSentence();
    for (const piece of readSentenceProse(line).split(SENTENCE_BREAK)) {
      const words = countWords(piece);
      if (words) {
        current ??= { line: index + 1, words: 0 };
        current.words += words;
      }
      if (SENTENCE_END.test(piece.trim())) endSentence();
    }
  });
  endSentence();
  return sentences;
}

/**
 * Each line of every guidance file that breaks a rule, as file:line.
 * @param {(line: string) => boolean} isBroken
 */
const listBrokenLines = (isBroken) =>
  GUIDANCE.flatMap((path) =>
    readRepoFile(path)
      .split("\n")
      .flatMap((line, index) => (isBroken(line) ? [`${path}:${index + 1}`] : [])),
  );

test("the guidance files include AGENTS.md, REVIEW.md, the rule files, and the skills", () => {
  assert.ok(GUIDANCE.includes("AGENTS.md"));
  assert.ok(GUIDANCE.includes("REVIEW.md"));
  assert.ok(GUIDANCE.some(isRuleFile));
  assert.ok(GUIDANCE.some((path) => path.startsWith(".claude/skills/")));
});

test("each line of a guidance file starts at most one sentence", () => {
  assert.deepEqual(
    listBrokenLines((line) => /[.?!] [A-Z]/.test(readProse(line))),
    [],
  );
});

test("AGENTS.md stays short enough for every session to follow", () => {
  const lines = readRepoFile("AGENTS.md").trimEnd().split("\n");
  assert.ok(lines.length <= MOST_AGENTS_LINES, `AGENTS.md has ${lines.length} lines`);
});

test("a long sentence in a guidance file breaks after its commas", () => {
  assert.deepEqual(
    listBrokenLines((line) => line.length > LONGEST_LINE),
    [],
  );
});

test(`a sentence in a guidance file is ${MOST_SENTENCE_WORDS} words or fewer`, () => {
  const long = GUIDANCE.flatMap((path) =>
    listSentences(readRepoFile(path))
      .filter(({ words }) => words > MOST_SENTENCE_WORDS)
      .map(({ line, words }) => `${path}:${line} (${words} words)`),
  );
  assert.deepEqual(long, []);
});

test("a sentence runs across lines to its period, and a list item or heading starts the next", () => {
  const text = "# Title\n\n- One two\n  three `a b c` four.\n  Five six.\n- Seven\n  eight";
  assert.deepEqual(listSentences(text), [
    { line: 1, words: 1 },
    { line: 3, words: 5 },
    { line: 5, words: 2 },
    { line: 6, words: 2 },
  ]);
});

test("a sentence ends past a closing quote or bold, but not inside a code span or at an ellipsis", () => {
  const text = 'Run `a. b` now.\nWait... then go.\n1. **Bugs.** Look "here." Then stop.';
  assert.deepEqual(listSentences(text), [
    { line: 1, words: 3 },
    { line: 2, words: 3 },
    { line: 3, words: 1 },
    { line: 3, words: 2 },
    { line: 3, words: 2 },
  ]);
});
