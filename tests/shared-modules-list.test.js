import test from "node:test";
import assert from "node:assert/strict";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

const LIST_PATH = ".claude/rules/shared-modules.md";
const MOST_ITEM_LINES = 2;
const MOST_ITEM_WORDS = 20;

const CODE_SPAN = /`[^`]+`/g;
const LIST_ITEM = /^\s*-\s/;
const ENDS_ITEM = /^\s*$|^#|^---$/;

/** @param {string} text */
function readListedModules(text) {
  const listed = new Set();
  let folder = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^## `(shared\/[^`]+\/)`$/);
    if (heading) folder = heading[1];
    else if (/^## /.test(line)) folder = null;
    const item = line.match(/^- `([\w.-]+\.(?:js|css))`:/);
    if (folder && item) listed.add(folder + item[1]);
  }
  return listed;
}

/**
 * Each list item of a text, as its lines.
 * @param {string} text
 */
function listItems(text) {
  /** @type {string[][]} */
  const items = [];
  /** @type {string[] | null} */
  let item = null;
  for (const line of text.split("\n")) {
    if (LIST_ITEM.test(line)) {
      item = [line];
      items.push(item);
    } else if (ENDS_ITEM.test(line)) item = null;
    else item?.push(line);
  }
  return items;
}

/**
 * The words of an item's lines, each code span counting as one.
 * @param {string[]} lines
 */
const countWords = (lines) =>
  lines
    .join(" ")
    .replace(LIST_ITEM, "")
    .replaceAll(CODE_SPAN, "code")
    .split(/\s+/)
    .filter(Boolean).length;

/** @param {string[]} lines */
const isLong = (lines) => lines.length > MOST_ITEM_LINES || countWords(lines) > MOST_ITEM_WORDS;

const listText = readRepoFile(LIST_PATH);
const listed = readListedModules(listText);
const modules = listTrackedFiles().filter(
  (path) => /^shared\/.+\.(?:js|css)$/.test(path) && !path.startsWith("shared/page/networks/"),
);

// A session reuses a shared module only if the list it reads names it.
test("the shared modules' list names every shared module", () => {
  assert.deepEqual(
    modules.filter((path) => !listed.has(path)),
    [],
  );
});

test("the shared modules' list names no module that's gone", () => {
  assert.deepEqual(
    [...listed].filter((path) => !modules.includes(path)),
    [],
  );
});

// How a module works belongs in its top comment, so its item stays short enough to scan.
test(`each of the list's items is ${MOST_ITEM_LINES} lines and ${MOST_ITEM_WORDS} words or fewer`, () => {
  assert.deepEqual(
    listItems(listText)
      .filter(isLong)
      .map((lines) => lines[0]),
    [],
  );
});

test("an item's words count each code span as one, across its lines", () => {
  const items = listItems(
    [
      "- `a.js`: one `two three` four",
      "  five",
      "",
      "A paragraph between lists",
      "- `b.js`: one",
      "## Heading",
      "- `c.js`: one",
      "  two",
      "  three",
    ].join("\n"),
  );
  assert.deepEqual(items.map(countWords), [5, 2, 4]);
  assert.deepEqual(items.map(isLong), [false, false, true]);
});

test("a module is listed by the item it starts, under the heading of its folder", () => {
  const text = [
    "- `before.js`: before any folder",
    "## `shared/page/`",
    "- `a.js`: one",
    "- `b.css`: what `c.js` decides",
    "## `shared/worker/`",
    "- `a.js`: two",
    "## Other",
    "- `after.js`: past the folders",
  ].join("\n");
  assert.deepEqual(
    [...readListedModules(text)],
    ["shared/page/a.js", "shared/page/b.css", "shared/worker/a.js"],
  );
});
