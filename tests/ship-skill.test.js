import { test } from "node:test";
import assert from "node:assert/strict";
import { listTrackedFiles, readRepoFile } from "./repo-files.js";

const isDeployCode = (/** @type {string} */ path) =>
  /^worker\/[^/]+\.mjs$/.test(path) || path === ".github/workflows/deploy.yml";

/**
 * A file's code without its comments, which never reach a log.
 * @param {string} text
 */
const dropComments = (text) =>
  text.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/^\s*(?:\/\/|#).*$/gm, "");

/**
 * The log lines a section of a skill quotes, each in double quotes.
 * @param {string} text
 * @param {string} heading
 */
function listQuotedLines(text, heading) {
  const section = text.split(/^## /m).find((part) => part.startsWith(heading)) ?? "";
  return [...section.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * How many times a phrase shows in a text.
 * @param {string} text
 * @param {string} phrase
 */
const countShown = (text, phrase) => text.split(phrase).length - 1;

// CI's review never reads the skills, so a change to what a deploy prints would leave the skill
// sending a session after a line the log no longer holds, or one the code holds in more than one place.
test("each phrase the ship skill reads in a deploy's log shows once in the deploy's code", () => {
  const deployCode = listTrackedFiles()
    .filter(isDeployCode)
    .map((path) => dropComments(readRepoFile(path)))
    .join("\n");
  const quoted = listQuotedLines(
    readRepoFile(".claude/skills/ship/SKILL.md"),
    "Step 10: reading a deploy's log",
  );
  assert.ok(quoted.length > 0);
  assert.deepEqual(
    quoted.filter((phrase) => countShown(deployCode, phrase) !== 1),
    [],
  );
});
