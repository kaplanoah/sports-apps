import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** @param {string} path from the repo's root @param {RegExp} pattern */
const readNamed = (path, pattern) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").match(pattern)?.[1];

// The plain script that draws the welcome before the first paint can't import the module that
// closes it, so each names the key it's kept under, and the tests' harness closes it under the
// same one.
test("the welcome is kept closed under one key wherever it's read or written", () => {
  const declared = /const WELCOME_CLOSED_KEY = "([^"]+)";/;
  const drawn = readNamed("shared/page/draw-home-screen-asks.js", declared);
  assert.ok(drawn);
  assert.equal(readNamed("shared/page/home-screen.js", declared), drawn);
  assert.equal(
    readNamed("tests/browser/harness.mjs", /localStorage\.setItem\("([^"]+)", "closed"\)/),
    drawn,
  );
});
