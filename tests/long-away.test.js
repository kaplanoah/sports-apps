import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { START_AFTER_AWAY_MS, isAwayLong } from "../shared/page/long-away.js";

const MINUTE_MS = 60 * 1000;

test("two minutes away or more is long enough to start over", () => {
  assert.equal(isAwayLong(2 * MINUTE_MS - 1), false);
  assert.equal(isAwayLong(2 * MINUTE_MS), true);
});

// The plain scripts in a page's head can't import long-away.js, so each keeps a copy of its limit.
const HEAD_SCRIPTS = ["open-last-tab.js", "show-last-drawn.js"];

/**
 * The limit a head script keeps, worked out from its source.
 * @param {string} name
 */
function readHeadScriptLimit(name) {
  const source = readFileSync(new URL(`../shared/page/${name}`, import.meta.url), "utf8");
  const [, expression] = source.match(/const \w*START_AFTER_AWAY_MS = ([\d\s*]+);/) ?? [];
  assert.ok(expression, `${name} keeps no START_AFTER_AWAY_MS`);
  return expression.split("*").reduce((product, factor) => product * Number(factor), 1);
}

test("the head scripts start over after as long away as the page's modules do", () => {
  for (const name of HEAD_SCRIPTS)
    assert.equal(readHeadScriptLimit(name), START_AFTER_AWAY_MS, name);
});
