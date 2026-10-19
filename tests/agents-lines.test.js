import { test } from "node:test";
import assert from "node:assert/strict";
import { isRuleFile } from "../worker/rule-files.mjs";
import { listTrackedFiles, readRepoFile, readSkillName } from "./tracked-files.js";

// Two changes to a guidance file conflict only when they touch the same or neighboring lines, so
// each sentence starts a line of its own and a long one breaks after its commas.
const isGuidance = (/** @type {string} */ path) =>
  ["AGENTS.md", "REVIEW.md"].includes(path) || isRuleFile(path) || Boolean(readSkillName(path));
const GUIDANCE = listTrackedFiles().filter(isGuidance);
const LONGEST_LINE = 240;
// Claude Code reads AGENTS.md whole into every session, and follows less of a longer one.
const MOST_AGENTS_LINES = 200;

const readProse = (line) => line.replace(/^\s*\d+\. /, "").replaceAll(/`[^`]*`/g, "``");

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
