import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAppStylesheets,
  listRootTokens,
  listSharedStylesheets,
  listStrayCorners,
} from "./css-rules.js";

// What the shared stylesheets ask every app's :root for, so each app sets its own shapes and how a
// pill shows the list that's chosen.
const APP_TOKENS = [
  "--radius-card",
  "--radius-chip",
  "--radius-control",
  "--radius-sheet",
  "--held-bar-fade",
  "--held-bar-line",
  "--pager-label",
  "--pager-chosen-edge",
];

test("every corner the shared stylesheets draw comes from an app's shape tokens", () => {
  for (const path of listSharedStylesheets()) assert.deepEqual(listStrayCorners(path), [], path);
});

test("every corner each app's own styles draw comes from its shape tokens", () => {
  for (const path of listAppStylesheets()) assert.deepEqual(listStrayCorners(path), [], path);
});

test("every app's styles set each shape and pill color the shared stylesheets ask for", () => {
  for (const path of listAppStylesheets()) {
    const tokens = listRootTokens(path);
    assert.deepEqual(
      APP_TOKENS.filter((token) => !tokens.has(token)),
      [],
      path,
    );
  }
});
