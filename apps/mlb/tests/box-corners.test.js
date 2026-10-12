import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readDeclarations, readRule } from "../../../tests/css-rules.js";

const SHARED = `${import.meta.dirname}/../../../shared/page`;
const STYLESHEETS = [
  `${import.meta.dirname}/../page/styles.css`,
  ...readdirSync(SHARED)
    .filter((name) => name.endsWith(".css"))
    .map((name) => `${SHARED}/${name}`),
];

// Each box the page outlines in the card's edge. The bracket's series cards are filled, not
// outlined, so they keep their own corner.
const OUTLINED_BOXES = [
  ".div-block",
  ".game-card-button",
  ".starters-open",
  ".team-stats",
  ".out-box",
  ".news-card",
  ".updates",
  ".home-screen-tip",
  ".diagnostics-record",
];

/** @param {string} box */
const listCorners = (box) =>
  STYLESHEETS.flatMap(readDeclarations)
    .filter((declaration) => readRule(declaration) === box)
    .filter((declaration) => declaration.property === "border-radius")
    .map((declaration) => declaration.value);

test("every box the page outlines takes the card's corner, so no box drifts from the rest", () => {
  for (const box of OUTLINED_BOXES) assert.deepEqual(listCorners(box), ["var(--radius-card)"], box);
});
