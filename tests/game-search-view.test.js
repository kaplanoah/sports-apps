import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFragment } from "parse5";
import { renderSearchShell } from "../shared/page/game-search-view.js";

/**
 * Every element under `node`, in order.
 * @param {any} node
 * @returns {any[]}
 */
const listElements = (node) =>
  (node.childNodes ?? []).flatMap((child) =>
    child.tagName ? [child, ...listElements(child)] : listElements(child),
  );

test("the search field's label holds the field and no other control", () => {
  const labels = listElements(parseFragment(String(renderSearchShell()))).filter(
    (element) => element.tagName === "label",
  );
  assert.equal(labels.length, 1);
  const inside = listElements(labels[0]).map((element) => element.tagName);
  assert.ok(inside.includes("input"));
  assert.ok(!inside.includes("button"));
});
