import { test } from "node:test";
import assert from "node:assert/strict";
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
