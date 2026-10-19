import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listAppStylesheets,
  listPageFiles,
  listRootTokens,
  listSharedStylesheets,
  listStrayCorners,
  readPageFile,
} from "./css-rules.js";

// What the shared stylesheets ask every app's :root for, so each app sets its own shapes, its
// buttons' size, how a pill shows the list that's chosen, and how a wide screen's tabs show the
// open one.
const APP_TOKENS = [
  "--radius-card",
  "--radius-chip",
  "--radius-control",
  "--radius-tabs",
  "--radius-sheet",
  "--control-height",
  "--control-room",
  "--held-bar-line",
  "--pager-label",
  "--pager-chosen-edge",
  "--tabs-track",
  "--tabs-track-edge",
  "--tabs-chosen",
  "--tabs-chosen-edge",
  "--tabs-chosen-ink",
];

test("every corner the shared stylesheets draw comes from an app's shape tokens", () => {
  for (const path of listSharedStylesheets()) assert.deepEqual(listStrayCorners(path), [], path);
});

test("every corner each app's own styles draw comes from its shape tokens", () => {
  for (const path of listAppStylesheets()) assert.deepEqual(listStrayCorners(path), [], path);
});

// MLB's seed lock is an icon drawn for its place, so its corners are its own.
const OWN_SHAPED_FILES = new Map([["apps/mlb/page/js/games-view.js", 1]]);

// An SVG shape's rx or ry, in markup with either quote or set by a script.
const TYPED_CORNER = /\br[xy]\s*=\s*["']|setAttribute\(\s*["']r[xy]["']/g;

/**
 * How many corners each page file types into what it draws, as an SVG shape's rx or ry.
 * @returns {Map<string, number>}
 */
function countTypedCorners() {
  const counts = new Map();
  for (const path of listPageFiles()) {
    const corners = readPageFile(path).match(TYPED_CORNER) ?? [];
    if (corners.length) counts.set(path, corners.length);
  }
  return counts;
}

test("no page file types a corner into an SVG shape, which takes it from the shape tokens in CSS", () => {
  assert.deepEqual(countTypedCorners(), OWN_SHAPED_FILES);
});

test("a stylesheet's SVG corner counts as stray unless it comes from a shape token", () => {
  const folder = mkdtempSync(join(tmpdir(), "shape-tokens-"));
  const path = join(folder, "styles.css");
  writeFileSync(path, ".typed { rx: 4px; }\n.token { rx: var(--radius-card); }\n");
  try {
    assert.deepEqual(listStrayCorners(path), [".typed { rx: 4px }"]);
  } finally {
    rmSync(folder, { recursive: true });
  }
});

test("every app's styles set each shape, button size, and pill and tab color the shared stylesheets ask for", () => {
  for (const path of listAppStylesheets()) {
    const tokens = listRootTokens(path);
    assert.deepEqual(
      APP_TOKENS.filter((token) => !tokens.has(token)),
      [],
      path,
    );
  }
});
