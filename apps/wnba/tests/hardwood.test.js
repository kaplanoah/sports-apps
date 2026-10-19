import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  listStrayCorners,
  readDeclarations,
  readFontFaces,
  readRule,
} from "../../../tests/css-rules.js";

const STYLES = fileURLToPath(new URL("../page/styles.css", import.meta.url));

const namesOrangeOrTeal = (value) => /var\(--(orange|teal)(-ink)?\)/.test(value);

test("only :root names orange or teal, so every rule colors by what it means: now, action, structure, or result", () => {
  const strays = readDeclarations(STYLES)
    .filter((declaration) => namesOrangeOrTeal(declaration.value))
    .filter((declaration) => !readRule(declaration).startsWith(":root"))
    .map(
      (declaration) => `${readRule(declaration)} { ${declaration.property}: ${declaration.value} }`,
    );
  assert.deepEqual(strays, []);
});

test("every corner comes from Hardwood's shape tokens, but for dots and app icons", () => {
  assert.deepEqual(listStrayCorners(STYLES), []);
});

test("Barlow Condensed draws 8% larger than its size, so it looks as big as Barlow", () => {
  const listFaces = (/** @type {string} */ family) =>
    readFontFaces(STYLES)
      .filter((face) => face["font-family"] === family)
      .map((face) => `${face["font-weight"]} ${face["size-adjust"] ?? "100%"}`)
      .sort();
  assert.deepEqual(listFaces("Barlow Condensed"), ["300 108%", "400 108%", "500 108%", "600 108%"]);
  assert.ok(listFaces("Barlow").every((face) => face.endsWith(" 100%")));
});
