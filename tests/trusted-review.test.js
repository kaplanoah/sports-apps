import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStepScript } from "./workflow-step.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";
import { createReviewGitEnvironment } from "../worker/review-repository.mjs";
import {
  findTrustedReviewRun,
  isTrustedReviewRun,
  verifyTrustedReviewResult,
} from "../worker/find-trusted-review.mjs";
import {
  exportReviewArtifact,
  importReviewArtifacts,
  prepareReviewCheckout,
} from "../worker/trusted-review.mjs";
import {
  isReviewPath,
  listReviewFiles,
  readReviewIdentity,
  readReviewAnswer,
  recomputeReviewCoverage,
  sealReviewArtifact,
  validateAcrossCandidates,
  validateReviewArtifact,
  validateReviewPlan,
} from "../worker/review-data.mjs";

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const SHA = "a".repeat(40);
const ID_ENV = {
  GITHUB_REPOSITORY: "example/repository",
  GITHUB_RUN_ID: "7",
  REVIEW_HEAD: SHA,
  REVIEW_BASE: "b".repeat(40),
  REVIEW_MERGE: "c".repeat(40),
  REVIEW_TRUSTED: "d".repeat(40),
  GITHUB_WORKFLOW_REF: "example/repository/.github/workflows/review.yml@refs/heads/main",
};
const IDENTITY = readReviewIdentity(ID_ENV);
const CANDIDATE = {
  path: "a.js",
  line: 1,
  weight: "Important",
  confidence: "high",
  claim: "A claim",
  when: "An input",
  fix: "A fix",
};
const FINDING = {
  path: "a.js",
  line: 1,
  weight: "Important",
  verdict: "confirmed",
  ids: ["1.1"],
  body: "A finding",
  why: "A reason",
};

const createFolder = () => mkdtempSync(join(tmpdir(), "trusted-review-"));
const createPlan = () => ({
  stage: "first",
  since: null,
  unread: [],
  areas: [
    {
      area: 1,
      name: "one",
      files: ["a.js"],
      rules: [],
      partsByFile: { "a.js": ["first/a.js.diff"] },
    },
  ],
});

/** @param {string} folder @param {string} path @param {unknown} value */
const writeJson = (folder, path, value) => writeFileSync(join(folder, path), JSON.stringify(value));

