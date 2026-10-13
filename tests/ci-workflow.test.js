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

test("the nightly run's report can start the routine that fixes flaky tests", () => {
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  assert.match(workflow, /FLAKY_ROUTINE_URL: \$\{\{ secrets\.FLAKY_ROUTINE_URL \}\}/);
  assert.match(workflow, /FLAKY_ROUTINE_TOKEN: \$\{\{ secrets\.FLAKY_ROUTINE_TOKEN \}\}/);
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

/**
 * One job of ci.yml, from its key to the next job.
 * @param {string} job
 */
const readJob = (job) =>
  readRepoFile(".github/workflows/ci.yml").match(
    new RegExp(`^ {2}${job}:\\n(?:(?: {4}.*)?\\n)*`, "m"),
  )?.[0] ?? "";

test("burn-in runs every test ten times however many fail, and fails only on a test the pull request wrote or edited", () => {
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /--repeat-each=10 --retries=0 --max-failures=0/);
  assert.match(
    burnIn,
    /git diff -U0 --no-renames HEAD\^1 HEAD .*\| node worker\/judge-burn-in\.mjs/,
  );
  assert.match(burnIn, /name: burn-in-flaky-/);
});

// Burn-in's four machines start only for a pull request that changes a browser spec, and check
// requires them to pass then.
test("burn-in runs only when a pull request changes a browser spec, and check requires it then", () => {
  assert.match(readJob("changed-specs"), /git diff --name-only --diff-filter=AM HEAD\^1 HEAD/);
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /needs: changed-specs/);
  assert.match(burnIn, /if: needs\.changed-specs\.outputs\.specs != ''/);
  assert.match(burnIn, /SPECS: \$\{\{ needs\.changed-specs\.outputs\.specs \}\}/);
  assert.match(
    readJob("check"),
    /\(needs\.changed-specs\.outputs\.specs != '' && needs\.burn-in\.result != 'success'\)/,
  );
});

test("the check job names each test burn-in found failing in the issue, and can start the fix routine", () => {
  const check = readJob("check");
  assert.match(check, /pattern: burn-in-flaky-\*/);
  assert.match(check, /--retried "\$\{listed\[@\]\}"/);
  assert.match(check, /FLAKY_ROUTINE_URL: \$\{\{ secrets\.FLAKY_ROUTINE_URL \}\}/);
  assert.match(check, /FLAKY_ROUTINE_TOKEN: \$\{\{ secrets\.FLAKY_ROUTINE_TOKEN \}\}/);
});
