import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arrangeCodexPortions,
  buildCodexRequest,
  acceptCodexAnswer,
} from "../worker/review-codex.mjs";
import { recomputeReviewCoverage, readReviewIdentity } from "../worker/review-data.mjs";
import { exportReviewArtifact, importReviewArtifacts } from "../worker/trusted-review.mjs";
import { readRepoFile, REPO_ROOT } from "./repo-files.js";
import { createNativeRateHook } from "../worker/codex-rate-runtime.mjs";

const ENV = {
  GITHUB_REPOSITORY: "example/repository",
  GITHUB_RUN_ID: "7",
  REVIEW_HEAD: "a".repeat(40),
  REVIEW_BASE: "b".repeat(40),
  REVIEW_MERGE: "c".repeat(40),
  REVIEW_TRUSTED: "d".repeat(40),
  GITHUB_WORKFLOW_REF: "example/repository/.github/workflows/review.yml@refs/heads/main",
  REVIEW_PROVIDER: "codex",
  REVIEW_SELECTION: "initial",
};
const IDENTITY = readReviewIdentity(ENV);
const CANDIDATE = {
  path: "shared/page/value.js",
  line: 1,
  weight: "Important",
  confidence: "high",
  claim: "Late result replaces a newer value.",
  when: "Two callers complete out of order.",
  fix: "Discard the stale result.",
};
const FINDING = {
  ids: ["1.1"],
  path: CANDIDATE.path,
  line: 1,
  weight: "Important",
  verdict: "confirmed",
  body: CANDIDATE.claim,
  why: "Both callers share state.",
};

/** @param {boolean} [large] */
function createFixture(large = false) {
  const folder = mkdtempSync(join(tmpdir(), "codex-review-"));
  const files = ["shared/page/value.js", ...(large ? ["apps/mlb/worker/src/read.js"] : [])];
  const plan = {
    provider: "codex",
    selection: "initial",
    stage: "first",
    since: null,
    unread: [],
    areas: files.map((file, index) => ({
      area: index + 1,
      name: `portion ${index + 1}`,
      files: [file],
      rules: ["rules/tooling.md"],
      partsByFile: { [file]: [`first/${index + 1}.diff`] },
    })),
  };
  mkdirSync(join(folder, "first"));
  mkdirSync(join(folder, "rules"));
  for (const path of [
    "REVIEW.md",
    "AGENTS.md",
    "pull-request.md",
    "test-context.md",
    "stale-names.md",
    "first.md",
    "rules/tooling.md",
    ...files.map((_, index) => `first/${index + 1}.diff`),
  ])
    writeFileSync(join(folder, path), `${path}\n` + "complete required content\n".repeat(2200));
  writeFileSync(join(folder, "plan.json"), JSON.stringify(plan));
  return { folder, plan };
}

/** @param {string} folder @param {number | "integration"} portion @param {any} [changes] */
function createAnswer(folder, portion, changes = {}) {
  const request = buildCodexRequest(folder, portion, IDENTITY);
  const answer = {
    binding: request.binding,
    complete: true,
    unfinished: [],
    unjudged: [],
    ...(portion !== "integration" ? { candidates: [] } : {}),
    ...(portion === "integration" ||
    JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")).areas.length === 1
      ? { findings: [] }
      : {}),
    ...changes,
  };
  return JSON.stringify(answer);
}

test("the native request exports the shared queue before the model job can start", () => {
  const { folder } = createFixture();
  const upload = mkdtempSync(join(tmpdir(), "codex-request-"));
  const output = join(upload, "output");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("worker/review-codex.mjs", REPO_ROOT)), "request", "1"],
    {
      env: {
        ...process.env,
        ...ENV,
        REVIEW_FOLDER: folder,
        REVIEW_UPLOAD: upload,
        GITHUB_OUTPUT: output,
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, "utf8"), /^model-queue=[\w./-]+$/m);
});

test("native portions follow semantic code and tests rather than Claude area counts or line limits", () => {
  const { plan } = createFixture(true);
  const one = { ...plan.areas[0], name: "shared page part 1" };
  const two = {
    ...one,
    area: 2,
    files: ["shared/page/other.js"],
    partsByFile: { "shared/page/other.js": ["first/other.diff"] },
  };
  const arranged = arrangeCodexPortions({ ...plan, areas: [one, two, plan.areas[1]] }, []);
  assert.equal(arranged.areas.length, 2);
  assert.deepEqual(arranged.areas[0].files, [CANDIDATE.path, "shared/page/other.js"]);
});

