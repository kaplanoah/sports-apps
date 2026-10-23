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
import {
  ACROSS_RECORD,
  CANDIDATES_RECORD,
  POST_RECORD,
  nameFindRecord,
} from "../worker/judge-review.mjs";
import { formatJobOutputs, listJobs as listPlanJobs, writeReview } from "../worker/plan-review.mjs";
import { findRefusal } from "../worker/review-git.mjs";
import { escapePattern } from "../shared/page/escape-pattern.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import { readStepScript } from "./workflow-step.js";
import { MUTATION_TARGETS } from "../worker/mutation-targets.mjs";

const WORKFLOWS = readdirSync(new URL(".github/workflows/", REPO_ROOT)).filter((name) =>
  name.endsWith(".yml"),
);

// The workflow ci.yml calls for each area of a review.
const AREA_WORKFLOW = "review-area.yml";

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
  assert.match(report, /if: \$\{\{ !cancelled\(\) && github\.event_name == 'schedule' \}\}/);
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
// installing it would skip the at-rest specs in WebKit and still pass.
test("each job that runs the at-rest specs in WebKit installs WebKit with its system libraries", () => {
  for (const [job, workflow] of [
    ["burn-in", "ci.yml"],
    ["webkit", "ci.yml"],
    ["browser", "flaky.yml"],
  ])
    assert.match(
      readJob(job, workflow),
      /run: node worker\/install-browsers\.mjs --with-deps .*\bwebkit\b/,
      `${workflow}: ${job}`,
    );
  const webkitSpec = readRepoFile("playwright.config.mjs").match(/testMatch: "([^"]+)"/)?.[1];
  assert.ok(webkitSpec, "the Playwright config names the spec its WebKit projects run");
  assert.match(
    readJob("burn-in"),
    new RegExp(
      `- if: contains\\(needs\\.scope\\.outputs\\.specs, '${escapePattern(webkitSpec)}'\\)\\n\\s+run: node worker/install-browsers.mjs --with-deps webkit\\n`,
    ),
    "burn-in installs WebKit whenever a spec the config's WebKit projects run is among the ones it repeats",
  );
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
    assert.match(step, /NODE_OPTIONS: --test-reporter=dot|env: \*test-reporter/);
});

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
  assert.equal(PHONE_CONTEXT, "phone");
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
    /if: github\.event_name == 'pull_request' && needs\.gate\.outputs\.held != 'true'\n\s+with:\n\s+name: ci-passed-/,
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

// A run that wasn't asked to review, like a push's or a draft's, leaves a review owed on its
// code, so it never records its code for a later label to skip the review. A plan that didn't
// finish says nothing, so it owes one too.
test("a run that leaves a review owed never records its code as reviewed", () => {
  assert.match(
    readJob("check"),
    /REVIEWED: >-\n\s+\$\{\{ needs\.passed\.outputs\.reviewed-run != '' \|\|\n\s+\(needs\.review-plan\.outputs\.owed == 'false' && needs\.review\.result == 'success'\) \}\}/,
  );
  assert.match(
    readJob("check"),
    /github\.event_name == 'pull_request' && steps\.tested\.outputs\.reviewed == 'true'\n.*\n\s+name: ci-reviewed-/,
  );
  assert.match(readJob("review-plan"), /\n {6}owed: \$\{\{ steps\.decision\.outputs\.owed \}\}\n/);
});

// A ready pull request merges only once a review passed on exactly its code: a push, or a label
// like phone-ok after a review that failed, never turns its check green without one. A draft is
// reviewed once it's ready, so its check passes without one.
test("check fails a ready pull request while a review of its code is owed", () => {
  const check = readJob("check");
  assert.match(
    check,
    /- name: Require a review of this code\n\s+if: needs\.review-plan\.outputs\.owed == 'true' && !github\.event\.pull_request\.draft\n\s+run: \|\n\s+echo "::error::.*\$REVIEW_LABEL.*"\n\s+exit 1\n/,
  );
  assert.ok(
    check.indexOf("Require a review of this code") < check.indexOf("name: ci-passed-"),
    "code a review is owed on never deploys at once from main",
  );
});

/**
 * What review-plan's decision says for an event, by running its own script.
 * @param {Record<string, string>} event the step's env, over a ready pull request's
 */
