import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listTrackedFiles } from "./tracked-files.js";

const ROOT = new URL("../", import.meta.url);

/** @param {string} path */
const readRepoFile = (path) => readFileSync(new URL(path, ROOT), "utf8");

/**
 * The words a section of a skill quotes, in double quotes or backticks.
 * @param {string} text
 * @param {string} heading
 */
function listQuotedWords(text, heading) {
  const section = text.split(/^## /m).find((part) => part.startsWith(heading)) ?? "";
  return [...section.matchAll(/"([^"]+)"|`([^`]+)`/g)].map((match) => match[1] ?? match[2]);
}

// CI's review never reads the skills, so a change to what a deploy prints would leave the skill
// reading lines the log no longer holds.
test("each line the ship skill reads in a deploy's log is one the deploy prints", () => {
  const deployCode = listTrackedFiles()
    .filter((path) => /^worker\/[^/]+\.mjs$/.test(path) || path === ".github/workflows/deploy.yml")
    .map(readRepoFile)
    .join("\n");
  const quoted = listQuotedWords(
    readRepoFile(".claude/skills/ship/SKILL.md"),
    "Step 10: reading a deploy's log",
  );
  assert.ok(quoted.length > 0);
  assert.deepEqual(
    quoted.filter((words) => !deployCode.includes(words)),
    [],
  );
});
