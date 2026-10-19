import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import {
  nameAcrossRecord,
  nameCandidatesRecord,
  nameCheckRecord,
  nameCheckedRecord,
  nameFindRecord,
  namePostRecord,
} from "../worker/judge-review.mjs";
import { escapePattern } from "../worker/plan-review.mjs";

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
 * The jobs a ci.yml job needs, however its needs are written, a long list a line each too.
 * @param {string} job
 */
const readNeeds = (job) =>
  (readJob(job).match(/^ {4}needs:\s*(\[[^\]]*\]|\S+)/m)?.[1] ?? "")
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
      /run: npx playwright install --with-deps .*\bwebkit\b/,
      `${workflow}: ${job}`,
    );
  assert.match(
    readJob("burn-in"),
    /- if: contains\(needs\.scope\.outputs\.specs, 'at-rest\.spec\.mjs'\)\n\s+run: npx playwright install --with-deps webkit\n/,
    "burn-in installs WebKit whenever an at-rest spec is among the ones it repeats",
  );
});

// A cache saved with WebKit in it would have the browser job, whose machines lack WebKit's system
// libraries, run the WebKit projects, so only the jobs that install Chromium alone save it.
test("no job that installs WebKit saves the browsers' cache", () => {
  for (const job of ["burn-in", "webkit"])
    assert.doesNotMatch(readJob(job), /uses: actions\/cache@/, job);
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
  const burnIn = readJob("burn-in");
  assert.match(burnIn, /needs: scope/);
  assert.match(
    burnIn,
    /if: .*needs\.scope\.result == 'success' && needs\.scope\.outputs\.specs != ''/,
  );
  assert.match(burnIn, /SPECS: \$\{\{ needs\.scope\.outputs\.specs \}\}/);
  assert.match(
    readJob("check"),
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
    readJob("check"),
    /\(needs\.scope\.outputs\.apps == '' \|\| \(needs\.browser\.result == 'success' &&\n\s+needs\.webkit\.result == 'success'\)\)/,
  );
});

// The phone status's name, set once for the workflow.
const PHONE_CONTEXT =
  readRepoFile(".github/workflows/ci.yml").match(/^env:\n {2}PHONE_CONTEXT: (\S+)$/m)?.[1] ?? "";

// A held red change waits on the phone status, set on every pull request whose gate ran by a job
// that runs none of the pull request's code since only it can set a status, and check holds the
// change itself whenever main's rules don't require that status, from a lookup in the workflow
// rather than the pull request's code, and never records it as passed for main to deploy at once.
test("a held red change waits on the phone status, and check holds it whenever main's rules don't", () => {
  assert.equal(PHONE_CONTEXT, "phone");
  assert.match(readJob("gate"), /held: \$\{\{ steps\.hold\.outputs\.held \}\}/);
  const phone = readJob("phone");
  assert.match(
    phone,
    /needs: gate\n\s+if: \$\{\{ !cancelled\(\) && needs\.gate\.result == 'success' \}\}\n/,
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
    /\(needs\.gate\.outputs\.held == 'true' && steps\.phone\.outputs\.required != 'true'\)\n\s+run: exit 1/,
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
    /- name: Install the base's modules\n\s+working-directory: \$\{\{ runner\.temp \}\}\/base\n\s+run: npm ci --ignore-scripts\n/,
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
  assert.match(readJob("scope"), /needs: passed\n.*!needs\.passed\.outputs\.run/);
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
  const acrossArtifact = escapePattern(nameArtifact(nameAcrossRecord(stage)));
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
  assert.match(
    review,
    /- if: needs\.review-plan\.outputs\.count != ''\n\s+uses: actions\/download-artifact@\S+ # \S+\n\s+with:\n\s+pattern: review-\*\n/,
    "the summary downloads the plan even for a plan with no areas",
  );
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
    assert.deepEqual(
      readNeeds(job).slice(0, 4),
      ["review-plan", "review-find", "review-check", "review-post"],
      job,
    );
  assert.match(readJob("review-post"), /posted: \$\{\{ steps\.post\.outputs\.posted \}\}/);
  assert.match(readJob("review-post"), /\n\s+id: post\n/);
  assert.match(
    readJob("review-final-find"),
    /include: \$\{\{ fromJSON\(needs\.review-plan\.outputs\.final-reviewers \|\| '\[\]'\) \}\}/,
  );
  assert.match(
    readJob("review-final-check"),
    /include: \$\{\{ fromJSON\(needs\.review-plan\.outputs\.final-checkers \|\| '\[\]'\) \}\}/,
  );
  for (const job of [
    "review-final-find",
    "review-final-check",
    "review-final-across",
    "review-final-post",
  ])
    assert.match(readJob(job), /\n\s+STAGE: final\n/, job);
  assert.match(readJob("review-final-find"), /steps: \*find-steps/);
  assert.match(readJob("review-final-check"), /steps: \*check-steps/);
  assert.match(readJob("review-final-across"), /steps: \*across-steps/);
  for (const [across, check, areas] of [
    ["review-across", "review-check", "areas"],
    ["review-final-across", "review-final-check", "final-areas"],
  ])
    assert.ok(
      readJob(across).includes(
        `if: \${{ !cancelled() && needs.${check}.result != 'skipped' && needs.review-plan.outputs.${areas} > 1 }}`,
      ),
      `${across} runs by the one rule, whenever its check ran and there's more than one area`,
    );
  assert.match(readJob("review-final-post"), /steps: \*post-steps/);
});

// Each review job runs only once the jobs whose records it reads have finished.
test("each review job waits for the jobs whose records it reads", () => {
  /** @type {[string, string[]][]} */
  const order = [
    ["review-check", ["review-plan", "review-find"]],
    ["review-across", ["review-plan", "review-check"]],
    ["review-post", ["review-plan", "review-check", "review-across"]],
    ["review-final-check", ["review-plan", "review-final-find"]],
    ["review-final-across", ["review-plan", "review-final-check"]],
    ["review-final-post", ["review-plan", "review-final-check", "review-final-across"]],
  ];
  for (const [job, before] of order)
    for (const need of before) assert.ok(readNeeds(job).includes(need), `${job} needs ${need}`);
  assert.deepEqual(readNeeds("review-final-across"), ["review-plan", "review-final-check"]);
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
