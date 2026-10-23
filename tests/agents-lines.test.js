import { test } from "node:test";
import assert from "node:assert/strict";
import { isRuleFile } from "../worker/rule-files.mjs";
import { countWords, isFence, isHeading, readProse, startsUnit } from "./guidance-text.js";
import { listTrackedFiles, readRepoFile, readSkillName } from "./repo-files.js";

const isGuidance = (/** @type {string} */ path) =>
  ["AGENTS.md", "REVIEW.md"].includes(path) || isRuleFile(path) || Boolean(readSkillName(path));
const GUIDANCE = listTrackedFiles().filter(isGuidance);
// Read truncates a line at 2,000 characters, so leave room for its line prefix.
const MOST_GUIDANCE_LINE_CHARACTERS = 1800;
// Claude Code reads AGENTS.md whole into every session, and follows less of a longer one.
const MOST_AGENTS_CHARACTERS = 16000;

// Past about this many words a reader loses a sentence's subject, so a long catalog is a list.
const MOST_SENTENCE_WORDS = 60;

// A sentence ends at a period, question mark, or exclamation mark, past any closing quote,
// parenthesis, or bold, but never at an ellipsis's dots. A bold label on a line of its own is a
// sentence.
const SENTENCE_END = String.raw`(?<!\.)[.?!]["')*]*`;
const ENDS_SENTENCE = new RegExp(`${SENTENCE_END}$`);
const AFTER_SENTENCE = new RegExp(`(?<=${SENTENCE_END})\\s+`);

/**
 * Each sentence of a text, as the line it starts on and its words. A sentence runs across lines
 * until it ends, or until a list item, a heading, a fence, or a blank line starts a new one, and
 * a heading is a line of its own.
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
    if (isFence(line)) return;
    for (const piece of readProse(line).split(AFTER_SENTENCE)) {
      const words = countWords(piece);
      if (words) {
        current ??= { line: index + 1, words: 0 };
        current.words += words;
      }
      if (ENDS_SENTENCE.test(piece.trim())) endSentence();
    }
    if (isHeading(line)) endSentence();
  });
  endSentence();
  return sentences;
}

test("the guidance files include AGENTS.md, REVIEW.md, the rule files, and the skills", () => {
  assert.ok(GUIDANCE.includes("AGENTS.md"));
  assert.ok(GUIDANCE.includes("REVIEW.md"));
  assert.ok(GUIDANCE.some(isRuleFile));
  assert.ok(GUIDANCE.some((path) => path.startsWith(".claude/skills/")));
});

test("AGENTS.md stays short enough for every session to follow", () => {
  const text = readRepoFile("AGENTS.md").trimEnd();
  assert.ok(text.length <= MOST_AGENTS_CHARACTERS, `AGENTS.md has ${text.length} characters`);
});

test("guidance lines fit within the agent's read limit", () => {
  const long = GUIDANCE.flatMap((path) =>
    readRepoFile(path)
      .split("\n")
      .flatMap((line, index) =>
        line.length > MOST_GUIDANCE_LINE_CHARACTERS
          ? [`${path}:${index + 1} (${line.length} characters)`]
          : [],
      ),
  );
  assert.deepEqual(long, []);
});

test(`a sentence in a guidance file is ${MOST_SENTENCE_WORDS} words or fewer`, () => {
  const long = GUIDANCE.flatMap((path) =>
    listSentences(readRepoFile(path))
      .filter(({ words }) => words > MOST_SENTENCE_WORDS)
      .map(({ line, words }) => `${path}:${line} (${words} words)`),
  );
  assert.deepEqual(long, []);
});

test("a heading, a blank line, a list item of any mark, or a fence starts a new sentence", () => {
  const text =
    "one two\n## Head\nthree\n\nfour\n  - five\n* six\n1. seven\n  ## deep\n  ---\n---\neight";
  assert.deepEqual(listSentences(text), [
    { line: 1, words: 2 },
    { line: 2, words: 1 },
    { line: 3, words: 1 },
    { line: 5, words: 1 },
    { line: 6, words: 1 },
    { line: 7, words: 1 },
    { line: 8, words: 4 },
    { line: 12, words: 1 },
  ]);
});

test("a sentence ends at any stop past a closing mark, but not after a bold label that leads its sentence, inside a code span, or at an ellipsis", () => {
  const text = [
    "Is it? Yes! Done (really.)",
    "Run `a. b` now. Wait... then",
    "go on.",
    '**Bugs.** Look at **this.** Then "here."',
    "Say 'yes.'",
    "Then stop.",
    "1. **Label.**  ",
    "   one two.",
  ].join("\n");
  assert.deepEqual(listSentences(text), [
    { line: 1, words: 2 },
    { line: 1, words: 1 },
    { line: 1, words: 2 },
    { line: 2, words: 3 },
    { line: 2, words: 4 },
    { line: 4, words: 4 },
    { line: 4, words: 2 },
    { line: 5, words: 2 },
    { line: 6, words: 2 },
    { line: 7, words: 1 },
    { line: 8, words: 2 },
  ]);
});
