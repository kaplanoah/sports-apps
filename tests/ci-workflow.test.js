import {
  ATTEMPT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  CLEANUP_GRACE_MS,
  CLEANUP_TIMEOUT_MS,
} from "../worker/install-browsers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatJobOutputs, listJobs as listPlanJobs, writeReview } from "../worker/plan-review.mjs";
import { findRefusal } from "../worker/review-git.mjs";
import { escapePattern } from "../shared/page/escape-pattern.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import {
  createReviewDecisionEnvironment,
  readNativeReviewName,
  readStepInput,
  readStepScript,
} from "./workflow-step.js";
import { PHONE_CONTEXT as EXPECTED_PHONE_CONTEXT } from "../worker/labeling.mjs";
import { MUTATION_TARGETS } from "../worker/mutation-targets.mjs";
import { WEBKIT_TEST_MATCH } from "./browser/projects.mjs";

const WORKFLOWS = readdirSync(new URL(".github/workflows/", REPO_ROOT)).filter((name) =>
  name.endsWith(".yml"),
);

// Trusted review calls its area workflow once for each review area.
const REVIEW_WORKFLOW = "review.yml";
const AREA_WORKFLOW = "trusted-review-area.yml";

// A tag can be moved to other code, so each action is named by its commit, which can't. A
// workflow of this repo's own runs from the same commit as the one that calls it.
test("every workflow's actions are pinned to a commit", () => {
  assert.ok(WORKFLOWS.length > 0);
  for (const workflow of WORKFLOWS) {
    const actions = [
      ...readRepoFile(`.github/workflows/${workflow}`).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm),
    ].map(([, action]) => action);
    for (const action of actions)
      assert.match(
        action,
        /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$|^\.\/\.github\/workflows\/[\w-]+\.yml$/,
        `${workflow}: ${action}`,
      );
  }
});

test("every install skips npm's audit", () => {
  assert.match(readRepoFile(".npmrc"), /^audit=false$/m);
});

test("mutation testing runs weekly and keeps its uncaught mutations in a report", () => {
  const workflow = readRepoFile(".github/workflows/mutation.yml");
  const cron = workflow.match(/cron: "([^"]+)"/)?.[1].split(" ");
  assert.equal(cron?.length, 5);
  assert.match(cron?.[0] ?? "", /^(?:[0-5]?\d)$/);
  assert.match(cron?.[1] ?? "", /^(?:[01]?\d|2[0-3])$/);
  assert.deepEqual(cron?.slice(2, 4), ["*", "*"]);
  assert.match(cron?.[4] ?? "", /^[0-6]$/);
  assert.match(readStepScript(workflow, "Test mutations"), /npm run test:mutation/);
  assert.match(workflow, /path: reports\/mutation\//);
  assert.match(workflow, /if-no-files-found: error/);
  const targets = [...workflow.matchAll(/^ {10}- target: ([a-z-]+)$/gm)].map(
    ([, target]) => target,
  );
  assert.deepEqual(targets, MUTATION_TARGETS);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /MUTATION_TARGET: \$\{\{ matrix.target \}\}/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /name: mutation-report-\$\{\{ matrix.target \}\}/);
});

test("each mutation target leaves setup and report time below GitHub's six-hour limit", () => {
  const workflow = readRepoFile(".github/workflows/mutation.yml");
  assert.match(workflow, /^ {4}timeout-minutes: \$\{\{ matrix.job-minutes \}\}$/m);
  const testStep = workflow
    .split(/^ {6}- /m)
    .find((step) => step.startsWith("name: Test mutations\n"));
  assert.ok(testStep);
  assert.match(testStep, /timeout-minutes: \$\{\{ matrix.test-minutes \}\}/);
  const uploadStep = workflow
    .split(/^ {6}- /m)
    .find((step) => step.startsWith("uses: actions/upload-artifact@"));
  assert.ok(uploadStep);
  assert.match(uploadStep, /if: \$\{\{ always\(\) \}\}/);
  const uploadMinutes = Number(uploadStep.match(/timeout-minutes: (\d+)/)?.[1]);
  assert.ok(uploadMinutes > 0);
  const budgets = [
    ...workflow.matchAll(
      /^ {10}- target: ([a-z-]+)\n {12}test-minutes: (\d+)\n {12}job-minutes: (\d+)$/gm,
    ),
  ];
  assert.deepEqual(
    budgets.map(([, target]) => target),
    MUTATION_TARGETS,
  );
  for (const [, target, tests, job] of budgets) {
    const testMinutes = Number(tests);
    const jobMinutes = Number(job);
    assert.ok(testMinutes > 0, `${target}: a finite mutation deadline`);
    assert.ok(jobMinutes <= 360, `${target}: within GitHub's six-hour job limit`);
    assert.ok(
      jobMinutes - testMinutes >= 10 + uploadMinutes,
      `${target}: setup and upload retain their time`,
    );
  }
});