function decideReview(event) {
  const script = readStepScript(
    readRepoFile(".github/workflows/ci.yml"),
    "Decide whether to review",
  );
  const outputs = mkdtempSync(join(tmpdir(), "ci-decision-"));
  const output = join(outputs, "output");
  writeFileSync(output, "");
  const { status, stdout, stderr } = spawnSync("bash", ["-e", "-c", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      REVIEW_LABEL: readRepoFile(".github/workflows/ci.yml").match(/REVIEW_LABEL: (\S+)/)?.[1],
      EVENT: "pull_request",
      ACTION: "opened",
      LABEL: "",
      REVIEWED_RUN: "",
      IS_DRAFT: "false",
      AUTHOR: "someone",
      CLAUDE_CODE_OAUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      ...event,
    },
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
    assert.match(notice, /^::notice::Nothing was reviewed: a pull request is reviewed once/);
  }
  assert.equal(decideReview({ EVENT: "push", ACTION: "" }).review, "false");
});

// Asking adds a label no run reads as a new ask once it's there, so each ask is a fresh label.
// Only a draft still owes the review it skips; the rest never run one or already passed it.
test("every reason not to review holds when the review is asked for", () => {
  for (const [event, reason, owed] of /** @type {[Record<string, string>, RegExp, string][]} */ ([
    [{ REVIEWED_RUN: "7" }, /already passed its review/, "false"],
    [{ IS_DRAFT: "true" }, /a draft is reviewed once it's ready/, "true"],
    [{ AUTHOR: "dependabot[bot]" }, /Dependabot/, "false"],
    [{ CLAUDE_CODE_OAUTH_TOKEN: "" }, /no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY/, "false"],
  ])) {
    const asked = decideReview({ ACTION: "labeled", LABEL: "review", ...event });
    assert.equal(asked.review, "false", JSON.stringify(event));
    assert.equal(asked.owed, owed, JSON.stringify(event));
    assert.equal(asked.labeled, "true", "a label that asks comes off however the run decides");
    assert.match(asked.notice, reason);
  }
  assert.match(
    readJob("review-plan"),
    /REVIEWED_RUN: \$\{\{ needs\.passed\.outputs\.reviewed-run \}\}/,
  );
});

// The owner's phone-ok comes after the review passed on the same code, so check, which holds a
// ready pull request while a review is owed, lets it through.
test("a label on code a run already passed the review on owes no review", () => {
  const phoneOk = decideReview({ ACTION: "labeled", LABEL: "phone-ok", REVIEWED_RUN: "7" });
  assert.equal(phoneOk.review, "false");
  assert.equal(phoneOk.owed, "false");
  assert.match(phoneOk.notice, /already passed its review/);
});

test("reusing tests on a draft never waives the review when it becomes ready or is requested", () => {
  const plan = readJob("review-plan");
  assert.doesNotMatch(plan, /needs\.passed\.outputs\.run\b/);
  assert.match(readJob("passed"), /reviewed-run: \$\{\{ steps\.reviewed\.outputs\.run \}\}/);
  assert.match(readJob("passed"), /run: node worker\/find-passed-ci\.mjs --reviewed/);
  for (const label of ["beta", "beta-wait", "phone-ok"]) {
    for (const action of ["labeled", "unlabeled"]) {
      const draft = decideReview({ ACTION: action, LABEL: label, IS_DRAFT: "true" });
      assert.equal(draft.review, "false");
      assert.equal(draft.owed, "true");
      const ready = decideReview({ ACTION: action, LABEL: label });
      assert.equal(ready.owed, "true");
    }
  }
  for (const event of [{ ACTION: "ready_for_review" }, { ACTION: "labeled", LABEL: "review" }]) {
    const decision = decideReview({ ...event });
    assert.equal(decision.review, "true");
    assert.equal(decision.owed, "false");
  }
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

// Each ask is a fresh label, which GitHub sends only when the label isn't on the pull request, so
// the run it starts takes it off in its review-label job.
test("a run the review label started takes the label off, and the label is named in one place", () => {
  const workflow = readRepoFile(".github/workflows/ci.yml");
  assert.match(workflow, /\nenv:\n(?: {2}.*\n)* {2}REVIEW_LABEL: review\n/);
  assert.doesNotMatch(workflow, /'review'|"review"|labels\/review/);
  assert.match(readJob("review-plan"), /permissions:\n\s+contents: read\n\s+pull-requests: read\n/);
  assert.match(
    readJob("review-plan"),
    /\n {6}labeled: \$\{\{ steps\.decision\.outputs\.labeled \}\}\n/,
  );
  const label = readJob("review-label");
  assert.deepEqual(readNeeds("review-label"), ["gate", "review-plan"]);
  assert.ok(
    label.includes(
      "if: ${{ !cancelled() && needs.review-plan.outputs.labeled == 'true' && needs.gate.outputs.forked == 'false' }}",
    ),
    "the label comes off once the plan is written, but for a fork's pull request, whose token can't",
  );
  assert.match(label, /permissions:\n\s+pull-requests: write\n\s+steps:/);
  assert.match(
    label,
    /gh api --method DELETE "repos\/\$REPO\/issues\/\$PR\/labels\/\$REVIEW_LABEL"/,
  );
  assert.doesNotMatch(label, /checkout|node /, "it runs none of the pull request's code");
  for (const job of listJobs().filter((name) => name !== "review-label"))
    assert.doesNotMatch(readJob(job), /labels\//, job);
});

// A review reads a change of any size in full, area by area: each reviewer's reads are checked,
// one check across every area confirms each case before anything is posted, and review fails on
// anything due left unread or unchecked, from a guide the pull request can't change, on a named
// model.
test("the review reads every area in full, checks before it posts, and fails on anything left undone", () => {
  const plan = readJob("review-plan");
  assert.match(plan, /node worker\/plan-review\.mjs \.review >> "\$GITHUB_OUTPUT"/);
  assert.match(plan, /node worker\/review-context\.mjs \.review/);
  assert.match(plan, /git show "origin\/\$DEFAULT_BRANCH:REVIEW\.md" > \.review\/REVIEW\.md/);
  assert.match(plan, /fetch-depth: 0/);
  assert.deepEqual(listJobs(AREA_WORKFLOW), ["find"]);
  const find = readJob("find", AREA_WORKFLOW);
  assert.doesNotMatch(find, /matrix/);
  assert.match(find, /--model claude-opus-5-5/);
  assert.match(find, /disableAllHooks/);
  assert.match(find, /node worker\/judge-review\.mjs find \.review "\$AREA" >> "\$GITHUB_OUTPUT"/);
  assert.match(
    find,
    /id: again\n\s+if: &retry-due \$\{\{ !cancelled\(\) && steps\.first\.outcome == 'success' && \(steps\.first\.outputs\.unread != '' \|\| steps\.first\.outputs\.answered != 'true'\) \}\}/,
  );
  assert.match(find, /id: last\n\s+if: \*retry-due\n/);
  assert.match(
    find,
    /if: \$\{\{ !cancelled\(\) && \(steps\.last\.outputs\.unread != '' \|\| steps\.last\.outputs\.answered == 'false'\) \}\}\n\s+run: \|\n.*\n\s+exit 1/,
  );
  assert.ok(
    find.includes(
      "${{ steps.first.outputs.answered == 'true' && 'Its answer is kept, so judge only what those files change.' || 'It gave no answer, so judge your whole area again.' }}",
    ),
    "a retry judges its whole area again only when the first try gave no answer",
  );
  assert.ok(
    find.includes(
      "judge your area's whole diff against each rule file the earlier try left unread",
    ),
    "a retry judges the whole area against a rule file the first try skipped",
  );
  assert.match(
    readRepoFile(`.github/workflows/${AREA_WORKFLOW}`),
    /\nenv:\n {2}STAGE: \$\{\{ inputs\.stage \}\}\n {2}AREA: \$\{\{ inputs\.area \}\}\n/,
  );
  const across = readJob("review-across");
  assert.match(across, /--model claude-opus-5-5/);
  assert.match(across, /run: node worker\/judge-review\.mjs candidates \.review\n/);
  assert.match(
    across,
    /id: keep\n\s+if: steps\.across\.outcome == 'success'\n(?:\s+.*\n)*?\s+run: node worker\/judge-review\.mjs across \.review >> "\$GITHUB_OUTPUT"\n/,
  );
  assert.match(across, /if: steps\.keep\.outcome == 'success'\n\s+uses: actions\/upload-artifact/);
  assert.match(
    across,
    /if: steps\.keep\.outcome != 'success' \|\| steps\.keep\.outputs\.unchecked != '0'\n\s+run: \|\n.*\n\s+exit 1/,
    "a check that didn't finish fails its job, though the answer it never kept sets no count",
  );
  const post = readJob("review-post");
  assert.match(post, /run: node worker\/post-review\.mjs \.review\n/);
  const area = "${{ env.AREA }}";
  /** @type {[string, string, string][]} */
  const records = [
    ["find", AREA_WORKFLOW, nameFindRecord(area)],
    ["review-across", "ci.yml", CANDIDATES_RECORD],
    ["review-across", "ci.yml", ACROSS_RECORD],
    ["review-post", "ci.yml", POST_RECORD],
  ];
  for (const [job, workflow, record] of records)
    assert.ok(readJob(job, workflow).includes(`.review/${record}`), `${job} names ${record}`);
  /** @param {string} record */
  const nameArtifact = (record) => `review-${record.replace(/\.json$/, "")}`;
  const findArtifact = nameArtifact(nameFindRecord(area));
  assert.ok(find.includes(`name: ${findArtifact}\n`), "each reviewer uploads its record");
  assert.ok(
    across.includes(`pattern: ${nameArtifact(nameFindRecord("*"))}\n`),
    "the check across areas downloads every area's reviewer's record",
  );
  assert.ok(across.includes(`name: ${nameArtifact(ACROSS_RECORD)}\n`));
  assert.ok(post.includes(`name: ${nameArtifact(ACROSS_RECORD)}\n`));
  assert.ok(post.includes(`name: ${nameArtifact(POST_RECORD)}\n`));
  const review = readJob("review");
  const reviewJobs = listJobs().filter(
    (job) => job.startsWith("review-") && job !== "review-label",
  );
  assert.deepEqual(readNeeds("review").toSorted(), reviewJobs.toSorted());
  assert.match(
    review,
    /- if: needs\.review-plan\.outputs\.count != ''\n\s+uses: actions\/download-artifact@\S+ # \S+\n\s+with:\n\s+pattern: review-\*\n/,
    "the summary downloads the plan even for a plan with no areas",
  );
  assert.match(review, /run: node worker\/judge-review\.mjs summary \.review/);
  assert.match(review, /if: needs\.review-plan\.result != 'success'\n\s+run: \|\n.*\n\s+exit 1/);
});

// One reviewer an area, then one check across every area, one area too: a review runs as many
// Claude jobs as it has areas, and one more.
test("a review has one reviewer an area and one check across them all, however many areas", () => {
  assert.equal(listJobs().filter((job) => job.startsWith("review-")).length, 5);
  const across = readJob("review-across");
  assert.match(
    across,
    /\n {4}if: \$\{\{ !cancelled\(\) && needs\.review-area\.result != 'skipped' \}\}\n/,
  );
  assert.equal(across.match(/anthropics\/claude-code-action/g)?.length, 1);
  const find = readJob("find", AREA_WORKFLOW);
  assert.equal(find.match(/anthropics\/claude-code-action/g)?.length, 2);
  assert.ok(find.includes('for every item in the guide\'s "What to look for"'));
  assert.match(readRepoFile("REVIEW.md"), /^## What to look for$/m);
});

// The plan hands its matrix to the job that reviews its areas, under the names it reads, and each
// area's unit takes the inputs it declares.
test("the areas are reviewed with the matrix the plan writes, each area as a unit of its own", () => {
  const plan = readJob("review-plan");
  const written = [
    "stage",
    ...formatJobOutputs(listPlanJobs([{ area: 1, name: "docs" }])).split("\n"),
  ].map((line) => line.replace(/=.*$/, ""));
  const handed = [
    ...plan
      .split(/^ {4}outputs:$/m)[1]
      .split(/^ {4}steps:$/m)[0]
      .matchAll(/^ {6}([a-z-]+): \$\{\{ steps\.plan\./gm),
  ].map(([, output]) => output);
  assert.deepEqual(handed, written);
  for (const output of written)
    assert.ok(
      plan.includes(`\n      ${output}: \${{ steps.plan.outputs.${output} }}\n`),
      `review-plan hands on ${output}`,
    );
  const inputs = readRepoFile(`.github/workflows/${AREA_WORKFLOW}`)
    .split(/^ {4}inputs:$/m)[1]
    .split(/^ {4}secrets:$/m)[0];
  const declared = [...inputs.matchAll(/^ {6}([a-z-]+):$/gm)].map(([, input]) => input);
  const caller = readJob("review-area");
  assert.match(caller, /\n {4}uses: \.\/\.github\/workflows\/review-area\.yml\n/);
  assert.ok(caller.includes("include: ${{ fromJSON(needs.review-plan.outputs.areas || '[]') }}"));
  const given = Object.fromEntries(
    [...(caller.split(/^ {4}with:$/m)[1] ?? "").matchAll(/^ {6}([a-z-]+): (.*)$/gm)].map(
      ([, input, value]) => [input, value],
    ),
  );
  assert.deepEqual(Object.keys(given).toSorted(), declared.toSorted());
  assert.equal(given.stage, "${{ needs.review-plan.outputs.stage }}");
  assert.equal(given.area, "${{ fromJSON(needs.review-plan.outputs.area-numbers)[matrix.name] }}");
  assert.equal(given.name, "${{ matrix.name }}");
  // GitHub can't fill a skipped job's typed name from its matrix, so it would show it unfilled;
  // an unnamed one is named by its matrix when it runs and by its key when skipped.
  assert.doesNotMatch(caller, /^ {4}name:/m);
  assert.match(caller, /CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
});

// Only the posting and summary jobs, and review-label, which takes off the review label, hold a
// token that writes to the pull request; no job that runs Claude, which reads the pull request's
// untrusted text, can write to it, and none is handed a tool that comments. A job that calls a
// workflow caps the token of every job in it.
test("no job that runs Claude can write to the pull request", () => {
  const withClaude = [
    ...listJobs().map((job) => readJob(job)),
    ...listJobs(AREA_WORKFLOW).map((job) => readJob(job, AREA_WORKFLOW)),
  ].filter((job) => /anthropics\/claude-code-action|review-area\.yml/.test(job));
  assert.equal(withClaude.length, 3);
  for (const job of withClaude) assert.doesNotMatch(job, /pull-requests: write/, job);
  const writers = listJobs().filter((job) => /pull-requests: write/.test(readJob(job)));
  assert.deepEqual(writers.toSorted(), ["review", "review-label", "review-post"]);
  for (const job of writers) assert.doesNotMatch(readJob(job), /claude-code-action/, job);
  for (const workflow of ["ci.yml", AREA_WORKFLOW]) {
    const text = readRepoFile(`.github/workflows/${workflow}`);
    assert.doesNotMatch(text, /create_inline_comment/);
    assert.doesNotMatch(text, /secrets: inherit/, workflow);
  }
});

/**
 * A step's input, through the YAML anchor it names when it names one.
 * @param {string} workflow the workflow's text
 * @param {string} step
 * @param {string} input
 */
function readStepInput(workflow, step, input) {
  const value = step.match(new RegExp(`^ {10}${input}: (.*(?:\\n(?: {12}.*)?)*)`, "m"))?.[1] ?? "";
  const alias = value.trim().match(/^\*([\w-]+)$/)?.[1];
  if (!alias) return value.trim();
  return (
    workflow
      .match(new RegExp(`^ {10}[\\w-]+: &${alias} (.*(?:\\n(?: {12}.*)?)*)`, "m"))?.[1]
      ?.trim() ?? ""
  );
}

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
    const wrapper = ["review.yml", "trusted-review-area.yml"].includes(name)
      ? "${{ runner.temp }}/trusted/worker/review-git.mjs"
      : "worker/review-git.mjs";
    assert.deepEqual(tools, [`Bash(node ${wrapper}:*)`], name);
    assert.doesNotMatch(args, /--disallowedTools/, name);
    const sources = [...args.matchAll(/--setting-sources (\S+)/g)].map(([, list]) => list);
    assert.deepEqual(sources, ["user"], name);
    const prompt = readStepInput(workflow, step, "prompt");
    assert.match(prompt, /\bRead\b/, name);
    assert.doesNotMatch(prompt, /\b(?:Grep|Glob)\b/, name);
    assert.ok(prompt.includes(`node ${wrapper} grep -n -F -e <text> -- <path>`), name);
  }
});

// With only user settings loaded, CLAUDE.md doesn't load, so each reviewer is told to read
// AGENTS.md, the rules the code keeps.
test("every reviewer reads AGENTS.md whole along with the review guide", () => {
  const steps = listClaudeSteps(["ci.yml", AREA_WORKFLOW]);
  assert.equal(steps.length, 3);
  for (const { name, workflow, step } of steps)
    assert.match(
      readStepInput(workflow, step, "prompt"),
      /1\. Read `\.review\/REVIEW\.md`, the review guide as the default branch has it,(?: and follow it,)? and AGENTS\.md, each whole\./,
      name,
    );
});

/** @param {string} text */
const listReviewForms = (text) =>
  [...text.matchAll(/`node worker\/review-git\.mjs ([^`]+)`/g)].map(([, form]) =>
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

  for (const { name, workflow, step } of listClaudeSteps(["ci.yml", AREA_WORKFLOW])) {
    const prompt = readStepInput(workflow, step, "prompt");
    const options = prompt.match(/Search takes (.+?) arguments;/)?.[1];
    assert.ok(options, name);
    const named = [...options.matchAll(/`([^`]+)`/g)].map(([, option]) => option.split(" ")[0]);
    assert.deepEqual(named.toSorted(), [...search, "-e"].toSorted(), name);
  }
});

// The prompts and the generated review index must never name a form the script refuses.
test("every reviewer prompt names the same permitted forms, including the generated index command", () => {
  const steps = listClaudeSteps(["ci.yml", AREA_WORKFLOW]);
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
    ["review-post", ["review-plan", "review-across"]],
  ];
  for (const [job, before] of order) assert.deepEqual(readNeeds(job), before, job);
});