test("an app test without a matching source belongs with that app rather than tooling", () => {
  const { plan } = createFixture();
  const file = "apps/mlb/tests/schedule.test.js";
  const area = { ...plan.areas[0], files: [file], partsByFile: { [file]: ["first/test.diff"] } };
  assert.equal(arrangeCodexPortions({ ...plan, areas: [area] }, []).areas[0].name, "mlb page");
});

test("a portion can anchor cross-area candidates on any changed file, while foreign paths fail", () => {
  const { folder, plan } = createFixture(true);
  const candidate = { ...CANDIDATE, path: plan.areas[1].files[0] };
  assert.match(buildCodexRequest(folder, 1, IDENTITY).prompt, /including another portion/);
  acceptCodexAnswer(folder, 1, IDENTITY, createAnswer(folder, 1, { candidates: [candidate] }));
  assert.equal(
    JSON.parse(readFileSync(join(folder, "find-1.json"), "utf8")).tries[0].answer.items[0].path,
    candidate.path,
  );
  assert.throws(
    () =>
      acceptCodexAnswer(
        folder,
        1,
        IDENTITY,
        createAnswer(folder, 1, {
          candidates: [{ ...candidate, path: "unrelated.js" }],
        }),
      ),
    /reviewed change/,
  );
});

test("Codex instructions disclose that unjudged work prevents approval", () => {
  const { folder } = createFixture();
  assert.match(
    buildCodexRequest(folder, 1, IDENTITY).prompt,
    /any unfinished or unjudged work prevents approval/,
  );
});

test("the trusted shell capture keeps native events out of stdout and preserves failure status", () => {
  const folder = mkdtempSync(join(tmpdir(), "codex-capture-"));
  mkdirSync(join(folder, "codex-answer"));
  const env = { ...process.env, RUNNER_TEMP: folder, REVIEW_CHECKOUT: folder };
  const config = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("worker/review-codex.mjs", REPO_ROOT)), "config"],
    { env, encoding: "utf8" },
  );
  assert.equal(config.status, 0, config.stderr);
  assert.match(
    readFileSync(join(folder, "codex-home/config.toml"), "utf8"),
    /unbounded_connection_retries = false/,
  );
  mkdirSync(join(folder, "public"));
  const launcher = join(folder, "public/runtime.mjs");
  writeFileSync(launcher, "process.exit(0);\n");
  const hook = join(folder, "hook.sh");
  writeFileSync(hook, createNativeRateHook(folder, process.execPath));
  const script = join(folder, "step.sh");
  writeFileSync(
    script,
    "printf '%s\\n' '{\"type\":\"turn.completed\"}'; printf '%s\\n' 'tool output' >&2; exit 7\n",
  );
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", script], {
    env: {
      PATH: process.env.PATH,
      RUNNER_TEMP: folder,
      CODEX_PROMPT_FILE: "prompt.txt",
      BASH_ENV: hook,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 7);
  assert.equal(result.stdout + result.stderr, "");
  assert.equal(
    readFileSync(join(folder, "codex-events.jsonl"), "utf8"),
    '{"type":"turn.completed"}\ntool output\n',
  );
  const workflow = readRepoFile(".github/workflows/trusted-codex-review.yml");
  writeFileSync(launcher, "process.exit(3);\n");
  const blocked = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", script], {
    env: {
      PATH: process.env.PATH,
      RUNNER_TEMP: folder,
      CODEX_PROMPT_FILE: "prompt.txt",
      BASH_ENV: hook,
    },
    encoding: "utf8",
  });
  assert.equal(blocked.status, 1);
  assert.equal(
    readFileSync(join(folder, "codex-events.jsonl"), "utf8"),
    '{"type":"turn.completed"}\ntool output\n',
  );
  assert.match(workflow, /BASH_ENV: \$\{\{ steps.rate.outputs.hook \}\}/);
  assert.match(workflow, /name: Retain only native usage counters\n {8}if: always\(\)/);
  assert.match(workflow, /review-codex.mjs" usage/);
  const upload = workflow.split("name: trusted-codex-answer-")[1].split("  validate:")[0];
  assert.doesNotMatch(upload, /codex-events|events.jsonl/);
  assert.match(
    upload,
    /path: \|\n {12}\$\{\{ runner.temp \}\}\/codex-answer\/answer.json\n {12}\$\{\{ runner.temp \}\}\/codex-answer\/usage.jsonl\n/,
  );
  assert.match(upload, /retention-days: 1\n/);
  writeFileSync(
    join(folder, "codex-events.jsonl"),
    '{"type":"item.completed","secret":"raw tool output"}\n' +
      '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":2,"output_tokens":3,"secret":"private"}}\n',
  );
  const usage = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("worker/review-codex.mjs", REPO_ROOT)), "usage"],
    { env, encoding: "utf8" },
  );
  assert.equal(usage.status, 0, usage.stderr);
  assert.equal(usage.stdout + usage.stderr, "");
  assert.equal(
    readFileSync(join(folder, "codex-answer/usage.jsonl"), "utf8"),
    '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":2,"output_tokens":3}}',
  );
});

