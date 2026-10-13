import test from "node:test";
import assert from "node:assert/strict";
import {
  listBrowserSpecs,
  measureSpecTimes,
  readSpecTimes,
  splitSpecs,
} from "../worker/split-browser-specs.mjs";

test("every browser spec runs on exactly one of CI's machines", () => {
  const specs = listBrowserSpecs();
  const shares = splitSpecs(specs, readSpecTimes(), 6);
  assert.equal(shares.length, 6);
  assert.deepEqual(shares.flat().toSorted(), specs.toSorted());
});

test("each spec, longest first, goes to the machine with the least time so far", () => {
  const times = {
    "a.spec.mjs": 9,
    "b.spec.mjs": 6,
    "c.spec.mjs": 5,
    "d.spec.mjs": 4,
    "e.spec.mjs": 2,
  };
  assert.deepEqual(splitSpecs(Object.keys(times).toReversed(), times, 2), [
    ["a.spec.mjs", "d.spec.mjs"],
    ["b.spec.mjs", "c.spec.mjs", "e.spec.mjs"],
  ]);
});

test("a spec with no time yet counts as the median spec", () => {
  const times = { "a.spec.mjs": 10, "b.spec.mjs": 6, "c.spec.mjs": 2 };
  assert.deepEqual(splitSpecs([...Object.keys(times), "new.spec.mjs"], times, 2), [
    ["a.spec.mjs", "c.spec.mjs"],
    ["b.spec.mjs", "new.spec.mjs"],
  ]);
});

test("a spec's time averages each test's runs, from each app's Chromium project only", () => {
  const report = {
    suites: [
      {
        specs: [
          {
            file: "apps/mlb/tests/browser/at-rest.spec.mjs",
            tests: [
              { projectName: "mlb", results: [{ duration: 2000 }, { duration: 4000 }] },
              { projectName: "mlb-webkit", results: [{ duration: 9000 }] },
            ],
          },
        ],
        suites: [
          {
            specs: [
              {
                file: "apps/mlb/tests/browser/at-rest.spec.mjs",
                tests: [{ projectName: "mlb", results: [{ duration: 1500 }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(measureSpecTimes([report], ["mlb"]), {
    "apps/mlb/tests/browser/at-rest.spec.mjs": 4.5,
  });
});

test("the recorded times name only specs there are", () => {
  const specs = new Set(listBrowserSpecs());
  assert.deepEqual(
    Object.keys(readSpecTimes()).filter((spec) => !specs.has(spec)),
    [],
    "record the times again: node worker/split-browser-specs.mjs --record <report.json>",
  );
});