/** @param {string} folder @param {string[]} args */
const readGit = (folder, args) =>
  execFileSync("git", args, {
    cwd: folder,
    env: ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** @param {string} folder */
function writePlanFiles(folder) {
  mkdirSync(join(folder, "first"), { recursive: true });
  writeJson(folder, "plan.json", createPlan());
  for (const path of [
    "REVIEW.md",
    "AGENTS.md",
    "pull-request.md",
    "stale-names.md",
    "first.md",
    "first/a.js.diff",
  ])
    writeFileSync(join(folder, path), "first\nsecond\n");
}

test("trusted review pins workflow authority, source, Node and isolated artifacts before reviewing data", () => {
  const main = readRepoFile(".github/workflows/review.yml");
  const area = readRepoFile(".github/workflows/trusted-review-area.yml");
  assert.match(main, / {2}pull_request_target:/);
  assert.match(main, /base.ref == 'main'/);
  let claude = 0;
  for (const workflow of [main, area]) {
    assert.doesNotMatch(workflow, /actions\/cache|npm ci|npx /);
    const steps = workflow.split(/^ {6}- /m);
    for (const step of steps) {
      if (/uses: actions\/checkout@/.test(step)) {
        assert.match(step, /ref: \$\{\{ github.sha \}\}/);
        assert.match(step, /persist-credentials: false/);
      }
      if (/uses: actions\/setup-node@/.test(step)) {
        assert.match(step, /node-version-file: \.nvmrc/);
        assert.match(step, /package-manager-cache: false/);
      }
      if (/uses: actions\/download-artifact@/.test(step)) {
        assert.match(step, /path: \$\{\{ runner.temp \}\}\/review-input\//);
        assert.doesNotMatch(step, /merge-multiple|run-id:/);
      }
      if (/run:.*node /.test(step)) {
        assert.match(step, /node "\$RUNNER_TEMP\/trusted\/worker\/trusted-review\.mjs"/);
        assert.doesNotMatch(step, /npm |npx |node worker\//);
      }
      if (/uses: anthropics\//.test(step)) {
        claude += 1;
        if (!/claude_args: \*/.test(step)) {
          assert.match(step, /--model claude-opus-5-5/);
          assert.match(step, /--tools "Read,Bash"/);
          assert.match(step, /^ {12}--strict-mcp-config$/m);
          assert.match(step, /--mcp-config '\{"mcpServers":\{\}\}'/);
          assert.match(
            step,
            /Bash\(node \$\{\{ runner.temp \}\}\/trusted\/worker\/review-git.mjs:\*\)/,
          );
        }
      }
    }
    const setup = workflow.indexOf("uses: actions/setup-node@");
    const source = workflow.indexOf('git archive "$REVIEW_TRUSTED"');
    const prepare = workflow.indexOf('trusted-review.mjs" prepare');
    assert.ok(setup >= 0 && setup < source && source < prepare);
  }
  assert.equal(claude, 3);
});

test("missing required credentials fail visibly rather than declaring review unnecessary", () => {
  const script = readStepScript(
    readRepoFile(".github/workflows/review.yml"),
    "Decide whether to review",
  );
  const output = join(createFolder(), "outputs");
  const result = spawnSync("bash", ["-c", script], {
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      EVENT: "pull_request_target",
      ACTION: "opened",
      AUTHOR: "example",
      REVIEW_LABEL: "review",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::Required review credentials are missing/);
  assert.doesNotMatch(readFileSync(output, "utf8"), /owed=false/);
});

test("Git retains proxy and CA trust while discarding credentials and executable configuration", () => {
  const env = createReviewGitEnvironment({
    PATH: "/usr/bin",
    HTTPS_PROXY: "https://example.com",
    SSL_CERT_FILE: "/tmp/ca.pem",
    REVIEW_BASE: SHA,
    GH_TOKEN: "example-token",
    ANTHROPIC_API_KEY: "example-key",
    NODE_OPTIONS: "--import /tmp/evil.mjs",
    GIT_EXTERNAL_DIFF: "/tmp/evil",
    GIT_CONFIG_COUNT: "1",
  });
  assert.equal(env.HTTPS_PROXY, "https://example.com");
  assert.equal(env.SSL_CERT_FILE, "/tmp/ca.pem");
  assert.equal(env.GIT_ATTR_SOURCE, SHA);
  for (const field of [
    "GH_TOKEN",
    "ANTHROPIC_API_KEY",
    "NODE_OPTIONS",
    "GIT_EXTERNAL_DIFF",
    "GIT_CONFIG_COUNT",
  ])
    assert.equal(env[field], undefined, field);
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.throws(() => createReviewGitEnvironment({ REVIEW_BASE: "main" }), /immutable base/);
});

test("all artifact identity fields and exact file manifests are checked before use", () => {
  const folder = createFolder();
  writeJson(folder, "find-1.json", {});
  sealReviewArtifact(folder, "find-1", IDENTITY, ["find-1.json"]);
  validateReviewArtifact(folder, "find-1", IDENTITY, ["find-1.json"]);
  for (const field of Object.keys(IDENTITY))
    assert.throws(
      () =>
        validateReviewArtifact(folder, "find-1", { ...IDENTITY, [field]: "wrong" }, [
          "find-1.json",
        ]),
      /stale or foreign/,
    );
  assert.throws(
    () => validateReviewArtifact(folder, "find-2", IDENTITY, ["find-1.json"]),
    /stale or foreign/,
  );
  writeFileSync(join(folder, "extra.json"), "{}");
  assert.throws(
    () => validateReviewArtifact(folder, "find-1", IDENTITY, ["find-1.json"]),
    /unexpected or missing/,
  );
  const altered = createFolder();
  writeJson(altered, "find-1.json", {});
  sealReviewArtifact(altered, "find-1", IDENTITY, ["find-1.json"]);
  writeJson(altered, "find-1.json", { changed: true });
  assert.throws(
    () => validateReviewArtifact(altered, "find-1", IDENTITY, ["find-1.json"]),
    /content changed/,
  );
  assert.throws(
    () => sealReviewArtifact(altered, "find-1", IDENTITY, ["find-1.json", "find-1.json"]),
    /file list/,
  );
});

test("the join accepts results only from successful trusted workflow runs on the expected head and base", async () => {
  const expected = { repository: "example/repository", head: SHA, base: "b".repeat(40), pull: "1" };
  const run = {
    id: 7,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_branch: "main",
    head_sha: expected.base,
    repository: { full_name: expected.repository },
    display_title: `Review 1 head ${SHA} base ${expected.base}`,
    conclusion: "success",
    status: "completed",
  };
  assert.ok(isTrustedReviewRun(run, expected));
  for (const change of [
    { event: "pull_request" },
    { path: ".github/workflows/ci.yml" },
    { head_branch: "change" },
    { head_sha: SHA },
    { display_title: "another head" },
    { repository: { full_name: "other/repository" } },
  ])
    assert.equal(isTrustedReviewRun({ ...run, ...change }, expected), false);
  const readGitHub = async (path) =>
    path.includes("artifacts?")
      ? { artifacts: [{ workflow_run: { id: 7 } }] }
      : path.includes("/runs/7")
        ? run
        : { workflow_runs: [run] };
  assert.deepEqual(await findTrustedReviewRun({ ...expected, tree: SHA, readGitHub }), {
    run: 7,
    pending: false,
  });
  run.conclusion = "failure";
  assert.deepEqual(await findTrustedReviewRun({ ...expected, tree: SHA, readGitHub }), {
    run: null,
    pending: false,
  });
  run.status = "in_progress";
  assert.deepEqual(await findTrustedReviewRun({ ...expected, tree: SHA, readGitHub }), {
    run: null,
    pending: true,
  });
});

test("the read-only join validates result content and producer identity before claiming success", () => {
  const folder = createFolder();
  writeJson(folder, "result.json", { identity: IDENTITY, tree: SHA, passed: true });
  sealReviewArtifact(folder, "result", IDENTITY, ["result.json"]);
  const env = { ...ID_ENV, REVIEW_RUN: "7", REVIEW_TREE: SHA };
  verifyTrustedReviewResult(folder, env);
  assert.throws(
    () => verifyTrustedReviewResult(folder, { ...env, REVIEW_RUN: "8" }),
    /stale or foreign/,
  );
  assert.throws(
    () => verifyTrustedReviewResult(folder, { ...env, REVIEW_TREE: "b".repeat(40) }),
    /does not match/,
  );
  writeJson(folder, "result.json", { identity: IDENTITY, tree: SHA, passed: false });
  sealReviewArtifact(folder, "result", IDENTITY, ["result.json"]);
  assert.throws(() => verifyTrustedReviewResult(folder, env), /does not match/);
});

test("unsafe paths, malformed answers, candidate identity overrides and duplicate ids fail closed", () => {
  for (const path of ["../a", "/a", "a/../b", "a\\b", "a\n", "./a", "a//b", ""])
    assert.equal(isReviewPath(path), false, path);
  assert.ok(isReviewPath("nested/a.js"));
  assert.ok(
    readReviewAnswer(JSON.stringify({ candidates: [CANDIDATE], unjudged: [] }), "candidates"),
  );
  for (const item of [
    null,
    {},
    { ...CANDIDATE, path: "../a" },
    { ...CANDIDATE, line: 0 },
    { ...CANDIDATE, id: "2.2" },
    { ...CANDIDATE, weight: "other" },
  ])
    assert.throws(
      () => readReviewAnswer(JSON.stringify({ candidates: [item], unjudged: [] }), "candidates"),
      /Invalid review data/,
    );
  const records = [{ area: 1, tries: [{ answer: { items: [CANDIDATE], unjudged: [] } }] }];
  const candidates = [{ id: "1.1", ...CANDIDATE }];
  validateAcrossCandidates(records, { items: [FINDING], unjudged: [] }, candidates);
  for (const ids of [[], ["2.1"], ["1.1", "1.1"], ["1.1", "2.1"]])
    assert.throws(
      () =>
        validateAcrossCandidates(
          records,
          { items: [{ ...FINDING, ids }], unjudged: [] },
          candidates,
        ),
      /candidate id/,
    );
  assert.throws(
    () => validateAcrossCandidates(records, { items: [FINDING], unjudged: [] }, []),
    /candidate list changed/,
  );
  const plan = createPlan();
  plan.areas[0].partsByFile["a.js"] = ["../outside"];
  assert.throws(() => validateReviewPlan(plan), /unsafe part/);
});

test("symlinked artifact files and directories never become trusted data", () => {
  for (const directory of [false, true]) {
    const folder = createFolder();
    const outside = createFolder();
    writeFileSync(join(outside, "outside"), "outside");
    symlinkSync(directory ? outside : join(outside, "outside"), join(folder, "link"));
    assert.throws(() => listReviewFiles(folder), /symlink/);
  }
});

test("coverage and answered status are recomputed, ignoring forged completion claims", () => {
  const folder = createFolder();
  writePlanFiles(folder);
  const record = { area: 1, tries: [{ reads: [], answer: null }], unread: [], isAnswered: true };
  const checked = recomputeReviewCoverage(record, createPlan().areas[0], folder);
  assert.deepEqual(checked.unread, ["first/a.js.diff"]);
  assert.equal(checked.isAnswered, false);
  record.tries[0].reads = [["first/a.js.diff", [[1, 2]]]];
  record.tries[0].answer = { items: [], unjudged: [] };
  assert.deepEqual(recomputeReviewCoverage(record, createPlan().areas[0], folder).unread, []);
});

test("forged completion cannot reach privileged finding posting", () => {
  const folder = createFolder();
  writePlanFiles(folder);
  writeJson(folder, "find-1.json", {
    area: 1,
    tries: [{ reads: [], answer: null }],
    unread: [],
    isAnswered: true,
  });
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      new URL("tests/no-network.js", REPO_ROOT).pathname,
      new URL("worker/trusted-review.mjs", REPO_ROOT).pathname,
      "post",
    ],
    { env: { ...ENV, ...ID_ENV, REVIEW_FOLDER: folder }, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Incomplete coverage cannot authorize posting findings/);
  assert.doesNotMatch(result.stderr, /A Node test tried to read/);
  assert.equal(existsSync(join(folder, "post.json")), false);
});

test("sealed stage import rejects PR-seeded or unexpected records and preserves relative coverage", () => {
  const folder = createFolder();
  const upload = createFolder();
  writePlanFiles(folder);
  const env = { ...ID_ENV, REVIEW_UPLOAD: upload };
  exportReviewArtifact(folder, "plan", env);
  writeJson(folder, "find-1.json", {
    area: 1,
    tries: [
      { reads: [[join(folder, "first/a.js.diff"), [[1, 2]]]], answer: { items: [], unjudged: [] } },
    ],
    unread: [],
    isAnswered: true,
  });
  exportReviewArtifact(folder, "find-1", env);
  const destination = createFolder();
  importReviewArtifacts(upload, destination, env);
  const record = JSON.parse(readFileSync(join(destination, "find-1.json"), "utf8"));
  assert.deepEqual(record.unread, []);
  assert.equal(record.isAnswered, true);
  assert.equal(record.tries[0].reads[0][0], join(destination, "first/a.js.diff"));
  const seeded = createFolder();
  writeFileSync(join(seeded, "plan.json"), "seed");
  assert.throws(() => importReviewArtifacts(upload, seeded, env), /EEXIST/);
  mkdirSync(join(upload, "trusted-review-find-2"));
  assert.throws(
    () => importReviewArtifacts(upload, createFolder(), env),
    /Unexpected review artifact/,
  );
});

test("a hostile merge tree cannot replace trusted entrypoints, imports, Node or package configuration", () => {
  const directory = createFolder();
  const trusted = join(directory, "trusted");
  mkdirSync(trusted);
  for (const path of ["worker", "shared", "package.json", ".nvmrc", ".claude/rules"])
    cpSync(new URL(path, REPO_ROOT), join(trusted, path), { recursive: true });
  const hostile = join(directory, "hostile");
  mkdirSync(hostile);
  readGit(hostile, ["init", "-b", "main"]);
  readGit(hostile, ["config", "user.name", "Example"]);
  readGit(hostile, ["config", "user.email", "example@example.com"]);
  writeFileSync(join(hostile, "a.js"), "base tracked text\n");
  readGit(hostile, ["add", "."]);
  readGit(hostile, ["commit", "-m", "base"]);
  const base = readGit(hostile, ["rev-parse", "HEAD"]);
  readGit(hostile, ["checkout", "-b", "change"]);
  mkdirSync(join(hostile, "worker"));
  const marker = join(directory, "executed");
  const evil = `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)},"executed");throw new Error("untrusted code");`;
  for (const path of [
    "review-git.mjs",
    "plan-review.mjs",
    "judge-review.mjs",
    "post-review.mjs",
    "github-api.mjs",
    "package-imports.mjs",
    "rule-files.mjs",
    "review-state.mjs",
    "review-repository.mjs",
    "deploy-scope.mjs",
    "apps.mjs",
  ])
    writeFileSync(join(hostile, "worker", path), evil);
  writeFileSync(
    join(hostile, "package.json"),
    '{"type":"module","imports":{"#shared/*":"./evil/*"}}',
  );
  writeFileSync(join(hostile, ".nvmrc"), "not-a-node-version");
  writeFileSync(join(hostile, ".gitattributes"), "worker/*.mjs binary\n");
  mkdirSync(join(hostile, ".review"));
  writeFileSync(join(hostile, ".review/find-1.json"), '{"isAnswered":true,"unread":[]}');
  writeFileSync(join(hostile, "a.js"), "reviewed tracked text\n");
  readGit(hostile, ["add", "."]);
  readGit(hostile, ["commit", "-m", "hostile"]);
  const head = readGit(hostile, ["rev-parse", "HEAD"]);
  readGit(hostile, ["checkout", "main"]);
  readGit(hostile, ["merge", "--no-ff", "change", "-m", "merge"]);
  const merge = readGit(hostile, ["rev-parse", "HEAD"]);
  readGit(hostile, ["update-ref", "refs/pull/1/merge", merge]);
  const checkout = join(directory, "checkout");
  readGit(directory, ["clone", "--no-hardlinks", hostile, checkout]);
  const envFile = join(directory, "env");
  prepareReviewCheckout({
    ...ENV,
    GITHUB_EVENT_NAME: "pull_request_target",
    GITHUB_WORKSPACE: checkout,
    PR: "1",
    REVIEW_BASE: base,
    REVIEW_HEAD: head,
    REVIEW_MERGE: merge,
    RUNNER_TEMP: directory,
    GITHUB_ENV: envFile,
    GITHUB_OUTPUT: join(directory, "output"),
  });
  assert.equal(existsSync(join(checkout, ".review/find-1.json")), false);
  const result = spawnSync(
    process.execPath,
    [
      join(trusted, "worker/review-git.mjs"),
      "grep",
      "-n",
      "-F",
      "-e",
      "reviewed tracked text",
      "--",
      "a.js",
    ],
    {
      cwd: checkout,
      env: { ...ENV, REVIEW_CHECKOUT: checkout, REVIEW_BASE: base },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /a.js:1:reviewed tracked text/);
  const history = spawnSync(
    process.execPath,
    [join(trusted, "worker/review-git.mjs"), "show", "HEAD^1:a.js"],
    {
      cwd: checkout,
      env: { ...ENV, REVIEW_CHECKOUT: checkout, REVIEW_BASE: base },
      encoding: "utf8",
    },
  );
  assert.equal(history.stdout, "base tracked text\n");
  const imports = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(join(trusted, "worker/plan-review.mjs"))});await import(${JSON.stringify(join(trusted, "worker/post-review.mjs"))});`,
    ],
    { cwd: checkout, env: ENV, encoding: "utf8" },
  );
  assert.equal(imports.status, 0, imports.stderr);
  const preload = join(directory, "fake-fetch.mjs");
  writeFileSync(preload, "globalThis.fetch = async () => ({ok:true,json:async()=>[]});");
  const planFolder = join(directory, "plan");
  const planned = spawnSync(
    process.execPath,
    ["--import", preload, join(trusted, "worker/plan-review.mjs"), planFolder],
    {
      cwd: checkout,
      env: {
        ...ENV,
        REVIEW_RULE_ROOT: trusted,
        REVIEW_BASE: base,
        GITHUB_REPOSITORY: "example/repository",
        PR: "1",
      },
      encoding: "utf8",
    },
  );
  assert.equal(planned.status, 0, planned.stderr);
  const plannedFiles = JSON.parse(
    readFileSync(join(planFolder, "plan.json"), "utf8"),
  ).areas.flatMap((area) => area.files);
  assert.ok(plannedFiles.includes("a.js"));
  assert.ok(
    plannedFiles.includes("worker/plan-review.mjs"),
    "PR attributes cannot mark changed source as unread binary",
  );
  assert.equal(existsSync(marker), false);
  assert.equal(readFileSync(join(trusted, ".nvmrc"), "utf8"), readRepoFile(".nvmrc"));
  const state = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m=await import(${JSON.stringify(join(trusted, "worker/review-state.mjs"))});console.log(m.SUMMARY_MARKER);console.log(m.findSummary([{user:{login:"github-actions[bot]"},body:"<!-- claude-review-summary -->"}]));`,
    ],
    { cwd: checkout, env: { ...ENV, REVIEW_TRUSTED: SHA }, encoding: "utf8" },
  );
  assert.equal(state.status, 0, state.stderr);
  assert.equal(state.stdout, "<!-- trusted-review-summary -->\nnull\n");
  assert.throws(
    () => prepareReviewCheckout({ ...ENV, GITHUB_EVENT_NAME: "pull_request" }),
    /workflow authority/,
  );
});