test("a contained session receives all content and verifies every candidate without fake Read events", () => {
  const { folder, plan } = createFixture();
  const request = buildCodexRequest(folder, 1, IDENTITY);
  assert.ok(request.prompt.includes(readFileSync(join(folder, "first/1.diff"), "utf8")));
  assert.match(request.prompt, /Follow callers, shared state, related code, failure paths/);
  acceptCodexAnswer(
    folder,
    1,
    IDENTITY,
    createAnswer(folder, 1, { candidates: [CANDIDATE], findings: [FINDING] }),
  );
  const record = JSON.parse(readFileSync(join(folder, "find-1.json"), "utf8"));
  assert.equal(record.tries[0].reads, undefined);
  assert.equal(record.tries[0].evidence.kind, "supplied-content");
  assert.deepEqual(recomputeReviewCoverage(record, plan.areas[0], folder).unread, []);
  assert.equal(
    JSON.parse(readFileSync(join(folder, "across.json"), "utf8")).items[0].verdict,
    "confirmed",
  );
});

test("native candidate instructions match the inputs for each review phase", () => {
  const contained = createFixture();
  const containedRequest = buildCodexRequest(contained.folder, 1, IDENTITY);
  assert.match(
    containedRequest.prompt,
    /first investigate and list candidates, then verify every claim/,
  );
  assert.doesNotMatch(containedRequest.prompt, /BEGIN SUPPLIED "candidates.json"/);
  assert.match(containedRequest.prompt, /the base is HEAD\^1/);

  const { folder, plan } = createFixture(true);
  for (const area of plan.areas) {
    const request = buildCodexRequest(folder, area.area, IDENTITY);
    assert.match(
      request.prompt,
      /No candidates.json or prior candidate ids are supplied or required in this stage/,
    );
    assert.doesNotMatch(request.prompt, /Candidate ids for integration are supplied/);
    assert.doesNotMatch(request.prompt, /BEGIN SUPPLIED "candidates.json"/);
    assert.match(request.prompt, /the base is HEAD\^1/);
    acceptCodexAnswer(folder, area.area, IDENTITY, createAnswer(folder, area.area));
  }
  writeFileSync(join(folder, "candidates.json"), "[]");
  const integrated = buildCodexRequest(folder, "integration", IDENTITY);
  assert.match(integrated.prompt, /Candidate ids for integration are supplied in candidates.json/);
  assert.match(integrated.prompt, /BEGIN SUPPLIED "candidates.json"/);
  assert.doesNotMatch(integrated.prompt, /No candidates.json or prior candidate ids/);

  const offline = buildCodexRequest(folder, 1, { ...IDENTITY, kind: "offline-trial" });
  assert.match(
    offline.prompt,
    /trusted trial context in supplied pull-request.md defines the review scope/,
  );
  assert.doesNotMatch(offline.prompt, /the base is HEAD\^1/);
  assert.doesNotMatch(integrated.prompt, /trusted trial context/);
});

test("unavailable optional telemetry preserves the valid answer for required fresh-runner validation", () => {
  const workflow = readRepoFile(".github/workflows/trusted-codex-review.yml");
  assert.match(workflow, /validate:\n {4}needs: model/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  for (const telemetry of [null, "{private malformed telemetry", "no completed turn"]) {
    const { folder } = createFixture();
    const runner = mkdtempSync(join(tmpdir(), "codex-optional-usage-"));
    mkdirSync(join(runner, "codex-answer"));
    const answer = createAnswer(folder, 1);
    writeFileSync(join(runner, "codex-answer/answer.json"), answer);
    if (telemetry !== null) writeFileSync(join(runner, "codex-events.jsonl"), telemetry);
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("worker/review-codex.mjs", REPO_ROOT)), "usage"],
      { env: { ...process.env, RUNNER_TEMP: runner }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Native usage unavailable/);
    assert.doesNotMatch(result.stdout + result.stderr, /private|malformed/);
    assert.equal(existsSync(join(runner, "codex-answer/usage.jsonl")), false);
    acceptCodexAnswer(
      folder,
      1,
      IDENTITY,
      readFileSync(join(runner, "codex-answer/answer.json"), "utf8"),
    );
    assert.equal(existsSync(join(folder, "across.json")), true);
  }
});

