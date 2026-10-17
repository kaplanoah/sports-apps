import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** @param {string} path from the repo's root @param {RegExp} pattern */
const readNamed = (path, pattern) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8").match(pattern)?.[1];

// The tests' harness closes the welcome as the viewer would, under the key the page's plain
// scripts keep it closed by.
test("the tests close the welcome under the key the page keeps it closed by", () => {
  const drawn = readNamed("shared/page/pick-theme.js", /const WELCOME_CLOSED_KEY = "([^"]+)";/);
  assert.ok(drawn);
  assert.equal(
    readNamed("tests/browser/harness.mjs", /localStorage\.setItem\("([^"]+)", "closed"\)/),
    drawn,
  );
});

// The plain scripts that draw the welcome before the first paint can't import a module, so they
// make device.js's tests of the device themselves.
test("the welcome tells a phone, its Home Screen, and an iPhone or iPad as device.js does", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const drawing = read("shared/page/draw-home-screen-asks.js") + read("shared/page/pick-theme.js");
  const device = read("shared/page/device.js");
  for (const check of [
    '"(hover: none) and (pointer: coarse)"',
    '"(display-mode: standalone)"',
    ".standalone",
    "/iPhone|iPad|iPod/.test(navigator.userAgent)",
    'navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1',
  ]) {
    assert.ok(device.includes(check), `device.js: ${check}`);
    assert.ok(drawing.includes(check), `the plain scripts: ${check}`);
  }
});
