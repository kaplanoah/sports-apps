import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { listStylesheets, readDeclarations, readRule } from "./css-rules.js";
import { REPO_ROOT } from "./repo-files.js";

const CONTROLS = fileURLToPath(new URL("shared/page/controls.css", REPO_ROOT));
// The Appearance choice's radio takes its focus, while its icon shows the ring.
const APPEARANCE_RING = "body.kbd .appearance-choice:has(input:focus) .appearance-icon";

/**
 * @param {string} path
 * @param {(declaration: import("./css-rules.js").Declaration) => boolean} isStray
 */
const listStrays = (path, isStray) =>
  readDeclarations(path)
    .filter(isStray)
    .map((declaration) => `${path}: ${readRule(declaration)} { ${declaration.property} }`);

// :focus-visible counts a bare Shift press, and :active is a press the page can't time, so every
// ring keys off body.kbd and every press off press.js's .is-pressed.
test("no stylesheet draws a ring by :focus-visible, or a press by :active", () => {
  const strays = listStylesheets().flatMap((path) =>
    listStrays(
      path,
      (declaration) =>
        readRule(declaration).includes(":focus-visible") ||
        (readRule(declaration).includes(":active") && declaration.property !== "cursor"),
    ),
  );

  assert.deepEqual(strays, []);
});

test("outside controls.css, a focus rule only moves a keyboard's ring, but for the Appearance icon's", () => {
  const strays = listStylesheets()
    .filter((path) => path !== CONTROLS)
    .flatMap((path) =>
      listStrays(path, (declaration) => {
        const rule = readRule(declaration);
        if (!rule.includes(":focus") || rule === APPEARANCE_RING) return false;
        return !rule.startsWith("body.kbd ") || declaration.property !== "outline-offset";
      }),
    );

  assert.deepEqual(strays, []);
});
