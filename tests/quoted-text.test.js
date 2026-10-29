import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listPageSources } from "./page-sources.js";
import { REPO_ROOT } from "./repo-files.js";

// The elements that hold an outlet's own words, by class, which keep the outlet's punctuation. The
// page's own copy never does, so the stray-periods check reads all of it.
const OUTLET_TEXT = new Set([
  // A news story's headline and summary, from its outlet's feed.
  "news-title",
  "news-more-title",
  "news-summary",
  // A story's headline in search.
  "search-words",
  // A final's recap and clips, and its story's headline and first lines, from ESPN.
  "clip-title",
  "clip-blurb",
  "highlights-story-title",
  "highlights-story-lead",
  // RotoWire's sentence on why a player is out, from ESPN's injury report.
  "out-sentence",
]);

/**
 * Each element a page module marks `data-quoted`, as its path and the element's class.
 * @param {string} path
 */
function listQuotedElements(path) {
  const source = readFileSync(new URL(path, REPO_ROOT), "utf8");
  return [...source.matchAll(/data-quoted/g)].map(({ index }) => {
    const tag = source.slice(source.lastIndexOf("<", index), index);
    return { path, className: tag.match(/class="([^"]*)"/)?.[1] ?? "" };
  });
}

test("only elements holding an outlet's own words are marked data-quoted", () => {
  const quoted = listPageSources([".js", ".html"]).flatMap(listQuotedElements);
  assert.deepEqual(
    quoted
      .filter(({ className }) => !OUTLET_TEXT.has(className))
      .map(({ path, className }) => `${path}: ${className || "an element with no class"}`),
    [],
  );
  assert.deepEqual(
    [...OUTLET_TEXT].filter((name) => !quoted.some(({ className }) => className === name)),
    [],
  );
});
