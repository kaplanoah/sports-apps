import test from "node:test";
import assert from "node:assert/strict";
import { findTestLines } from "../worker/browser-test-calls.mjs";
import { listEditedTests, readChangedLines, sortBurnInFailures } from "../worker/judge-burn-in.mjs";

const SPEC = "apps/wnba/tests/browser/standings.spec.mjs";

// Line numbers are the source's own, from 1.
const SOURCE = [
  'import { test, expect } from "./harness.mjs";', // 1
  "", // 2
  'test.use({ contextOptions: { reducedMotion: "reduce" } });', // 3
  "", // 4
  'test("the pill switches lists", async ({ page }) => {', // 5
  "  await expect(page).toHaveTitle(/WNBA/);", // 6
  "});", // 7
  "", // 8
  "const readGap = () => 4;", // 9
  "", // 10
  'test.describe("on a phone", () => {', // 11
  "  for (const width of [360, 390]) {", // 12
  "    test(`rows fit at ${width}px`, async () => {", // 13
  "      expect(readGap()).toBe(4);", // 14
  "    });", // 15
  "  }", // 16
  "});", // 17
].join("\n");

/** @param {string} path */
const readSpec = (path) => (path === SPEC ? SOURCE : null);

/**
 * A no-context diff of one spec, with the hunk headers it's given.
 * @param {string[]} hunks
 */
const diffSpec = (hunks) =>
  [`diff --git a/${SPEC} b/${SPEC}`, `--- a/${SPEC}`, `+++ b/${SPEC}`, ...hunks].join("\n");

test("a diff names the lines it adds or changes, as the new file numbers them", () => {
  const diff = diffSpec(["@@ -6 +6 @@", "-old", "+new", "@@ -20,0 +21,2 @@", "+a", "+b"]);
  assert.deepEqual(readChangedLines(diff), new Map([[SPEC, [6, 21, 22]]]));
});

test("a removal names the lines on either side of where it was", () => {
  assert.deepEqual(readChangedLines(diffSpec(["@@ -7,2 +6,0 @@", "-x", "-y"])).get(SPEC), [6, 7]);
});

test("a deleted file changes no lines", () => {
  const diff = [
    `diff --git a/${SPEC} b/${SPEC}`,
    `--- a/${SPEC}`,
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-a",
    "-b",
  ].join("\n");
  assert.deepEqual(readChangedLines(diff), new Map());
});

test("each test call spans its first line to its last, a test in a loop once", () => {
  assert.deepEqual(findTestLines(SOURCE), [
    { line: 5, endLine: 7 },
    { line: 13, endLine: 15 },
  ]);
});

test("a change inside a test edits only that test", () => {
  const edited = listEditedTests(new Map([[SPEC, [6]]]), readSpec, new Set([SPEC]));
  assert.deepEqual([...edited], [`${SPEC}:5`]);
});

test("a change outside every test, like a helper or a test.use, edits every test in its spec", () => {
  for (const line of [3, 9, 12]) {
    const edited = listEditedTests(new Map([[SPEC, [line]]]), readSpec, new Set([SPEC]));
    assert.deepEqual([...edited], [`${SPEC}:*`, `${SPEC}:5`, `${SPEC}:13`], `line ${line}`);
  }
});

test("a deleted spec edits no test", () => {
  assert.deepEqual(
    [...listEditedTests(new Map([["gone.spec.mjs", [1]]]), readSpec, new Set(["gone.spec.mjs"]))],
    [],
  );
});

/**
 * A spec's runs in a burn-in report, as Playwright's JSON reporter writes them.
 * @param {number} line
 * @param {string} title
 * @param {string[]} statuses one for each run
 */
const reportSpec = (line, title, statuses) => ({
  title,
  file: SPEC,
  line,
  tests: statuses.map((status) => ({
    projectName: "wnba",
    results: [{ status, ...(status === "failed" ? { error: { message: "Error: off" } } : {}) }],
  })),
});

const burnInReport = {
  suites: [
    {
      title: "standings.spec.mjs",
      specs: [reportSpec(5, "the pill switches lists", ["passed", "failed", "passed"])],
      suites: [
        {
          title: "on a phone",
          specs: [reportSpec(13, "rows fit at 390px", ["passed", "passed", "failed"])],
        },
      ],
    },
  ],
};

test("burn-in fails the pull request only on a test it wrote or edited, and calls the rest flaky", () => {
  const { edited, flaky, runErrors } = sortBurnInFailures(burnInReport, new Set([`${SPEC}:5`]));
  assert.deepEqual(edited, [
    {
      name: `[wnba] ${SPEC}:5 > the pill switches lists`,
      runs: 3,
      failures: 1,
      message: "Error: off",
    },
  ]);
  assert.deepEqual(runErrors, []);
  assert.deepEqual(flaky, [
    {
      name: `[wnba] ${SPEC}:13 > on a phone > rows fit at 390px`,
      runs: 3,
      failures: 1,
      message: "Error: off",
    },
  ]);
});

test("a run that broke outside its tests, like on a config error, names what broke it", () => {
  const broken = { suites: [], errors: [{ message: "Error: No tests found\nmore" }] };
  assert.deepEqual(sortBurnInFailures(broken, new Set()).runErrors, ["Error: No tests found"]);
});

const HELPER = "tests/browser/notification-layout.mjs";
const ADAPTER =
  'import { defineTests } from "../../../../tests/browser/notification-layout.mjs";\ndefineTests(test);';

test("an edited adapter owns failures whose declarations are in a shared helper", () => {
  const editedTests = listEditedTests(new Map([[SPEC, [2]]]), () => ADAPTER, new Set([SPEC]));
  const helperSpec = { ...reportSpec(5, "controls align", ["passed", "failed"]), file: HELPER };
  const report = {
    suites: [
      { file: SPEC, suites: [{ file: HELPER, specs: [helperSpec] }] },
      { file: "apps/mlb/tests/browser/layout.spec.mjs", specs: [helperSpec] },
    ],
  };
  const { edited, flaky } = sortBurnInFailures(report, editedTests);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].failures, 1);
  assert.equal(flaky.length, 1);
});

test("an edited helper declaration fails every app that runs that test", () => {
  const editedTests = listEditedTests(new Map([[HELPER, [6]]]), () => SOURCE, new Set([HELPER]));
  const helperSpec = { ...reportSpec(5, "controls align", ["passed", "failed"]), file: HELPER };
  const report = {
    suites: [SPEC, "apps/mlb/tests/browser/layout.spec.mjs"].map((file) => ({
      file,
      specs: [helperSpec],
    })),
  };
  const { edited, flaky } = sortBurnInFailures(report, editedTests);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].runs, 4);
  assert.equal(edited[0].failures, 2);
  assert.deepEqual(flaky, []);
});

test("the shared browser file list includes js helpers and excludes production files", () => {
  const helper = "tests/browser/shared.js";
  const page = "apps/mlb/page/index.html";
  const editedTests = listEditedTests(
    new Map([
      [helper, [6]],
      [page, [1]],
    ]),
    (path) => {
      if (path !== helper) throw new Error("Read a non-browser file");
      return SOURCE;
    },
    new Set([helper]),
  );
  const report = {
    suites: [{ file: SPEC, specs: [{ ...reportSpec(5, "align", ["failed"]), file: helper }] }],
  };
  assert.equal(sortBurnInFailures(report, editedTests).edited.length, 1);
});
