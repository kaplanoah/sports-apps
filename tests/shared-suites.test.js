import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { findAppRoot, listAppsWithBrowserTests } from "../worker/apps.mjs";
import { REPO_ROOT } from "./repo-files.js";

const SHARED_BROWSER_TESTS = new URL("tests/browser/", REPO_ROOT);

/**
 * Code with its comments taken out, so a call left in one doesn't count.
 * @param {string} code
 */
const removeComments = (code) => code.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");

/**
 * The code of each file in a folder whose name ends as asked, without its comments.
 * @param {URL} folder
 * @param {string} ending
 */
const readFilesEndingIn = (folder, ending) =>
  readdirSync(folder)
    .filter((name) => name.endsWith(ending))
    .map((name) => removeComments(readFileSync(new URL(name, folder), "utf8")));

const sharedSuites = readFilesEndingIn(SHARED_BROWSER_TESTS, ".mjs").flatMap((text) =>
  [...text.matchAll(/^export (?:async )?function (test[A-Z]\w*)\(/gm)].map(([, name]) => name),
);

test("the shared browser tests hold suites", () => {
  assert.ok(sharedSuites.length > 0);
});

// A suite an app's specs never call checks nothing of it, and nothing else says so.
test("each app with browser tests runs every shared browser suite", () => {
  const missing = listAppsWithBrowserTests().flatMap((app) => {
    const specs = readFilesEndingIn(new URL("tests/browser/", findAppRoot(app)), ".spec.mjs");
    return sharedSuites
      .filter((suite) => !specs.some((text) => new RegExp(`\\b${suite}\\(`).test(text)))
      .map((suite) => `${app}: ${suite}`);
  });
  assert.deepEqual(missing, []);
});
