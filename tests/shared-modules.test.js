import test from "node:test";
import assert from "node:assert/strict";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

// The map says where each shared file is and what it's for, and its top comment how it works, so
// the map names every file and nothing more about any.
const MAP = ".claude/rules/shared-modules.md";
const SHARED_FOLDERS = ["shared/page/", "shared/worker/"];
const MOST_ITEM_LINES = 2;
const MOST_ITEM_WORDS = 20;

const FOLDER_HEADING = /^## `(shared\/[^`]+\/)`/;
const CODE_SPAN = /`([^`]+)`/g;
// A file's name, or a folder's with its slash, as against a function or a token.
const FILE_NAME = /^[\w-]+(?:\.\w+|\/)$/;
const LIST_ITEM = /^\s*-\s/;
const ENDS_ITEM = /^\s*$|^#/;

/** @param {string} text */
const listCodeSpans = (text) => [...text.matchAll(CODE_SPAN)].map((match) => match[1]);

/**
 * The names the map gives in each shared folder's section, by folder.
 * @param {string} map
 */
function readNamesByFolder(map) {
  /** @type {Map<string, Set<string>>} */
  const names = new Map();
  /** @type {Set<string> | null} */
  let section = null;
  for (const line of map.split("\n")) {
    const folder = line.match(FOLDER_HEADING)?.[1];
    if (folder) {
      section = new Set();
      names.set(folder, section);
    } else if (section) {
      for (const span of listCodeSpans(line)) if (FILE_NAME.test(span)) section.add(span);
    }
  }
  return names;
}

/**
 * The name the map gives a shared file: its own, or its folder's for a file in a folder of its
 * folder, like `networks/`.
 * @param {string} folder
 * @param {string} path
 */
const nameInMap = (folder, path) => {
  const [first, ...rest] = path.slice(folder.length).split("/");
  return rest.length ? `${first}/` : first;
};

/**
 * Each list item of a text, its lines joined.
 * @param {string} text
 */
function listItems(text) {
  /** @type {string[][]} */
  const items = [];
  for (const line of text.split("\n")) {
    if (LIST_ITEM.test(line)) items.push([line]);
    else if (ENDS_ITEM.test(line) || line === "---") items.push([]);
    else items.at(-1)?.push(line);
  }
  return items.filter((lines) => lines.length);
}

/** @param {string} line */
const countWords = (line) =>
  line.replace(LIST_ITEM, "").replaceAll(CODE_SPAN, "Code").split(/\s+/).filter(Boolean).length;

const map = readRepoFile(MAP);
const trackedFiles = listTrackedFiles();
const namesByFolder = readNamesByFolder(map);

test("the map has a section for each shared folder", () => {
  assert.deepEqual([...namesByFolder.keys()], SHARED_FOLDERS);
});

test("the map names every shared file in its folder's section", () => {
  const unnamed = SHARED_FOLDERS.flatMap((folder) =>
    trackedFiles.filter(
      (path) => path.startsWith(folder) && !namesByFolder.get(folder)?.has(nameInMap(folder, path)),
    ),
  );
  assert.deepEqual(unnamed, []);
});

test("every file the map names is in the repo", () => {
  const isTracked = (/** @type {string} */ path) =>
    trackedFiles.some((file) => (path.endsWith("/") ? file.startsWith(path) : file === path));
  const named = [
    ...[...namesByFolder].flatMap(([folder, names]) =>
      [...names].map((name) => `${folder}${name}`),
    ),
    ...listCodeSpans(map).filter((span) => span.startsWith("shared/")),
  ];
  assert.deepEqual(
    named.filter((path) => !isTracked(path)),
    [],
  );
});

test(`each of the map's items is ${MOST_ITEM_LINES} lines and ${MOST_ITEM_WORDS} words or fewer`, () => {
  const long = listItems(map)
    .filter(
      (lines) =>
        lines.length > MOST_ITEM_LINES ||
        lines.reduce((words, line) => words + countWords(line), 0) > MOST_ITEM_WORDS,
    )
    .map((lines) => lines[0]);
  assert.deepEqual(long, []);
});
