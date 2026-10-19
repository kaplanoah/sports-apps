import test from "node:test";
import assert from "node:assert/strict";
import { listReachedFiles, listTestedApps, resolveImport } from "../worker/browser-scope.mjs";

const APPS = ["mlb", "wnba"];
const REACHED = new Set(["worker/check-page.mjs", "tests/durable-object-context.js"]);

/** @param {string[]} paths */
const listApps = (paths) => listTestedApps(paths, { apps: APPS, reached: REACHED });

test("a change to the docs, the other workflows, or the tooling no browser test imports runs none", () => {
  assert.deepEqual(
    listApps([
      "README.md",
      "apps/mlb/README.md",
      ".claude/skills/steward/SKILL.md",
      ".github/workflows/flaky.yml",
      "worker/plan-review.mjs",
      "tests/plan-review.test.js",
      "apps/wnba/tests/search.test.js",
      "knip.json",
    ]),
    [],
  );
});

test("a change in one app's folder runs that app's browser tests", () => {
  assert.deepEqual(
    listApps(["apps/wnba/page/styles.css", "apps/wnba/tests/browser/page.spec.mjs"]),
    ["wnba"],
  );
  assert.deepEqual(listApps(["apps/mlb/tests/fixtures/2026-10-13-player-index.json"]), ["mlb"]);
});

test("shared code, CI's own workflow, the dependencies, and an unknown file run every app's", () => {
  for (const path of [
    "shared/page/sheet.js",
    ".github/workflows/ci.yml",
    "package-lock.json",
    "playwright.config.mjs",
    "tests/fixtures/new.json",
    "a-new-folder/file.txt",
  ])
    assert.deepEqual(listApps([path]), APPS, path);
});

test("tooling or a test helper a browser test imports runs every app's", () => {
  assert.deepEqual(listApps(["worker/check-page.mjs"]), APPS);
  assert.deepEqual(listApps(["tests/durable-object-context.js"]), APPS);
});

test("imports resolve from the importer, through the import map's names, and leave packages out", () => {
  assert.equal(
    resolveImport("../../../../tests/browser/touch.mjs", "apps/wnba/tests/browser/page.spec.mjs"),
    "tests/browser/touch.mjs",
  );
  assert.equal(
    resolveImport("#shared/html.js", "apps/mlb/tests/browser/x.spec.mjs"),
    "shared/page/html.js",
  );
  assert.equal(
    resolveImport("#page-files/mlb", "apps/mlb/tests/browser/harness.mjs"),
    "apps/mlb/worker/page-files.mjs",
  );
  assert.equal(resolveImport("@playwright/test", "tests/browser/harness.mjs"), null);
});

test("the reached files follow every import from the entries, static and dynamic", () => {
  const files = {
    "apps/mlb/tests/browser/a.spec.mjs":
      'import { b } from "./harness.mjs";\nawait import("#shared/c.js");',
    "apps/mlb/tests/browser/harness.mjs": 'export { d } from "../../worker/page-files.mjs";',
    "apps/mlb/worker/page-files.mjs":
      'import { readPageFiles } from "../../../worker/page-files.mjs";',
    "worker/page-files.mjs": 'import { readFileSync } from "node:fs";',
    "shared/page/c.js": "",
    "worker/unreached.mjs": "",
  };
  const reached = listReachedFiles(["apps/mlb/tests/browser/a.spec.mjs", "missing.mjs"], (path) =>
    path in files ? files[path] : null,
  );
  assert.deepEqual([...reached].toSorted(), [
    "apps/mlb/tests/browser/a.spec.mjs",
    "apps/mlb/tests/browser/harness.mjs",
    "apps/mlb/worker/page-files.mjs",
    "shared/page/c.js",
    "worker/page-files.mjs",
  ]);
});
