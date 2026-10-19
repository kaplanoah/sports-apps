import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  listAppStylesheets,
  listRootTokens,
  listSharedStylesheets,
  listStrayCorners,
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

const ROOT = new URL("../", import.meta.url);
const PAGE_SCRIPT_FOLDERS = [
  "shared/page/",
  ...readdirSync(new URL("apps/", ROOT)).map((app) => `apps/${app}/page/js/`),
];

// MLB's seed lock is an icon drawn for its place, so its corners are its own.
const OWN_SHAPED_SCRIPTS = new Map([["apps/mlb/page/js/games-view.js", 1]]);

/**
 * How many corners each page script types into what it draws, as an SVG shape's rx or ry.
 * @returns {Map<string, number>}
 */
function countScriptCorners() {
  const counts = new Map();
  for (const folder of PAGE_SCRIPT_FOLDERS)
    for (const name of readdirSync(new URL(folder, ROOT)).filter((each) => each.endsWith(".js"))) {
      const path = `${folder}${name}`;
      const corners = readFileSync(new URL(path, ROOT), "utf8").match(/\br[xy]="/g) ?? [];
      if (corners.length) counts.set(path, corners.length);
    }
  return counts;
}

test("no page script types a corner into an SVG shape, which takes it from the shape tokens in CSS", () => {
  assert.deepEqual(countScriptCorners(), OWN_SHAPED_SCRIPTS);
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
