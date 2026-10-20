import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { START_AFTER_AWAY_MS, isAwayLong } from "../shared/page/long-away.js";

const MINUTE_MS = 60 * 1000;

test("two minutes away or more is long enough to start over", () => {
  assert.equal(isAwayLong(2 * MINUTE_MS - 1), false);
  assert.equal(isAwayLong(2 * MINUTE_MS), true);
});

// The plain scripts in a page's head can't import long-away.js, so open-last-tab.js keeps its
// limit for them all.
const HEAD_SCRIPTS = ["open-last-tab.js", "show-last-drawn.js"];

/** @param {string} name */
const readHeadScript = (name) =>
  readFileSync(new URL(`../shared/page/${name}`, import.meta.url), "utf8");

/** The limit open-last-tab.js keeps, worked out from its source. */
function readHeadScriptLimit() {
  const source = readHeadScript("open-last-tab.js");
  const [, expression] = source.match(/const START_AFTER_AWAY_MS = ([\d\s*]+);/) ?? [];
  assert.ok(expression, "open-last-tab.js keeps no START_AFTER_AWAY_MS");
  return expression.split("*").reduce((product, factor) => product * Number(factor), 1);
}

test("the head scripts start over after as long away as the page's modules do", () => {
  assert.equal(readHeadScriptLimit(), START_AFTER_AWAY_MS);
});

test("only open-last-tab.js keeps the head scripts' limit", () => {
  const keepers = HEAD_SCRIPTS.filter((name) => /AWAY_MS = /.test(readHeadScript(name)));
  assert.deepEqual(keepers, ["open-last-tab.js"]);
});
