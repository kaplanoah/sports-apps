import test from "node:test";
import assert from "node:assert/strict";
import { readTextFiles } from "./repo-files.js";

// Tests and their fixtures hold the leagues' own words, accents and all.
const isTestFile = (/** @type {string} */ file) => /^(tests|apps\/[^/]+\/tests)\//.test(file);

const readCheckedFiles = () => readTextFiles().filter(({ path }) => !isTestFile(path));

/**
 * Each line of the file with a character outside plain ASCII, as file:line.
 * @param {string} file
 * @param {string} text
 */
const listNonAsciiLines = (file, text) =>
  text
    .split("\n")
    .flatMap((line, index) => (/[\u0080-\uffff]/.test(line) ? [`${file}:${index + 1}`] : []));

test("code, styles, pages, docs, and settings are plain ASCII, with no em dashes or curly quotes", () => {
  const files = readCheckedFiles();
  assert.ok(files.length > 100, `only ${files.length} files to check`);
  const lines = files.flatMap(({ path, text }) => listNonAsciiLines(path, text));
  assert.deepEqual(lines, []);
});

test("a line with an em dash or a curly quote is named by its file and line", () => {
  assert.deepEqual(listNonAsciiLines("a.js", "plain\nwith \u2014 dash\n\u201cquoted\u201d"), [
    "a.js:2",
    "a.js:3",
  ]);
});
