import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "parse5";
import { listApps } from "../worker/apps.mjs";

/** @param {any} node */
const isLastDrawn = (node) =>
  !!node.attrs?.some(
    (/** @type {{ name: string }} */ attribute) => attribute.name === "data-last-drawn",
  );

/** @param {any} node */
const nameNode = (node) =>
  node.attrs?.find((/** @type {{ name: string }} */ attribute) => attribute.name === "id")?.value ??
  node.nodeName;

/**
 * Each last-drawn part inside another, as "outer > inner".
 * @param {any} node
 * @param {string | null} outer
 * @returns {string[]}
 */
function listNestedParts(node, outer = null) {
  const own = isLastDrawn(node);
  const nested = own && outer ? [`${outer} > ${nameNode(node)}`] : [];
  const inside = own ? (outer ?? nameNode(node)) : outer;
  const children = [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])];
  return [...nested, ...children.flatMap((child) => listNestedParts(child, inside))];
}

// A part saved inside another would be put back twice, and the outer one would keep markup no
// module draws, which a release could never change.
for (const app of listApps()) {
  test(`${app}: no part the page draws whole sits inside another`, () => {
    const page = parse(
      readFileSync(new URL(`../apps/${app}/page/index.html`, import.meta.url), "utf8"),
    );
    assert.deepEqual(listNestedParts(page), []);
  });
}
