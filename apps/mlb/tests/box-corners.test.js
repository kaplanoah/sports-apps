import test from "node:test";
import assert from "node:assert/strict";
import { listSharedStylesheets, readDeclarations, readRule } from "../../../tests/css-rules.js";

const STYLESHEETS = [`${import.meta.dirname}/../page/styles.css`, ...listSharedStylesheets()];

// Each box the page outlines in the card's edge. The bracket's series cards are filled, not
// outlined, so they keep their own corner.
const OUTLINED_BOXES = [
  ".div-block",
  ".game-card-button",
  ".starters-open",
  ".team-stats",
  ".out-box",
  ".news-card",
  ".dismissible-box",
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
