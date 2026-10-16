import test from "node:test";
import assert from "node:assert/strict";
import { listAppStylesheets, listSharedStylesheets, readDeclarations } from "./css-rules.js";

const PHONE_QUERY = "@media (max-width: 779px)";

/**
 * Each rule in a stylesheet that adds the status bar's room to a sheet's or settings' top outside
 * a phone's layout, where the top is a card's and never reaches the screen's top.
 * @param {string} path
 */
const listTopsClearingStatusBarOffPhone = (path) =>
  readDeclarations(path)
    .filter(({ selectors }) => selectors.some((selector) => selector.includes(".sheet-top")))
    .filter(({ value }) => value.includes("env(safe-area-inset-top)"))
    .filter(({ selectors }) => !selectors.includes(PHONE_QUERY))
    .map(({ selectors, property, value }) => `${selectors.at(-1)} { ${property}: ${value} }`);

test("a sheet's or settings' top clears the status bar only on a phone, through --top-inset", () => {
  for (const path of [...listSharedStylesheets(), ...listAppStylesheets()])
    assert.deepEqual(listTopsClearingStatusBarOffPhone(path), [], path);
});
