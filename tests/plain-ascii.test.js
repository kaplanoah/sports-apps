import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listTrackedFiles } from "./tracked-files.js";

const ROOT = new URL("../", import.meta.url);

// Tests and their fixtures hold the leagues' own words, accents and all.
const isTestFile = (/** @type {string} */ file) => /^(tests|apps\/[^/]+\/tests)\//.test(file);

// Git's own test for a binary file, like a font or an image: a NUL byte in its first 8000.
const isBinary = (/** @type {Buffer} */ bytes) => bytes.subarray(0, 8000).includes(0);

const listCheckedFiles = () => listTrackedFiles().filter((file) => !isTestFile(file));

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
  const files = listCheckedFiles();
  assert.ok(files.length > 100, `only ${files.length} files to check`);
  const lines = files.flatMap((file) => {
    const bytes = readFileSync(new URL(file, ROOT));
    return isBinary(bytes) ? [] : listNonAsciiLines(file, bytes.toString("utf8"));
  });
  assert.deepEqual(lines, []);
});

test("a line with an em dash or a curly quote is named by its file and line", () => {
  assert.deepEqual(listNonAsciiLines("a.js", "plain\nwith \u2014 dash\n\u201cquoted\u201d"), [
    "a.js:2",
    "a.js:3",
  ]);
});
