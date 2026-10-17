import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  nameAcrossRecord,
  nameCandidatesRecord,
  nameCheckRecord,
  nameCheckedRecord,
  nameFindRecord,
  namePostRecord,
} from "../worker/judge-review.mjs";

/** @param {string} path from the repo's root */
const readRepoFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url)).filter((name) =>
  name.endsWith(".yml"),
);

// A tag can be moved to other code, so each action is named by its commit, which can't.
test("every workflow's actions are pinned to a commit", () => {
  assert.ok(WORKFLOWS.length > 0);
  for (const workflow of WORKFLOWS) {
    const actions = [
      ...readRepoFile(`.github/workflows/${workflow}`).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm),
    ].map(([, action]) => action);
    for (const action of actions)
      assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${workflow}: ${action}`);
  }
});

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
 * One job of a workflow, ci.yml unless it names another, from its key to the next job.
 * @param {string} job
 * @param {string} [workflow]
 */
const readJob = (job, workflow = "ci.yml") =>
  readRepoFile(`.github/workflows/${workflow}`).match(
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
  // Without --no-renames, a spec moved or split from another reads as renamed, not added.
  assert.match(
    readJob("changed-specs"),
    /git diff --name-only --no-renames --diff-filter=AM HEAD\^1 HEAD/,
  );
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

/**
 * A job's condition, the anchored one it names when it names one.
 * @param {string} condition
 */
const readCondition = (condition) =>
  condition.startsWith("*")
    ? (readRepoFile(".github/workflows/ci.yml").match(
        new RegExp(`&${condition.slice(1)} (.*)$`, "m"),
      )?.[1] ?? "")
    : condition;

// GitHub skips a job once any job before it in its chain of needs was skipped, as passed is on
// every push to a pull request, unless its condition checks the run's status itself.
test("each job that needs another runs even when one before it was skipped", () => {
  const skippedWithTheirChain = listJobs().filter((job) => {
    const condition = readCondition(readJob(job).match(/^ {4}if: (.*)$/m)?.[1] ?? "success()");
    return /^ {4}needs:/m.test(readJob(job)) && !/!cancelled\(\)|always\(\)/.test(condition);
  });
  assert.deepEqual(skippedWithTheirChain, []);
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
    /github\.event_name == 'pull_request' && steps\.tested\.outputs\.tested == 'true' &&\n\s+steps\.tested\.outputs\.reviewed == 'true'\n.*\n\s+name: ci-tested-/,
  );
  assert.ok(check.indexOf("name: ci-tested-") < check.indexOf("Require every job to pass"));
});

// A draft's run passes with its review skipped, which comes once it's ready on the same code, so
// it never records its code for a later label change to skip the review.
test("a draft's run never records its code as reviewed", () => {
  assert.match(
    readJob("check"),
    /REVIEWED: >-\n\s+\$\{\{ needs\.passed\.outputs\.run != '' \|\| needs\.review-plan\.outputs\.count != '' \|\|\n\s+!github\.event\.pull_request\.draft \}\}/,
  );
});

// A review reads a change of any size in full, area by area: each reviewer's reads are checked,
// each area's cases are checked before anything is posted, and review fails on anything due left
// unread or unchecked, from a guide the pull request can't change, on a named model.
test("the review reads every area in full, checks before it posts, and fails on anything left undone", () => {
  const plan = readJob("review-plan");
  assert.match(plan, /node worker\/plan-review\.mjs \.review >> "\$GITHUB_OUTPUT"/);
  assert.match(plan, /node worker\/review-context\.mjs \.review/);
  assert.match(plan, /git show "origin\/\$DEFAULT_BRANCH:REVIEW\.md" > \.review\/REVIEW\.md/);
  assert.match(plan, /fetch-depth: 0/);
  const find = readJob("review-find");
  assert.match(find, /include: \$\{\{ fromJSON\(needs\.review-plan\.outputs\.reviewers/);
  assert.match(find, /--model claude-opus-5-5/);
  assert.match(find, /disableAllHooks/);
  assert.match(
    find,
    /node worker\/judge-review\.mjs find \.review "\$STAGE" "\$AREA" "\$KIND" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(
    find,
    /if: \$\{\{ !cancelled\(\) && \(steps\.first\.outputs\.unread != '' \|\| steps\.first\.outputs\.answered != 'true'\) \}\}/,
  );
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
  const check = readJob("review-check");
  assert.match(
    check,
    /node worker\/judge-review\.mjs candidates \.review "\$STAGE" "\$AREA" >> "\$GITHUB_OUTPUT"/,
  );
  assert.match(check, /run: node worker\/judge-review\.mjs check .* >> "\$GITHUB_OUTPUT"/);
  assert.match(check, /id: check\n\s+if: steps\.gather\.outputs\.count != '0'/);
  assert.match(check, /if: steps\.keep\.outcome == 'success'\n\s+uses: actions\/upload-artifact/);
  assert.match(
    check,
    /id: keep\n\s+if: steps\.check\.outcome == 'success' \|\| steps\.gather\.outputs\.count == '0'/,
  );
  assert.match(check, /if: steps\.keep\.outputs\.unchecked != '0'\n\s+run: \|\n.*\n\s+exit 1/);
  const across = readJob("review-across");
  assert.match(across, /node worker\/post-review\.mjs list \.review "\$STAGE"/);
  assert.match(across, /node worker\/post-review\.mjs across \.review "\$STAGE"/);
  assert.match(across, /if: steps\.across\.outcome != 'success'\n\s+run: \|\n.*\n\s+exit 1/);
  const post = readJob("review-post");
  assert.match(post, /node worker\/post-review\.mjs post \.review "\$STAGE" >> "\$GITHUB_OUTPUT"/);
  const [stage, area, kind] = ["${{ env.STAGE }}", "${{ matrix.area }}", "${{ matrix.kind }}"];
  const records = [
    ["review-find", nameFindRecord(stage, area, kind)],
    ["review-check", nameCandidatesRecord(stage, area)],
    ["review-check", nameCheckRecord(stage, area)],
    ["review-across", nameCheckedRecord(stage)],
    ["review-across", nameAcrossRecord(stage)],
    ["review-post", namePostRecord(stage)],
  ];
  for (const [job, record] of records)
    assert.ok(readJob(job).includes(`.review/${record}`), `${job} names ${record}`);
  /** @param {string} record */
  const nameArtifact = (record) => `review-${record.replace(/\.json$/, "")}`;
  const findArtifact = nameArtifact(nameFindRecord(stage, area, kind));
  assert.ok(find.includes(`name: ${findArtifact}\n`), "each reviewer uploads its record");
  assert.ok(
    check.includes(`pattern: ${findArtifact.slice(0, -kind.length)}*\n`),
    "each checker downloads its area's reviewers' records",
  );
  const acrossArtifact = nameArtifact(nameAcrossRecord(stage)).replace(/[$.{}]/g, "\\$&");
  assert.match(
    post,
    new RegExp(
      `- if: env\\.AREAS > 1\\n\\s+uses: actions/download-artifact@\\S+ # \\S+\\n\\s+with:\\n\\s+name: ${acrossArtifact}\\n`,
    ),
    "the posting step downloads the check across areas only when there is one",
  );
  const review = readJob("review");
  const reviewJobs = listJobs().filter((job) => job.startsWith("review-"));
  for (const job of reviewJobs) assert.match(review, new RegExp(`^\\s+${job},$`, "m"), job);
  assert.match(review, /run: node worker\/judge-review\.mjs summary \.review/);
  assert.match(review, /if: needs\.review-plan\.result != 'success'\n\s+run: \|\n.*\n\s+exit 1/);
});