test("the mutation workflow saves failed command output without hiding its exit status", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "mutation-step-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, "npm"), '#!/bin/sh\necho "FIXTURE_MUTATION_FAILURE" >&2\nexit 7\n', {
    mode: 0o755,
  });
  const workflow = readRepoFile(".github/workflows/mutation.yml");
  assert.match(workflow, /name: Test mutations\n\s+timeout-minutes: [^\n]+\n\s+shell: bash/);
  const script = readStepScript(workflow, "Test mutations");
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
    {
      cwd: folder,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${folder}:${process.env.PATH}`,
        MUTATION_TARGET: "search-reading",
      },
    },
  );
  assert.equal(result.status, 7, result.stderr + result.stdout);
  assert.match(
    readFileSync(join(folder, "reports/mutation/search-reading/run.log"), "utf8"),
    /FIXTURE_MUTATION_FAILURE/,
  );
});

test("every workflow browser install uses the bounded installer", () => {
  for (const workflow of WORKFLOWS)
    assert.doesNotMatch(
      readRepoFile(`.github/workflows/${workflow}`),
      /(?:npx playwright|node_modules\/.*playwright.*cli\.js) install\b/,
      workflow,
    );
  for (const workflow of ["ci.yml", "flaky.yml", "deploy.yml", "watch.yml"])
    assert.match(
      readRepoFile(`.github/workflows/${workflow}`),
      /node worker\/install-browsers\.mjs /,
      workflow,
    );
});

// An image holds only the browsers its own Playwright version runs, and Dependabot moves the
// lockfile's Playwright without it, so each job installs its browsers from the installed one.
test("no workflow runs its browsers from an image that pins Playwright's version", () => {
  for (const workflow of WORKFLOWS)
    assert.doesNotMatch(
      readRepoFile(`.github/workflows/${workflow}`),
      /mcr\.microsoft\.com\/playwright/,
      workflow,
    );
});

// The config stops CI's runs after a few failures, but the nightly run names every test that
// failed in the issue Flaky browser tests.
test("the nightly run of the browser tests runs every test however many fail", () => {
  assert.match(readRepoFile(".github/workflows/flaky.yml"), /--max-failures=0\b/);
});

test("the nightly browser install has a step timeout that leaves time for the tests", () => {
  const browser = readJob("browser", "flaky.yml");
  const install = browser
    .split(/^ {6}- /m)
    .find((step) => /run: node worker\/install-browsers\.mjs\b/.test(step));
  assert.ok(install, "the nightly job installs its browsers");
  const timeout = Number(install.match(/\btimeout-minutes: (\d+)/)?.[1]);
  const jobTimeout = Number(browser.match(/^ {4}timeout-minutes: (\d+)/m)?.[1]);
  const budget = MAX_ATTEMPTS * (ATTEMPT_TIMEOUT_MS + CLEANUP_GRACE_MS + CLEANUP_TIMEOUT_MS);
  assert.ok(timeout * 60000 > budget, "the workflow allows all bounded attempts and cleanup");
  assert.ok(timeout < jobTimeout, "the tests keep their own time after installation");
});

test("the nightly run's report can start the routine that fixes flaky tests", () => {
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  assert.match(workflow, /FLAKY_ROUTINE_URL: \$\{\{ secrets\.FLAKY_ROUTINE_URL \}\}/);
  assert.match(workflow, /FLAKY_ROUTINE_TOKEN: \$\{\{ secrets\.FLAKY_ROUTINE_TOKEN \}\}/);
});

// Each report reads the issue's table and writes it back, so two at once would lose one's runs.
test("only the nightly run writes the issue Flaky browser tests, from main's code, reading CI's runs it can list", () => {
  const writers = WORKFLOWS.filter((workflow) =>
    /node worker\/report-flaky-tests\.mjs|FLAKY_ROUTINE_TOKEN/.test(
      readRepoFile(`.github/workflows/${workflow}`),
    ),
  );
  assert.deepEqual(writers, ["flaky.yml"]);
  assert.doesNotMatch(readRepoFile(".github/workflows/ci.yml"), /issues: write/);
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  assert.doesNotMatch(workflow.split(/^jobs:$/m)[0], /issues: write/);
  const report = readJob("report", "flaky.yml");
  assert.match(
    report,
    /if: \$\{\{ !cancelled\(\) && github\.event_name == 'schedule' && needs\.browser\.outputs\.report-artifact != '' \}\}/,
  );
  assert.match(report, /permissions:\n\s+contents: read\n\s+actions: read\n\s+issues: write/);
  assert.match(report, /run: node worker\/report-flaky-tests\.mjs nightly-report\/report\.json/);
  assert.match(report, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(report, /\bref:/);
});

/**
 * A workflow's jobs, ci.yml's unless it names another, by the names they're keyed under.
 * @param {string} [workflow]
 * @returns {string[]}
 */
const listJobs = (workflow = "ci.yml") => {
  const jobs = readRepoFile(`.github/workflows/${workflow}`).split(/^jobs:$/m)[1] ?? "";
  return [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map(([, job]) => job);
};

/**
 * One job of a workflow, ci.yml unless it names another, from its key to the next job.
 * @param {string} job
 * @param {string} [workflow]
 */
const readJob = (job, workflow = "ci.yml") =>
  readRepoFile(`.github/workflows/${workflow}`).match(
    new RegExp(`^ {2}${job}:\\n(?:(?: {4}.*)?\\n)*`, "m"),
  )?.[0] ?? "";

/**
 * The jobs a job needs, however its needs are written, a long list a line each too.
 * @param {string} job
 * @param {string} [workflow]
 */
const readNeeds = (job, workflow = "ci.yml") =>
  (readJob(job, workflow).match(/^ {4}needs:\s*(\[[^\]]*\]|\S+)/m)?.[1] ?? "")
    .replace(/[[\]\s]/g, "")
    .split(",")
    .filter(Boolean);

// check is the one job a merge waits on, so a job it doesn't need could fail without stopping
// one. caches only costs pull requests their cache when it fails.
test("the check job needs every other job but caches", () => {
  const others = listJobs().filter((job) => !["check", "caches"].includes(job));
  assert.deepEqual(readNeeds("check").toSorted(), others.toSorted());
});

// The config leaves out the WebKit projects wherever WebKit isn't installed, so a job that stopped
// installing it would skip its WebKit specs and still pass.
test("each job that runs WebKit specs installs WebKit with its system libraries", () => {
  for (const [job, workflow] of [
    ["burn-in", "ci.yml"],
    ["webkit", "ci.yml"],
  ])
    assert.match(
      readJob(job, workflow),
      /run: node worker\/install-browsers\.mjs --with-deps .*\bwebkit\b/,
      `${workflow}: ${job}`,
    );
  const condition = WEBKIT_TEST_MATCH.map(
    (spec) => `contains(needs.scope.outputs.specs, '${spec}')`,
  ).join(" || ");
  assert.match(
    readJob("burn-in"),
    new RegExp(
      `- if: ${escapePattern(condition)}\\n\\s+run: node worker/install-browsers.mjs --with-deps webkit\\n`,
    ),
    "burn-in installs WebKit whenever a spec the config's WebKit projects run is among the ones it repeats",
  );
});

test("scope installs the parser dependencies before selecting helper-declared tests", () => {
  const scope = readJob("scope");
  assert.match(scope, /- \*restore-modules\n\s+- \*install-modules/);
  assert.ok(scope.indexOf("*install-modules") < scope.indexOf("node worker/burn-in-specs.mjs"));
});

test("repeat setup selects browsers from the same unexpanded inputs as the tests", () => {
  const browser = readJob("browser", "flaky.yml");
  const install = browser
    .split(/^ {6}- /m)
    .find((step) => /run: node worker\/install-browsers\.mjs\b/.test(step));
  assert.ok(install);
  assert.match(install, /--with-deps --only-shell \$\{\{ steps\.browsers\.outputs\.browsers \}\}/);
  const selection = browser.split(/^ {6}- /m).find((step) => /^id: browsers\n/.test(step));
  assert.ok(selection);
  assert.match(selection, /TESTS: \$\{\{ inputs\.tests \}\}/);
  assert.match(selection, /PROJECT: \$\{\{ inputs\.project \}\}/);
  assert.match(selection, /run: node tests\/browser\/projects\.mjs/);
});

test("nightly setup failures retain their failure without a missing-report download", () => {
  const browser = readJob("browser", "flaky.yml");
  const upload = browser.split(/^ {6}- /m).find((step) => /id: nightly-report/.test(step));
  assert.ok(upload);
  assert.match(
    upload,
    /if: \$\{\{ !cancelled\(\) && github\.event_name == 'schedule' && hashFiles\('test-results\/report\.json'\) != '' \}\}/,
  );
  assert.match(browser, /report-artifact: \$\{\{ steps\.nightly-report\.outputs\.artifact-id \}\}/);
  const report = readJob("report", "flaky.yml");
  assert.match(report, /needs\.browser\.outputs\.report-artifact != ''/);
});

// A cache saved with WebKit in it would have the browser job, whose machines lack WebKit's system
// libraries, run the WebKit projects, so only the jobs that install Chromium alone save it.
test("no job that installs WebKit saves the browsers' cache", () => {
  for (const job of ["burn-in", "webkit"])
    assert.doesNotMatch(readJob(job), /uses: actions\/cache(?:\/save)?@/, job);
});

// A Node test's failure is read from the end of the job's log, which a session reaches only so
// far back into.
test("each Node test step prints its failures at the end of the run", () => {
  const steps = [...readJob("checks").matchAll(/^ {6}- name: Test.*\n(?:(?: {8}.*)?\n)*/gm)].map(
    ([step]) => step,
  );
  assert.equal(steps.length, 2);
  for (const step of steps)
    assert.match(step, /NODE_OPTIONS: --test-reporter=dot|run: node worker\/test-time-zone\.mjs/);
});

test("CI always runs the complete ordinary-zone suite and scopes only its alternate-zone repeat", () => {
  const checks = readJob("checks");
  assert.match(
    checks,
    /- name: Test\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+env:\n\s+NODE_OPTIONS: --test-reporter=dot\n\s+TZ: UTC\n\s+run: npm test\n/,
  );
  assert.match(
    checks,
    /- name: Test in another time zone\n\s+if: \$\{\{ !cancelled\(\) \}\}\n\s+run: node worker\/test-time-zone\.mjs --changed\n/,
  );
});

test("only the nightly run repeats the focused Honolulu Node list", () => {
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  assert.match(workflow, /schedule:\n\s+- cron:/);
  assert.match(workflow, /workflow_dispatch:/);
  const node = readJob("node", "flaky.yml");
  assert.ok(node);
  assert.match(node, /^ {4}if: github.event_name == 'schedule'$/m);
  assert.doesNotMatch(node, /^ {4}needs:/m);
  assert.doesNotMatch(node, /inputs\.ref/);
  assert.match(node, /node-version-file: \.nvmrc/);
  assert.match(node, /run: npm ci\n/);
  assert.match(node, /run: node worker\/test-time-zone\.mjs\n/);
  assert.doesNotMatch(node, /--full|run: npm test/);
  assert.match(node, /path: node_modules/);
  assert.match(node, /if: steps\.modules\.outputs\.cache-hit != 'true'/);
});

test("manual runs test the workflow's own ref instead of checking out code into main's context", () => {
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  assert.doesNotMatch(workflow, /inputs\.ref|^\s+ref:/m);
  assert.match(workflow, /format\('Repeat \{0\} on \{1\}', inputs\.tests, github\.ref_name\)/);
  for (const job of ["node", "browser", "report"])
    assert.match(readJob(job, "flaky.yml"), /uses: actions\/checkout@/);
});

test("manual browser runs never restore or save dependency caches", () => {
  const workflow = readRepoFile(".github/workflows/flaky.yml");
  const browser = readJob("browser", "flaky.yml");
  const steps = browser.split(/^ {6}- /m).slice(1);
  const caches = steps.filter((step) => /uses: actions\/cache(?:\/(?:restore|save))?@/.test(step));
  assert.equal(caches.length, 1);
  assert.match(caches[0], /^ {8}if: github\.event_name == 'schedule'$/m);
  const setup = steps.find((step) => /uses: actions\/setup-node@/.test(step));
  assert.ok(setup);
  assert.equal(readStepInput(workflow, setup, "package-manager-cache"), "false");
  assert.equal(readStepInput(workflow, setup, "cache"), "");
});

test("manual browser runs always install dependencies while nightly cache hits skip installation", () => {
  const browser = readJob("browser", "flaky.yml");
  const installs = browser.split(/^ {6}- /m).filter((step) => /run: npm ci\n/.test(step));
  assert.equal(installs.length, 1);
  assert.match(installs[0], /^if: steps\.modules\.outputs\.cache-hit != 'true'\n/);
});

test("dependency caches share a fresh key without falling back to the old cache", () => {
  const expected =
    "node-modules-v2-${{ runner.os }}-${{ steps.node.outputs.node-version }}-${{ hashFiles('package-lock.json') }}";
  const workflows = ["ci.yml", "flaky.yml"].map((name) =>
    readRepoFile(`.github/workflows/${name}`),
  );
  const keys = workflows.flatMap((workflow) =>
    [...workflow.matchAll(/^ {10}key: (?:&modules-key )?(node-modules-.*)$/gm)].map(
      ([, key]) => key,
    ),
  );
  assert.deepEqual(keys, [expected, expected, expected]);
  for (const workflow of workflows) assert.doesNotMatch(workflow, /restore-keys:/);
});

test("the browser job's traces leave out the page at each step, which burn-in's keep", () => {
  assert.match(readJob("browser"), /TRACE_SNAPSHOTS: "off"/);
  assert.doesNotMatch(readJob("burn-in"), /TRACE_SNAPSHOTS/);
});

test("burn-in runs every test ten times however many fail, and fails only on a test the pull request wrote or edited", () => {
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /--repeat-each=10 --retries=0 --max-failures=0/);
  assert.match(burnIn, /git diff -U0 --no-renames HEAD\^1 HEAD \| node worker\/judge-burn-in\.mjs/);
  assert.match(burnIn, /name: burn-in-flaky-/);
});

// Burn-in's machines start only for a pull request with a browser spec to repeat, and check
// requires them to pass then.
test("burn-in runs only when a pull request has a browser spec to repeat, and check requires it then", () => {
  const scope = readJob("scope");
  assert.match(scope, /run: node worker\/burn-in-specs\.mjs/);
  assert.match(scope, /fetch-depth: 0/);
  assert.match(scope, /actions: read/);
  assert.match(scope, /BRANCH: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
  assert.doesNotMatch(
    scope,
    /HEAD_SHA/,
    "an earlier run's burn-in on this same head counts, so the head isn't handed in to skip",
  );
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /needs: scope/);
  assert.match(
    burnIn,
    /if: .*needs\.scope\.result == 'success' && needs\.scope\.outputs\.specs != ''/,
  );
  assert.match(burnIn, /SPECS: \$\{\{ needs\.scope\.outputs\.specs \}\}/);
  assert.match(
    readJob("tested"),
    /\(needs\.scope\.outputs\.specs == '' \|\| needs\.burn-in\.result == 'success'\)/,
  );
});

// The browser tests run only for the apps the change reaches, and check requires them then.
test("the browser and WebKit jobs run only the apps the change reaches, and check requires them then", () => {
  assert.match(
    readJob("scope"),
    /shell: bash\n\s+run: git diff --name-only --no-renames HEAD\^1 HEAD \| node worker\/browser-scope\.mjs/,
  );
  for (const [job, project] of [
    ["browser", '"$app"'],
    ["webkit", '"$app-webkit"'],
  ]) {
    const text = readJob(job);
    assert.match(text, /needs: \[passed, scope\]/, job);
    assert.match(text, /if: .* && needs\.scope\.outputs\.apps != '' \}\}/, job);
    assert.match(text, /APPS: \$\{\{ needs\.scope\.outputs\.apps \}\}/, job);
    assert.ok(text.includes(`for app in $APPS; do projects+=(--project ${project}); done`), job);
    assert.match(text, /npm run test:browser -- .*"\$\{projects\[@\]\}"/, job);
  }
  assert.match(
    readJob("tested"),
    /\(needs\.scope\.outputs\.apps == '' \|\| \(needs\.browser\.result == 'success' &&\n\s+needs\.webkit\.result == 'success'\)\)/,
  );
});

// The phone status's name, set once for the workflow.
const PHONE_CONTEXT =
  readRepoFile(".github/workflows/ci.yml").match(/^env:\n {2}PHONE_CONTEXT: (\S+)$/m)?.[1] ?? "";

// A held red change waits on the phone status, set on every pull request from this repository
// whose gate ran by a job that runs none of the pull request's code since only it can set a
// status, and check holds the change itself whenever main's rules don't require that status, from
// a lookup in the workflow rather than the pull request's code, or the pull request comes from a
// fork, and never records it as passed for main to deploy at once.
test("a held red change waits on the phone status, and check holds it whenever main's rules don't, or it comes from a fork", () => {
  assert.equal(PHONE_CONTEXT, EXPECTED_PHONE_CONTEXT);
  assert.match(readJob("gate"), /held: \$\{\{ steps\.hold\.outputs\.held \}\}/);
  assert.match(
    readJob("gate"),
    /forked: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name != github\.repository \}\}/,
    "the gate says once whether a pull request comes from a fork, for phone and check both",
  );
  assert.equal(
    [...readRepoFile(".github/workflows/ci.yml").matchAll(/head\.repo\.full_name/g)].length,
    1,
  );
  const phone = readJob("phone");
  assert.match(
    phone,
    /needs: gate\n\s+if: \$\{\{ !cancelled\(\) && needs\.gate\.result == 'success' && needs\.gate\.outputs\.forked != 'true' \}\}\n/,
    "phone runs on every pull request from this repository, whose token can post the status",
  );
  assert.match(phone, /permissions:\n\s+statuses: write\n\s+steps:/);
  assert.doesNotMatch(phone, /actions\/checkout|node /);
  assert.ok(phone.includes('-f context="$PHONE_CONTEXT" '));
  assert.match(
    phone,
    /STATE: \$\{\{ needs\.gate\.outputs\.held == 'true' && 'pending' \|\| 'success' \}\}/,
  );
  const writers = listJobs().filter((job) => /statuses: write/.test(readJob(job)));
  assert.deepEqual(writers, ["phone"]);
  const check = readJob("check");
  assert.doesNotMatch(check, /node worker\//);
  assert.match(
    check,
    /id: phone\n\s+if: needs\.gate\.outputs\.held == 'true'\n[\s\S]*required=\$\(gh api "repos\/\$REPO\/rules\/branches\/main" --jq '[^']*\$ENV\.PHONE_CONTEXT[^']*'\)\n\s+.*\n\s+echo "required=\$required" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    check,
    /\(needs\.gate\.outputs\.held == 'true' && \(steps\.phone\.outputs\.required != 'true' \|\|\n\s+needs\.gate\.outputs\.forked == 'true'\)\)\n\s+run: exit 1/,
    "check holds a red change itself where main's rules don't require phone, or a fork can't post it",
  );
  assert.match(
    check,
    /if: >-\n\s+github\.event_name == 'pull_request' && needs\.gate\.outputs\.held != 'true' &&\n\s+needs\.review-join\.outputs\.owed == 'false' && needs\.review-join\.result == 'success'\n\s+with:\n\s+name: ci-passed-/,
  );
});

/**
 * What check's filter of main's rules says of a ruleset, run with jq as gh runs it.
 * @param {object[]} rules
 */
function readPhoneRequired(rules) {
  const filter = readJob("check").match(/rules\/branches\/main" --jq '([^']*)'/)?.[1] ?? "";
  const { stdout, status, stderr } = spawnSync("jq", [filter], {
    input: JSON.stringify(rules),
    encoding: "utf8",
    env: { ...process.env, PHONE_CONTEXT },
  });
  assert.equal(status, 0, stderr);
  return stdout.trim();
}

/** @param {string[]} contexts */
const requireChecks = (...contexts) => ({
  type: "required_status_checks",
  parameters: { required_status_checks: contexts.map((context) => ({ context })) },
});

test("check's filter of main's rules finds the phone status only where they require it", () => {
  assert.equal(
    readPhoneRequired([{ type: "deletion" }, requireChecks("check", PHONE_CONTEXT)]),
    "true",
  );
  assert.equal(readPhoneRequired([requireChecks("check")]), "false");
  assert.equal(readPhoneRequired([{ type: "required_status_checks", parameters: {} }]), "false");
  assert.equal(readPhoneRequired([]), "false");
});

// A pull request that changes the gate's code would otherwise judge its own change, so the base's
// copy, on the Node and modules the base names, reads the pull request's files from its checkout,
// from a diff that shows every file's text whatever .gitattributes says. A pull request's own run
// can save a cache its later runs restore first, so no job caches the base's modules.
test("the gate judges a pull request with the base's own gate, Node, and modules", () => {
  const gate = readJob("gate");
  const worktree = gate.indexOf('run: git worktree add "$RUNNER_TEMP/base" HEAD^1\n');
  const node = gate.indexOf("node-version-file: ${{ runner.temp }}/base/.nvmrc\n");
  assert.ok(
    worktree !== -1 && node > worktree,
    "Node from the base's .nvmrc, once it's checked out",
  );
  assert.doesNotMatch(gate, /\*setup-node|\*restore-modules|\*install-modules|node worker\//);
  assert.match(
    gate,
    /- name: Install the base's modules\n\s+working-directory: \$\{\{ runner\.temp \}\}\/base\n\s+run: npm ci --ignore-scripts --no-audit\n/,
  );
  assert.doesNotMatch(gate, /actions\/cache/);
  for (const workflow of WORKFLOWS)
    assert.doesNotMatch(
      readRepoFile(`.github/workflows/${workflow}`),
      /path: .*base\/node_modules/,
      workflow,
    );
  assert.ok(
    gate.includes(
      'run: git diff --text --no-textconv --no-ext-diff --no-renames HEAD^1 HEAD | node "$RUNNER_TEMP/base/worker/red-change.mjs" "$LABELS"\n',
    ),
  );
  assert.doesNotMatch(gate, /held=false/);
});

/**
 * A job's condition, the anchored one it names when it names one.
 * @param {string} condition
 * @param {string} workflow
 */
const readCondition = (condition, workflow) =>
  condition.startsWith("*")
    ? (readRepoFile(`.github/workflows/${workflow}`).match(
        new RegExp(`&${condition.slice(1)} (.*)$`, "m"),
      )?.[1] ?? "")
    : condition;

// GitHub skips a job once any job before it in its chain of needs was skipped, as passed is on
// every push to a pull request, unless its condition checks the run's status itself.
test("each job that needs another runs even when one before it was skipped", () => {
  for (const workflow of ["ci.yml", AREA_WORKFLOW]) {
    const skippedWithTheirChain = listJobs(workflow).filter((job) => {
      const text = readJob(job, workflow);
      const condition = readCondition(text.match(/^ {4}if: (.*)$/m)?.[1] ?? "success()", workflow);
      return /^ {4}needs:/m.test(text) && !/!cancelled\(\)|always\(\)/.test(condition);
    });
    assert.deepEqual(skippedWithTheirChain, [], workflow);
  }
});

// GitHub refuses a pull request's diff past 20,000 lines, and git lists a change of any size.
test("the title is checked against the files git lists against the base branch", () => {
  const checks = readJob("checks");
  assert.match(checks, /uses: actions\/checkout@\S+ # v7\n\s+with:\n\s+fetch-depth: 2/);
  assert.match(
    checks,
    /run: git diff --name-only --no-renames HEAD\^1 HEAD \| node worker\/check-pr-title\.mjs/,
  );
  assert.doesNotMatch(checks, /gh pr diff/);
});

// None of the workflows push, so none leaves git a token on disk for the code it runs to read.
test("every checkout leaves no credentials behind", () => {
  for (const workflow of WORKFLOWS) {
    const text = readRepoFile(`.github/workflows/${workflow}`);
    const checkouts = [...text.matchAll(/uses: actions\/checkout@.*\n((?: {8,}.*\n)*)/g)];
    for (const [, settings] of checkouts)
      assert.match(settings, /persist-credentials: false/, `${workflow}: ${settings}`);
  }
});

// A label change, like adding phone-ok, brings no new code: once a run passed every test on
// exactly this code, the tests are skipped. The label waits for a run still going rather than
// stopping it, while a separate record decides whether a review is still owed.
test("a label change skips tests once a run passed every test on the same code", () => {
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
  assert.match(readJob("scope"), /needs: passed\n.*!needs\.passed\.outputs\.run/);
  const tested = readJob("tested");
  assert.match(
    tested,
    /if: github\.event_name == 'pull_request' && steps\.tests\.outputs\.tested == 'true'\n.*\n\s+name: ci-tested-/,
  );
  assert.match(readJob("check"), /TESTED: \$\{\{ needs\.tested\.outputs\.tested == 'true' \}\}/);
});

test("only validated trusted review can satisfy the CI review gate", () => {
  const plan = readJob("review-join");
  assert.match(plan, /pull-requests: read/);
  assert.match(
    plan,
    /owed: \$\{\{ steps.find.outputs.owed \|\| steps.decision.outputs.owed \|\| 'true' \}\}/,
  );
  assert.doesNotMatch(plan, /merge_commit_sha/);
  assert.match(plan, /run: node worker\/find-trusted-review.mjs/);
  assert.match(plan, /run: node worker\/find-trusted-review.mjs verify/);
  assert.match(plan, /run-id: \$\{\{ steps.find.outputs.run \}\}/);
  assert.match(plan, /tree: \$\{\{ steps.verify.outputs.tree \}\}/);
  assert.match(plan, /REVIEW_TRUSTED: \$\{\{ steps.find.outputs.source \}\}/);
  assert.doesNotMatch(
    readRepoFile(".github/workflows/ci.yml"),
    /CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|anthropics\//,
  );
  assert.match(
    readJob("check"),
    /needs.review-join.outputs.owed == 'false' && needs.review-join.result == 'success'/,
  );
});

test("CI's recovery message names the label Trusted review actually consumes", () => {
  const label = (workflow) =>
    readRepoFile(`.github/workflows/${workflow}`).match(/^ {2}REVIEW_LABEL: (\S+)$/m)?.[1];
  assert.ok(label(REVIEW_WORKFLOW));
  assert.equal(label("ci.yml"), label(REVIEW_WORKFLOW));
});

test("check rejects a joined tree different from its recorded code before publishing passing evidence", () => {
  const check = readJob("check");
  assert.match(check, /JOINED_TREE: \$\{\{ needs.review-join.outputs.tree \}\}/);
  assert.match(check, /RECORDED_TREE: \$\{\{ steps.code.outputs.tree \}\}/);
  assert.match(check, /github.event.pull_request.user.login != 'dependabot\[bot\]'/);
  assert.ok(
    check.indexOf("Require the recorded code to match trusted review") <
      check.indexOf("name: ci-passed-"),
  );
  const script = readStepScript(
    readRepoFile(".github/workflows/ci.yml"),
    "Require the recorded code to match trusted review",
  );
  for (const [joined, recorded, status] of [
    ["a", "a", 0],
    ["a", "b", 1],
    ["", "", 1],
  ]) {
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: { JOINED_TREE: String(joined), RECORDED_TREE: String(recorded) },
      encoding: "utf8",
    });
    assert.equal(result.status, status);
  }
});

test("the read-only join holds drafts and ready PRs without borrowing test evidence", () => {
  const script = readStepScript(
    readRepoFile(".github/workflows/ci.yml"),
    "Decide whether to join trusted review",
  );
  for (const [event, expected] of [
    [{ EVENT: "push" }, { review: "false", owed: "false" }],
    [
      { EVENT: "pull_request", AUTHOR: "dependabot[bot]" },
      { review: "false", owed: "false" },
    ],
    [
      { EVENT: "pull_request", IS_DRAFT: "true" },
      { review: "false", owed: "true" },
    ],
    [
      { EVENT: "pull_request", IS_DRAFT: "false" },
      { review: "true", owed: "true" },
    ],
  ]) {
    const output = join(mkdtempSync(join(tmpdir(), "review-join-")), "output");
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...event },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const fields = Object.fromEntries(
      readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    assert.deepEqual(fields, expected);
  }
});

// A ready pull request merges only once a review passed on exactly its code: a push, or a label
// like phone-ok after a review that failed, never turns its check green without one. A draft is
// reviewed once it's ready, so its check passes without one.
test("check fails a ready pull request while a review of its code is owed", () => {
  const check = readJob("check");
  assert.match(
    check,
    /- name: Require a review of this code\n\s+if: needs\.review-join\.outputs\.owed == 'true' && !github\.event\.pull_request\.draft\n\s+run: \|\n\s+echo "::error::.*\$REVIEW_LABEL.*"\n\s+exit 1\n/,
  );
  assert.ok(
    check.indexOf("Require a review of this code") < check.indexOf("name: ci-passed-"),
    "code a review is owed on never deploys at once from main",
  );
});

/**
 * What Trusted review's decision says for an event, by running its own script.
 * @param {Record<string, string>} event the step's env, over a ready pull request's
 */
function decideReview(event) {
  const script = readStepScript(
    readRepoFile(".github/workflows/review.yml"),
    "Decide whether to review",
  );
  const outputs = mkdtempSync(join(tmpdir(), "ci-decision-"));
  const output = join(outputs, "output");
  writeFileSync(output, "");
  const env = {
    PATH: process.env.PATH,
    GITHUB_OUTPUT: output,
    REVIEW_LABEL: readRepoFile(".github/workflows/review.yml").match(/REVIEW_LABEL: (\S+)/)?.[1],
    EVENT: "pull_request_target",
    ACTION: "opened",
    LABEL: "",
    IS_DRAFT: "false",
    AUTHOR: "someone",
    ASSOCIATION: "OWNER",
    HEAD_REPOSITORY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "token",
    ANTHROPIC_API_KEY: "",
    ...event,
  };
  const { status, stdout, stderr } = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    env: createReviewDecisionEnvironment(env),
  });
  assert.equal(status, 0, stderr);
  const written = Object.fromEntries(
    readFileSync(output, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
  return {
    review: written.review,
    owed: written.owed,
    labeled: written.labeled,
    notice: stdout.trim(),
  };
}

// A pull request is reviewed once it's ready, and again only when the review label asks, never on
// a push alone, so a session answers every finding in one push and then asks. A run that skips a
// review it was never asked for still owes one.
test("a pull request is reviewed when it's opened ready, marked ready, or labeled review, and on nothing else", () => {
  for (const [event, labeled] of /** @type {[Record<string, string>, string][]} */ ([
    [{ ACTION: "opened" }, "false"],
    [{ ACTION: "ready_for_review" }, "false"],
    [{ ACTION: "labeled", LABEL: "review" }, "true"],
  ]))
    assert.deepEqual(
      decideReview(event),
      { review: "true", owed: "false", labeled, notice: "" },
      JSON.stringify(event),
    );
  for (const event of [
    { ACTION: "synchronize" },
    { ACTION: "reopened" },
    { ACTION: "labeled", LABEL: "phone-ok" },
    { ACTION: "labeled", LABEL: "reviewed" },
    { ACTION: "unlabeled", LABEL: "review" },
  ]) {
    const { review, owed, labeled, notice } = decideReview(event);
    assert.equal(review, "false", JSON.stringify(event));
    assert.equal(owed, "true", JSON.stringify(event));
    assert.equal(labeled, "false", JSON.stringify(event));
    assert.match(notice, /^::notice::Nothing was reviewed: there is no authorized review request/);
  }
  assert.equal(decideReview({ EVENT: "push", ACTION: "" }).review, "false");
});

test("native run metadata supplies the planner's only request decision", () => {
  const workflow = readRepoFile(".github/workflows/review.yml");
  assert.match(workflow, /^run-name: &review-name /m);
  assert.match(readJob("review-plan", REVIEW_WORKFLOW), /REVIEW_RUN_NAME: \*review-name/);
  assert.doesNotMatch(
    readStepScript(workflow, "Decide whether to review"),
    /ASSOCIATION|HEAD_REPOSITORY|asked=/,
  );
  const label = workflow.match(/REVIEW_LABEL: (\S+)/)?.[1];
  assert.ok(workflow.includes(`github.event.label.name == '${label}'`));
  assert.equal(
    decideReview({ ASSOCIATION: "NONE", HEAD_REPOSITORY: "example/repository" }).review,
    "true",
  );
  assert.equal(
    decideReview({ ASSOCIATION: "NONE", HEAD_REPOSITORY: "example/fork" }).review,
    "false",
  );
});

test("long base refs keep native review metadata bounded", () => {
  const state = { ACTION: "opened", ASSOCIATION: "OWNER", AUTHOR: "example" };
  const main = readNativeReviewName({ ...state, BASE_REF: "main" });
  const other = readNativeReviewName({ ...state, BASE_REF: "x".repeat(255) });
  assert.match(main, /target main intent review$/);
  assert.match(other, /target other intent review$/);
  assert.equal(other.length, main.length + 1);
  assert.ok(other.length < 200);
});

test("every reason not to review holds when the review is asked for", () => {
  for (const [event, reason, owed] of /** @type {[Record<string, string>, RegExp, string][]} */ ([
    [{ IS_DRAFT: "true" }, /a draft is reviewed once it's ready/, "true"],
    [{ AUTHOR: "dependabot[bot]" }, /Dependabot/, "false"],
  ])) {
    const asked = decideReview({ ACTION: "labeled", LABEL: "review", ...event });
    assert.equal(asked.review, "false", JSON.stringify(event));
    assert.equal(asked.owed, owed, JSON.stringify(event));
    assert.equal(asked.labeled, "true", "a label that asks comes off however the run decides");
    assert.match(asked.notice, reason);
  }
});

test("reusing tests never bypasses the authenticated trusted review join", () => {
  const plan = readJob("review-join");
  assert.doesNotMatch(plan, /needs\.passed\.outputs\.run\b/);
  assert.match(plan, /permissions:\n\s+contents: read\n\s+actions: read/);
  assert.match(plan, /path: \$\{\{ runner.temp \}\}\/trusted-review-result\//);
  assert.doesNotMatch(plan, /secrets\.|pull-requests: write|anthropics\//);
});

test("the tests-only record depends only on test jobs, even when review fails or is owed", () => {
  const tested = readJob("tested");
  assert.deepEqual(readNeeds("tested"), [
    "passed",
    "checks",
    "scope",
    "browser",
    "burn-in",
    "webkit",
  ]);
  assert.doesNotMatch(tested, /review|gate/);
  for (const job of ["checks", "scope", "browser", "webkit", "burn-in"])
    assert.ok(tested.includes(`needs.${job}.result`), job);
  assert.match(tested, /name: ci-tested-\$\{\{ steps\.code\.outputs\.tree \}\}/);
  assert.match(tested, /tested: \$\{\{ steps\.tests\.outputs\.tested \}\}/);
});

test("the trusted workflow removes a requested review label only after a successful plan", () => {
  const label = readJob("review-label", REVIEW_WORKFLOW);
  assert.deepEqual(readNeeds("review-label", REVIEW_WORKFLOW), ["review-plan"]);
  assert.ok(label.includes("needs.review-plan.result == 'success'"));
  assert.match(label, /gh api --method DELETE/);
  assert.doesNotMatch(label, /checkout|node /);
});

test("trusted review preserves complete area reading, retries, and the across-area check", () => {
  const plan = readJob("review-plan", REVIEW_WORKFLOW);
  assert.match(plan, /trusted-review.mjs" plan/);
  assert.deepEqual(listJobs(AREA_WORKFLOW), ["find"]);
  const find = readJob("find", AREA_WORKFLOW);
  assert.doesNotMatch(find, /matrix/);
  assert.match(find, /--model claude-opus-5-5/);
  assert.match(find, /--max-turns 150/);
  assert.match(find, /disableAllHooks/);
  assert.match(find, /trusted-review.mjs" find "\$AREA"/);
  assert.ok(
    find.includes("steps.first.outputs.unread != '' || steps.first.outputs.answered != 'true'"),
  );
  assert.match(find, /id: last\n\s+if: \*retry-due/);
  assert.ok(
    find.includes("steps.last.outputs.unread != '' || steps.last.outputs.answered == 'false'"),
  );
  assert.ok(find.includes("Its answer is kept, so judge only what those files change."));
  assert.ok(
    find.includes(
      "judge your area's whole diff against each rule file the earlier try left unread",
    ),
  );
  const across = readJob("review-across", REVIEW_WORKFLOW);
  assert.match(across, /--model claude-opus-5-5/);
  assert.match(across, /--max-turns 200/);
  assert.match(across, /trusted-review.mjs" candidates/);
  assert.match(across, /trusted-review.mjs" across/);
  assert.ok(
    across.includes("steps.keep.outcome != 'success' || steps.keep.outputs.unchecked != '0'"),
  );
  const review = readJob("review", REVIEW_WORKFLOW);
  assert.deepEqual(readNeeds("review", REVIEW_WORKFLOW), [
    "review-plan",
    "review-area",
    "review-across",
    "review-codex",
    "review-codex-across",
    "review-post",
  ]);
  assert.match(review, /trusted-review.mjs" summary/);
  assert.ok(review.includes("needs.review-plan.result != 'success'"));
});

test("trusted review has one reviewer an area and one across-area check", () => {
  const across = readJob("review-across", REVIEW_WORKFLOW);
  assert.equal(across.match(/anthropics\/claude-code-action/g)?.length, 1);
  const find = readJob("find", AREA_WORKFLOW);
  assert.equal(find.match(/anthropics\/claude-code-action/g)?.length, 2);
  assert.ok(find.includes('for every item in the guide\'s "What to look for"'));
  assert.match(readRepoFile("REVIEW.md"), /^## What to look for$/m);
});

test("the trusted planner hands each area's declared inputs to its reviewer", () => {
  const plan = readJob("review-plan", REVIEW_WORKFLOW);
  const written = [
    "stage",
    ...formatJobOutputs(listPlanJobs([{ area: 1, name: "docs" }])).split("\n"),
  ].map((line) => line.replace(/=.*$/, ""));
  for (const output of written)
    assert.ok(plan.includes(`      ${output}: \${{ steps.plan.outputs.${output} }}`), output);
  const caller = readJob("review-area", REVIEW_WORKFLOW);
  assert.match(caller, /uses: \.\/\.github\/workflows\/trusted-review-area\.yml/);
  const inputs = readRepoFile(`.github/workflows/${AREA_WORKFLOW}`)
    .split(/^ {4}inputs:$/m)[1]
    .split(/^ {4}secrets:$/m)[0];
  const declared = [...inputs.matchAll(/^ {6}([a-z-]+):$/gm)].map(([, input]) => input);
  const given = [...caller.split(/^ {4}with:$/m)[1].matchAll(/^ {6}([a-z-]+): /gm)].map(
    ([, input]) => input,
  );
  assert.deepEqual(given.toSorted(), declared.toSorted());
  assert.ok(caller.includes("include: ${{ fromJSON(needs.review-plan.outputs.areas || '[]') }}"));
  assert.match(caller, /CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
});

test("only trusted posting jobs can write to the pull request", () => {
  const writers = listJobs(REVIEW_WORKFLOW).filter((job) =>
    /pull-requests: write/.test(readJob(job, REVIEW_WORKFLOW)),
  );
  assert.deepEqual(writers.toSorted(), ["review", "review-label", "review-post", "review-select"]);
  for (const job of writers)
    assert.doesNotMatch(readJob(job, REVIEW_WORKFLOW), /claude-code-action|codex-action/);
  for (const job of listJobs())
    assert.doesNotMatch(readJob(job), /pull-requests: write|claude-code-action/);
  const withClaude = [
    ...listJobs(REVIEW_WORKFLOW).map((job) => readJob(job, REVIEW_WORKFLOW)),
    readJob("find", AREA_WORKFLOW),
  ].filter((job) => /anthropics\/|uses: \.\/\.github/.test(job));
  assert.equal(withClaude.length, 7);
  for (const job of withClaude) assert.doesNotMatch(job, /pull-requests: write/);
});

/**
 * Each step that runs Claude in the named workflows, with the workflow's name and text.
 * @param {string[]} names
 */
const listClaudeSteps = (names) =>
  names.flatMap((name) => {
    const workflow = readRepoFile(`.github/workflows/${name}`);
    return workflow
      .split(/^ {6}- /m)
      .filter((step) => /uses: anthropics\/claude-code-action@/.test(step))
      .map((step) => ({ name, workflow, step }));
  });

// The repo is public, so transcripts stay out of logs. Read reaches only the checkout, and
// search and history use review-git.mjs, whose allowlist checks parsed arguments after the shell
// removes quotes. Session settings and hooks aren't loaded into CI's reviewer.
test("every Claude step keeps its transcript out of the log and reads only the checkout and its history", () => {
  const steps = listClaudeSteps(WORKFLOWS);
  assert.ok(steps.length >= 3);
  for (const { name, workflow, step } of steps) {
    assert.equal(readStepInput(workflow, step, "show_full_output"), "false", name);
    const args = readStepInput(workflow, step, "claude_args");
    const tools = [...args.matchAll(/--allowedTools "([^"]*)"/g)].map(([, list]) => list);
    const trial = name === "provider-review-session.yml";
    assert.ok([REVIEW_WORKFLOW, AREA_WORKFLOW, "provider-review-session.yml"].includes(name));
    const wrapper = trial
      ? "${{ runner.temp }}/trial/controls/review-git.mjs"
      : "${{ runner.temp }}/trusted/worker/review-git.mjs";
    assert.deepEqual(tools, [`Bash(node ${wrapper}:*)`], name);
    assert.doesNotMatch(args, /--disallowedTools/, name);
    const sources = [...args.matchAll(/--setting-sources (\S+)/g)].map(([, list]) => list);
    assert.deepEqual(sources, ["user"], name);
    const prompt = readStepInput(workflow, step, "prompt");
    if (trial) {
      assert.equal(prompt, "${{ needs.request.outputs.claude-prompt }}");
      continue;
    }
    assert.match(prompt, /\bRead\b/, name);
    assert.doesNotMatch(prompt, /\b(?:Grep|Glob)\b/, name);
    assert.ok(prompt.includes(`node ${wrapper} grep -n -F -e <text> -- <path>`), name);
  }
});

// With only user settings loaded, CLAUDE.md doesn't load, so each reviewer is told to read
// AGENTS.md, the rules the code keeps.
test("every reviewer reads AGENTS.md whole along with the review guide", () => {
  const steps = listClaudeSteps([REVIEW_WORKFLOW, AREA_WORKFLOW]);
  assert.equal(steps.length, 3);
  for (const { name, workflow, step } of steps)
    assert.match(
      readStepInput(workflow, step, "prompt"),
      /1\. Read `\.review\/REVIEW\.md`, the review guide as the default branch has it,(?: and follow it,)? and `\.review\/AGENTS\.md`, each whole\./,
      name,
    );
});

/** @param {string} text */
const listReviewForms = (text) =>
  [
    ...text
      .replaceAll("${{ runner.temp }}/trusted/worker/review-git.mjs", "worker/review-git.mjs")
      .matchAll(/`node worker\/review-git\.mjs ([^`]+)`/g),
  ].map(([, form]) =>
    form
      .replaceAll("<path>", "README.md")
      .replaceAll("<start>,<end>", "1,2")
      .replaceAll("<function>", "main")
      .replaceAll("<text>", "example")
      .replaceAll("<pattern>", "example.*")
      .split(" "),
  );

/**
 * @param {string} text
 * @param {string} name
 */
function readReviewOptions(text, name) {
  const declaration = text.match(
    new RegExp(`^const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\]`, "m"),
  );
  assert.ok(declaration, `the reviewer declares ${name} as a literal allowlist`);
  return [...declaration[1].matchAll(/"([^"]+)"/g)].map(([, option]) => option);
}

test("the review usage and prompt search options match their allowlists", () => {
  const source = readRepoFile("worker/review-git.mjs");
  const search = readReviewOptions(source, "SEARCH_FLAGS");
  const searchUsage = source.match(/^\/\/ Search options: (.+)\.$/m);
  assert.ok(searchUsage);
  assert.deepEqual(searchUsage[1].split(" ").toSorted(), search.toSorted());

  const historyUsage = source.match(/^\/\/ History options:([\s\S]*?)(?=^\/\/ Usage:)/m);
  assert.ok(historyUsage);
  const historyOptions = [...historyUsage[1].matchAll(/(?:^|\s)(-{1,2}\S+)/g)].map(([, option]) =>
    option.replace(/[,.;]$/, ""),
  );
  const valued = readReviewOptions(source, "VALUED_FLAGS").map((prefix) => `${prefix}<format>`);
  const specialForms = [
    "-n <number>",
    "-n<number>",
    "-<number>",
    "-L<start>,<end>:<path>",
    "-L:<function>:<path>",
    "-L <start>,<end>:<path>",
  ];
  const permitted = [
    ...readReviewOptions(source, "FLAGS"),
    ...valued,
    ...specialForms.map((form) => form.split(" ")[0]),
  ];
  assert.deepEqual([...new Set(historyOptions)].toSorted(), [...new Set(permitted)].toSorted());
  for (const form of specialForms) {
    const args = form
      .replaceAll("<number>", "3")
      .replaceAll("<start>,<end>", "1,2")
      .replaceAll("<path>", "README.md")
      .replaceAll("<function>", "main")
      .split(" ");
    assert.equal(findRefusal(["log", ...args], "/repo"), null, form);
  }

  for (const { name, workflow, step } of listClaudeSteps([REVIEW_WORKFLOW, AREA_WORKFLOW])) {
    const prompt = readStepInput(workflow, step, "prompt");
    const options = prompt.match(/Search takes (.+?) arguments;/)?.[1];
    assert.ok(options, name);
    const named = [...options.matchAll(/`([^`]+)`/g)].map(([, option]) => option.split(" ")[0]);
    assert.deepEqual(named.toSorted(), [...search, "-e"].toSorted(), name);
  }
});

// The prompts and the generated review index must never name a form the script refuses.
test("every reviewer prompt names the same permitted forms, including the generated index command", () => {
  const steps = listClaudeSteps([REVIEW_WORKFLOW, AREA_WORKFLOW]);
  const sentences = steps.map(
    ({ workflow, step }) =>
      readStepInput(workflow, step, "prompt").match(
        /Search and history come from [^\n]*?outside this checkout\./,
      )?.[0],
  );
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0]);
  for (const sentence of sentences) assert.equal(sentence, sentences[0]);
  assert.match(sentences[0], /It refuses options other than those its usage lists/);
  const forms = listReviewForms(sentences[0]);
  assert.equal(forms.length, 7);
  const folder = mkdtempSync(join(tmpdir(), "review-prompt-index-"));
  writeReview(folder, {
    choice: { stage: "push", files: ["README.md"] },
    since: "a".repeat(40),
    pushed: ["previous", "HEAD"],
    readDiff: () => ({
      numstat: "1\t0\tREADME.md\n",
      diff: "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -0,0 +1 @@\n+example\n",
    }),
    repoFiles: [],
    listStale: () => [],
    rules: [],
  });
  const indexForms = listReviewForms(readFileSync(join(folder, "push.md"), "utf8"));
  assert.equal(indexForms.length, 1);
  assert.deepEqual(indexForms[0], [
    "show",
    "--diff-merges=first-parent",
    "HEAD",
    "--",
    "README.md",
  ]);
  assert.ok(forms.some((form) => JSON.stringify(form) === JSON.stringify(indexForms[0])));
  for (const form of [...forms, ...indexForms])
    assert.equal(findRefusal(form, "/repo"), null, form.join(" "));
});

// Each review job runs only once the jobs whose records it reads have finished.
test("each review job waits for the jobs whose records it reads", () => {
  /** @type {[string, string[]][]} */
  const order = [
    ["review-area", ["review-plan"]],
    ["review-across", ["review-plan", "review-area"]],
    ["review-post", ["review-plan", "review-across", "review-codex", "review-codex-across"]],
  ];
  for (const [job, before] of order) assert.deepEqual(readNeeds(job, REVIEW_WORKFLOW), before, job);
});
