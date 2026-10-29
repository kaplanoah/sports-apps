import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { findAppRoot, listApps, listAppsWithBrowserTests } from "../worker/apps.mjs";
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

// A league ships in parts, so an app whose part a suite checks is still to come names the suite
// here until the PR adding that part calls it.
/** @type {Record<string, string[]>} */
const SUITES_NOT_YET_REACHED = {};

/**
 * Each shared suite an app's specs call.
 * @param {string} app
 */
const listSuitesCalled = (app) => {
  const specs = readFilesEndingIn(new URL("tests/browser/", findAppRoot(app)), ".spec.mjs");
  return sharedSuites.filter((suite) =>
    specs.some((text) => new RegExp(`\\b${suite}\\(`).test(text)),
  );
};

// A suite an app's specs never call checks nothing of it, and nothing else says so.
test("each app with browser tests runs every shared browser suite it has reached", () => {
  const missing = listAppsWithBrowserTests().flatMap((app) => {
    const called = listSuitesCalled(app);
    const notReached = SUITES_NOT_YET_REACHED[app] ?? [];
    return sharedSuites
      .filter((suite) => !called.includes(suite) && !notReached.includes(suite))
      .map((suite) => `${app}: ${suite}`);
  });
  assert.deepEqual(missing, []);
});

test("each suite an app hasn't reached is a shared suite its specs don't call yet", () => {
  const appsWithBrowserTests = listAppsWithBrowserTests();
  const stale = Object.entries(SUITES_NOT_YET_REACHED).flatMap(([app, suites]) => {
    if (!appsWithBrowserTests.includes(app)) return suites.map((suite) => `${app}: ${suite}`);
    const called = listSuitesCalled(app);
    return suites
      .filter((suite) => !sharedSuites.includes(suite) || called.includes(suite))
      .map((suite) => `${app}: ${suite}`);
  });
  assert.deepEqual(stale, []);
});

test("every app runs the shared season updater contract", () => {
  const missing = listApps().filter((app) => {
    const tests = readFilesEndingIn(new URL("tests/", findAppRoot(app)), ".test.js");
    return !tests.some((text) => /\btestSeasonUpdater\(/.test(text));
  });
  assert.deepEqual(missing, []);
});