// Only the posting and summary steps hold a token that writes to the pull request; no job that runs
// Claude, which reads the pull request's untrusted text, can write to it, and none is handed a
// tool that comments.
test("no job that runs Claude can write to the pull request", () => {
  const withClaude = listJobs().filter((job) =>
    /anthropics\/claude-code-action|steps: \*(find|check|across)-steps/.test(readJob(job)),
  );
  assert.ok(withClaude.includes("review-across") && withClaude.includes("review-final-check"));
  for (const job of withClaude) assert.doesNotMatch(readJob(job), /pull-requests: write/, job);
  assert.doesNotMatch(readJob("review-post"), /claude-code-action/);
  assert.doesNotMatch(readRepoFile(".github/workflows/ci.yml"), /create_inline_comment/);
});

// The last read of the whole change runs only after a review of a push finished and posted
// nothing, with the same steps as the first.
test("the last read of the whole change runs only once a review of a push finished and posted nothing", () => {
  assert.match(
    readJob("review-final-find"),
    /if: &final-due \$\{\{ !cancelled\(\) && needs\.review-plan\.outputs\.stage == 'push' && needs\.review-find\.result == 'success' && needs\.review-check\.result == 'success' && needs\.review-post\.outputs\.posted == '0' && needs\.review-plan\.outputs\.final-count > 0 \}\}/,
  );
  assert.match(readJob("review-final-check"), /if: \*final-due/);
  assert.match(readJob("review-final-post"), /if: \*final-due/);
  for (const job of ["review-final-find", "review-final-check", "review-final-post"])
    assert.match(
      readJob(job),
      /needs:\s*\[review-plan, review-find, review-check, review-post/,
      job,
    );
  assert.match(readJob("review-final-find"), /steps: \*find-steps/);
  assert.match(readJob("review-final-check"), /steps: \*check-steps/);
  assert.match(readJob("review-final-across"), /steps: \*across-steps/);
  assert.match(
    readJob("review-final-across"),
    /if: \$\{\{ !cancelled\(\) && needs\.review-final-check\.result == 'success' && needs\.review-plan\.outputs\.final-areas > 1 \}\}/,
  );
  assert.match(
    readJob("review-across"),
    /if: \$\{\{ !cancelled\(\) && needs\.review-plan\.outputs\.areas > 1 \}\}/,
  );
  assert.match(readJob("review-final-post"), /steps: \*post-steps/);
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
