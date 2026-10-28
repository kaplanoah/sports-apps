import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChangedTests } from "../worker/node-tests.mjs";

const FILES = new Map([
  ["tests/imports.test.js", 'import { readDay } from "../shared/page/day.js";'],
  ["tests/names.test.js", 'const text = readRepoFile(".agents/skills/ship/SKILL.md");'],
  ["tests/unrelated.test.js", 'import { readScore } from "../shared/page/score.js";'],
  ["tests/agents-lines.test.js", 'const text = readRepoFile("AGENTS.md");'],
  ["shared/page/day.js", 'import { readHour } from "./hour.js";'],
  ["shared/page/hour.js", "export const readHour = () => 0;"],
  ["shared/page/score.js", "export const readScore = () => 0;"],
]);
const TESTS = [
  "tests/agents-lines.test.js",
  "tests/imports.test.js",
  "tests/names.test.js",
  "tests/unrelated.test.js",
];

/** @param {string} path */
const readText = (path) => FILES.get(path) ?? null;

/** @param {string[]} changes */
const select = (changes) => selectChangedTests(changes, TESTS, readText);

test("a change selects each test that imports it, however deep", () => {
  assert.deepEqual(select(["shared/page/hour.js"]), [
    "tests/agents-lines.test.js",
    "tests/imports.test.js",
  ]);
});

test("a change selects each test that names its path", () => {
  assert.deepEqual(select([".agents/skills/ship/SKILL.md"]), [
    "tests/agents-lines.test.js",
    "tests/names.test.js",
  ]);
});

test("a changed test selects itself", () => {
  assert.deepEqual(select(["tests/unrelated.test.js"]), [
    "tests/agents-lines.test.js",
    "tests/unrelated.test.js",
  ]);
});

test("the tests that list the repo's files run for any change, and no others for an unreached one", () => {
  assert.deepEqual(select(["README.md"]), ["tests/agents-lines.test.js"]);
});
