import { test } from "node:test";
import assert from "node:assert/strict";
import { findTitleProblem } from "../worker/release.mjs";
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
 * A skill's section under a heading.
 * @param {string} text
 * @param {string} heading
 */
const readSection = (text, heading) =>
  text.split(/^## /m).find((part) => part.startsWith(heading)) ?? "";

/**
 * The log lines a section of a skill quotes, each in double quotes.
 * @param {string} text
 * @param {string} heading
 */
const listQuotedLines = (text, heading) =>
  [...readSection(text, heading).matchAll(/"([^"]+)"/g)].map((match) => match[1]);

/**
 * How many times a phrase shows in a text.
 * @param {string} text
 * @param {string} phrase
 */
const countShown = (text, phrase) => text.split(phrase).length - 1;

// CI's review never reads the skills, so a change to what a deploy prints would leave the skill
// sending a session after a line the log no longer holds, or one the code holds in more than one place.
test("each phrase the deploy-log skill reads in a deploy's log shows once in the deploy's code", () => {
  const deployCode = listTrackedFiles()
    .filter(isDeployCode)
    .map((path) => dropComments(readRepoFile(path)))
    .join("\n");
  const quoted = listQuotedLines(
    readRepoFile(".agents/skills/deploy-log/SKILL.md"),
    "Step 10: reading a deploy's log",
  );
  assert.ok(quoted.length > 0);
  assert.deepEqual(
    quoted.filter((phrase) => countShown(deployCode, phrase) !== 1),
    [],
  );
});

/** Every type a PR's title can start with, as the title check lists them. */
const listTitleTypes = () =>
  [...String(findTitleProblem("untyped", [])).matchAll(/\b([a-z]+):[,.]/g)].map(
    (match) => match[1],
  );

// A session ends a PR's work at the merge only for a type whose PR the deploy skips.
test("the ship skill ends at the merge exactly the PRs whose type can't deploy", () => {
  const deployedFile = "apps/mlb/page/js/app.js";
  const undeployed = listTitleTypes().filter(
    (type) => findTitleProblem(`${type}: change`, [deployedFile]) !== null,
  );
  const [endsAtMerge] = readSection(readRepoFile(".agents/skills/ship/SKILL.md"), "Steps 9 and 10")
    .split("\n- ")
    .slice(1);
  const named = [...String(endsAtMerge).matchAll(/`([a-z]+):`/g)].map((match) => match[1]);
  assert.ok(undeployed.length > 0);
  assert.deepEqual(named.sort(), undeployed.sort());
});