test("malformed, unfinished, interrupted, unbound and undisposed answers cannot approve", () => {
  for (const changes of [
    { complete: false },
    { unfinished: ["inspect callers"] },
    { unjudged: [{ file: CANDIDATE.path, why: "unknown" }] },
    { binding: "foreign" },
    { candidates: [CANDIDATE], findings: [] },
    { findings: [FINDING] },
    { extra: true },
    { candidates: [{ ...CANDIDATE, line: 0 }] },
  ]) {
    const { folder } = createFixture();
    assert.throws(() => acceptCodexAnswer(folder, 1, IDENTITY, createAnswer(folder, 1, changes)));
  }
  const { folder } = createFixture();
  for (const output of ["", "null", "{}", "{partial", "[]"])
    assert.throws(() => acceptCodexAnswer(folder, 1, IDENTITY, output));
});

test("a large review requires an integration pass even when all portions found nothing", () => {
  const { folder, plan } = createFixture(true);
  for (const area of plan.areas)
    acceptCodexAnswer(folder, area.area, IDENTITY, createAnswer(folder, area.area));
  writeFileSync(join(folder, "candidates.json"), "[]");
  const request = buildCodexRequest(folder, "integration", IDENTITY);
  for (const area of plan.areas)
    assert.ok(
      request.prompt.includes(readFileSync(join(folder, `first/${area.area}.diff`), "utf8")),
    );
  assert.match(
    request.prompt,
    /mandatory independent integration pass, even when candidates are empty/,
  );
  acceptCodexAnswer(folder, "integration", IDENTITY, createAnswer(folder, "integration"));
  const across = JSON.parse(readFileSync(join(folder, "across.json"), "utf8"));
  assert.equal(across.evidence.portion, "integration");
});

test("sealed native artifacts revalidate supplied content, exact code, provider and integration", () => {
  const { folder } = createFixture();
  const upload = mkdtempSync(join(tmpdir(), "codex-uploads-"));
  const env = { ...ENV, REVIEW_UPLOAD: upload };
  exportReviewArtifact(folder, "plan", env);
  acceptCodexAnswer(folder, 1, IDENTITY, createAnswer(folder, 1));
  exportReviewArtifact(folder, "find-1", env);
  exportReviewArtifact(folder, "across", env);
  const destination = () => mkdtempSync(join(tmpdir(), "codex-import-"));
  assert.equal(importReviewArtifacts(upload, destination(), env).provider, "codex");
  for (const change of [
    { REVIEW_HEAD: "e".repeat(40) },
    { REVIEW_BASE: "e".repeat(40) },
    { REVIEW_SELECTION: "3" },
    { REVIEW_PROVIDER: "claude" },
  ])
    assert.throws(() => importReviewArtifacts(upload, destination(), { ...env, ...change }));
  const record = JSON.parse(readFileSync(join(folder, "find-1.json"), "utf8"));
  for (const mutation of [
    (copy) => copy.tries[0].evidence.files.pop(),
    (copy) => (copy.tries[0].evidence.files[0].sha256 = "0".repeat(64)),
    (copy) => (copy.tries[0].reads = []),
  ]) {
    const copy = structuredClone(record);
    mutation(copy);
    assert.throws(() =>
      recomputeReviewCoverage(
        copy,
        JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")).areas[0],
        folder,
      ),
    );
  }
});

test("native execution has pinned official tooling, isolated credentials and no privileged publishing", () => {
  const workflow = readRepoFile(".github/workflows/trusted-codex-review.yml");
  const routing = readRepoFile(".github/workflows/review.yml");
  assert.match(routing, /integration: \$\{\{ steps.plan.outputs.integration \}\}/);
  assert.match(routing, /needs.review-plan.outputs.integration == 'true'/);
  assert.match(workflow, /openai\/codex-action@c05cfd74ad95c626cdf05c6685e62becc3bf7813/);
  assert.match(workflow, /codex-version: 0.164.0/);
  assert.match(workflow, /permission-profile: ":read-only"/);
  assert.match(workflow, /safety-strategy: drop-sudo/);
  assert.match(workflow, /output-schema-file:/);
  const model = workflow.split("  model:\n")[1].split("  validate:\n")[0];
  assert.match(model, /- \*plan\n/);
  assert.match(model, /- \*import\n/);
  assert.match(workflow, /validate:\n {4}needs: model\n {4}runs-on: ubuntu-latest/);
  assert.doesNotMatch(
    workflow,
    /self-hosted|claude|ANTHROPIC|pull-requests: write|checks: write|max-turns|continue-on-error/,
  );
});
