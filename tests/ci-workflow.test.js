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

// Prettier writes a long list of needs on a line of its own for each.
const readCheckNeeds = () =>
  readRepoFile(".github/workflows/ci.yml")
    .match(/^ {2}check:\n(?: {4}.*\n)*? {4}needs:\s*\[([^\]]*)\]/m)?.[1]
    .split(",")
    .map((job) => job.trim())
    .filter(Boolean);

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

test("the browser job's traces leave out the page at each step, which burn-in's keep", () => {
  assert.match(readJob("browser"), /TRACE_SNAPSHOTS: "off"/);
  assert.doesNotMatch(readJob("burn-in"), /TRACE_SNAPSHOTS/);
});

test("burn-in runs every test ten times however many fail, and fails only on a test the pull request wrote or edited", () => {
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /--repeat-each=10 --retries=0 --max-failures=0/);
  assert.match(
    burnIn,
    /git diff -U0 --no-renames HEAD\^1 HEAD .*\| node worker\/judge-burn-in\.mjs/,
  );
  assert.match(burnIn, /name: burn-in-flaky-/);
});

// Burn-in's machines start only for a pull request that changes a browser spec, and check
// requires them to pass then.
test("burn-in runs only when a pull request changes a browser spec, and check requires it then", () => {
  assert.match(readJob("changed-specs"), /git diff --name-only --diff-filter=AM HEAD\^1 HEAD/);
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /needs: changed-specs/);
  assert.match(
    burnIn,
    /if: .*needs\.changed-specs\.result == 'success' && needs\.changed-specs\.outputs\.specs != ''/,
  );
  assert.match(burnIn, /SPECS: \$\{\{ needs\.changed-specs\.outputs\.specs \}\}/);
  assert.match(
    readJob("check"),
    /\(needs\.changed-specs\.outputs\.specs == '' \|\| needs\.burn-in\.result == 'success'\)/,
  );
});

// GitHub skips a job once any job before it in its chain of needs was skipped, as passed is on
// every push to a pull request, unless its condition checks the run's status itself.
test("each job that needs another runs even when one before it was skipped", () => {
  const skippedWithTheirChain = listJobs().filter((job) => {
    const condition = readJob(job).match(/^ {4}if: (.*)$/m)?.[1] ?? "success()";
    return /^ {4}needs:/m.test(readJob(job)) && !/!cancelled\(\)|always\(\)/.test(condition);
  });
  assert.deepEqual(skippedWithTheirChain, []);
});

test("the check job names each test burn-in found failing in the issue, and can start the fix routine", () => {
  const check = readJob("check");
  assert.match(check, /pattern: burn-in-flaky-\*/);
  assert.match(check, /--retried "\$\{listed\[@\]\}"/);
  assert.match(check, /FLAKY_ROUTINE_URL: \$\{\{ secrets\.FLAKY_ROUTINE_URL \}\}/);
  assert.match(check, /FLAKY_ROUTINE_TOKEN: \$\{\{ secrets\.FLAKY_ROUTINE_TOKEN \}\}/);
});

// A label change, like adding phone-ok, brings no new code: once a run passed every test on
// exactly this code, only the gate runs again, and the label waits for a run still going rather
// than stopping it.
test("a label change runs only the gate again once a run passed every test on the same code", () => {
  const workflow = readRepoFile(".github/workflows/ci.yml");
  assert.match(
    workflow,
    /cancel-in-progress: .*github\.event\.action != 'labeled' && github\.event\.action != 'unlabeled'/,
  );
  const passed = readJob("passed");
  assert.match(
    passed,
    /if: .*github\.event\.action == 'labeled' \|\| github\.event\.action == 'unlabeled'/,
  );
  assert.match(
    passed,
    /SEARCH: \$\{\{ github\.event_name == 'pull_request' && '--tested' \|\| '' \}\}/,
  );
  assert.match(readJob("changed-specs"), /needs: passed\n.*!needs\.passed\.outputs\.run/);
  const check = readJob("check");
  assert.match(
    check,
    /if: github\.event_name == 'pull_request' && steps\.tested\.outputs\.tested == 'true'\n.*\n\s+name: ci-tested-/,
  );
  assert.ok(check.indexOf("name: ci-tested-") < check.indexOf("Require every job to pass"));
});

// A review reads a change of any size in full: each share's reads are checked, and review fails
// on any file left unread, from a guide the pull request can't change, on a named model.
test("the review reads every share in full and fails on any file left unread", () => {
  assert.match(
    readJob("review-plan"),
    /node worker\/plan-review\.mjs \.review >> "\$GITHUB_OUTPUT"/,
  );
  const share = readJob("review-share");
  assert.match(share, /include: \$\{\{ fromJSON\(needs\.review-plan\.outputs\.shares/);
  assert.match(share, /git show FETCH_HEAD:REVIEW\.md > \.review\/REVIEW\.md/);
  assert.match(share, /--model claude-opus-5-5/);
  assert.match(share, /disableAllHooks/);
  assert.match(
    share,
    /node worker\/judge-review\.mjs share \.review "\$SHARE" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(share, /if: always\(\) && steps\.first\.outputs\.unread != ''/);
  assert.match(readJob("review-across"), /node worker\/judge-review\.mjs across \.review/);
  assert.match(
    share,
    /if: always\(\) && steps\.last\.outputs\.unread != ''\n\s+run: \|\n.*\n\s+exit 1/,
  );
  const review = readJob("review");
  assert.match(
    review,
    /needs: \[review-plan, review-share, review-across\]\n\s+if: \$\{\{ !cancelled\(\) \}\}/,
  );
  assert.match(review, /run: node worker\/judge-review\.mjs summary \.review/);
  assert.match(review, /if: needs\.review-plan\.result != 'success'\n\s+run: \|\n.*\n\s+exit 1/);
});

// A label change skips the review only when a run already passed it on exactly this code, so
// adding a label never turns a failed review into a passing check.
test("a label change reviews again unless a run passed the review on the same code", () => {
  const plan = readJob("review-plan");
  assert.match(plan, /needs: passed/);
  assert.match(plan, /PASSED_RUN: \$\{\{ needs\.passed\.outputs\.run \}\}/);
  assert.match(plan, /elif \[ -n "\$PASSED_RUN" \]; then/);
  assert.doesNotMatch(plan, /"\$ACTION" = "labeled"/);
});
