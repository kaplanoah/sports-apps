import { test } from "node:test";
import assert from "node:assert/strict";
import { listAppStylesheets, listOtherHoverChanges, listSharedStylesheets } from "./css-rules.js";

/** @param {string[]} paths */
const listChanges = (paths) =>
  paths.flatMap((path) => listOtherHoverChanges(path).map((change) => `${path}: ${change}`));

// Under a mouse, text or an icon takes some of the accent, and nothing else changes: no fill,
// border, or underline.
test("a hover in the shared stylesheets changes only a text or icon's color, to --ink-hover", () => {
  assert.deepEqual(listChanges(listSharedStylesheets()), []);
});

test("a hover in each app's own styles changes only a text or icon's color, to --ink-hover", () => {
  assert.deepEqual(listChanges(listAppStylesheets()), []);
});
