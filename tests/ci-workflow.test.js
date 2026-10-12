import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** @param {string} path from the repo's root */
const readRepoFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const readInstalledPlaywright = () =>
  JSON.parse(readRepoFile("package-lock.json")).packages["node_modules/playwright"].version;

/** @param {string} workflow */
const listPlaywrightImageVersions = (workflow) =>
  [
    ...readRepoFile(`.github/workflows/${workflow}`).matchAll(
      /mcr\.microsoft\.com\/playwright:v([\d.]+)-/g,
    ),
  ].map(([, version]) => version);

// The image holds only the browsers its own Playwright version runs, so a job in it would find no
// browser once Dependabot moves Playwright on without it.
for (const workflow of ["ci.yml", "flaky.yml"]) {
  test(`${workflow}'s Playwright images are the Playwright version the lockfile installs`, () => {
    const versions = listPlaywrightImageVersions(workflow);
    assert.ok(versions.length > 0);
    for (const version of versions) assert.equal(version, readInstalledPlaywright());
  });
}

// The config stops CI's runs after a few failures, but the nightly run names every test that
// failed in the issue Flaky browser tests.
test("the nightly run of the browser tests runs every test however many fail", () => {
  assert.match(readRepoFile(".github/workflows/flaky.yml"), /--max-failures=0\b/);
});

/** @returns {string[]} the workflow's jobs, by the names they're keyed under */
const listJobs = () => {
  const jobs = readRepoFile(".github/workflows/ci.yml").split(/^jobs:$/m)[1] ?? "";
  return [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map(([, job]) => job);
};

const readCheckNeeds = () =>
  readRepoFile(".github/workflows/ci.yml")
    .match(/^ {2}check:\n(?: {4}.*\n)*? {4}needs: \[(.*)\]$/m)?.[1]
    .split(", ");

// check is the one job a merge waits on, so a job it doesn't need could fail without stopping
// one. caches only costs pull requests their cache when it fails.
test("the check job needs every other job but caches", () => {
  const others = listJobs().filter((job) => !["check", "caches"].includes(job));
  assert.deepEqual(readCheckNeeds()?.toSorted(), others.toSorted());
});
