import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Two changes to AGENTS.md conflict only when they touch the same or neighboring lines, so each
// sentence starts a line of its own and a long one breaks after its commas.
const AGENTS = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const LONGEST_LINE = 240;

const readProse = (line) => line.replace(/^\s*\d+\. /, "").replaceAll(/`[^`]*`/g, "``");

test("each line of AGENTS.md starts at most one sentence", () => {
  const joined = AGENTS.split("\n").filter((line) => /[.?!] [A-Z]/.test(readProse(line)));
  assert.deepEqual(joined, []);
});

test("a long sentence in AGENTS.md breaks after its commas", () => {
  const long = AGENTS.split("\n").filter((line) => line.length > LONGEST_LINE);
  assert.deepEqual(long, []);
});
