import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findTrustedReviewRun,
  isTrustedReviewRun,
  verifyTrustedReviewResult,
} from "../worker/find-trusted-review.mjs";
import { readReviewIdentity, sealReviewArtifact } from "../worker/review-data.mjs";
import { readRepoFile, REPO_ROOT } from "./repo-files.js";
import { readStepInput } from "./workflow-step.js";

const SHA = "a".repeat(40);
const TREE = "e".repeat(40);
const EXPECTED = { repository: "example/repository", head: SHA, base: "b".repeat(40), pull: "1" };
const ID_ENV = {
  GITHUB_REPOSITORY: EXPECTED.repository,
  GITHUB_RUN_ID: "7",
  REVIEW_HEAD: SHA,
  REVIEW_BASE: EXPECTED.base,
  REVIEW_MERGE: "c".repeat(40),
  REVIEW_TRUSTED: "d".repeat(40),
  GITHUB_WORKFLOW_REF: `${EXPECTED.repository}/.github/workflows/review.yml@refs/heads/main`,
};
const IDENTITY = readReviewIdentity(ID_ENV);
const createFolder = () => mkdtempSync(join(tmpdir(), "trusted-review-join-"));
const writeJson = (folder, name, value) => writeFileSync(join(folder, name), JSON.stringify(value));
const createRun = (changes = {}) => ({
  id: 7,
  path: ".github/workflows/review.yml",
  event: "pull_request_target",
  head_sha: EXPECTED.head,
  repository: { full_name: EXPECTED.repository, id: 1 },
  pull_requests: [],
  display_title: `Review 1 head ${SHA} base ${EXPECTED.base} source ${ID_ENV.REVIEW_TRUSTED}`,
  conclusion: "success",
  status: "completed",
  ...changes,
});

test("actual producer names and CI download inputs agree with the trusted join", async () => {
  const producer = readRepoFile(".github/workflows/review.yml");
  const consumer = readRepoFile(".github/workflows/ci.yml");
  const runName = producer.match(/^run-name: (.+)$/m)?.[1];
  assert.ok(runName);
  const steps = producer.split(/^ {6}- /m);
  const record = steps.findIndex((step) =>
    step.startsWith("name: Record the trusted review result\n"),
  );
  assert.ok(record >= 0);
  const upload = steps[record + 1];
  assert.match(upload, /uses: actions\/upload-artifact@/);
  const download = consumer
    .split(/^ {6}- /m)
    .find((step) => step.includes("run-id: ${{ steps.find.outputs.run }}"));
  assert.ok(download);
  assert.match(download, /uses: actions\/download-artifact@/);
  /** @param {string} template @param {Record<string, string>} context */
  const render = (template, context) =>
    template.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => {
      if (expression.startsWith("github.event.pull_request.user.login ==")) return "review";
      assert.ok(Object.hasOwn(context, expression), `Unknown workflow expression: ${expression}`);
      return context[expression];
    });
  for (const source of [EXPECTED.base, ID_ENV.REVIEW_TRUSTED]) {
    const context = {
      "github.event.pull_request.number": EXPECTED.pull,
      "github.event.pull_request.head.sha": EXPECTED.head,
      "github.event.pull_request.base.sha": EXPECTED.base,
      "github.event.pull_request.base.ref": "main",
      "github.sha": source,
      "steps.result.outputs.tree": TREE,
      "steps.find.outputs.tree": TREE,
      "steps.find.outputs.run": "7",
    };
    const run = createRun({ display_title: render(runName, context) });
    const artifact = {
      name: render(readStepInput(producer, upload, "name"), context),
      workflow_run: { id: run.id },
    };
    assert.ok(isTrustedReviewRun(run, EXPECTED));
    assert.deepEqual(
      await findTrustedReviewRun({
        ...EXPECTED,
        readGitHub: async (path) =>
          path.includes("/artifacts?") ? { artifacts: [artifact] } : { workflow_runs: [run] },
      }),
      { run: run.id, tree: TREE, source, pending: false },
    );
    assert.equal(render(readStepInput(consumer, download, "name"), context), artifact.name);
    assert.equal(render(readStepInput(consumer, download, "run-id"), context), String(run.id));
  }
});

test("only the exact trusted producer's immutable event identity can join, including forks", async () => {
  const run = createRun();
  assert.ok(isTrustedReviewRun(run, EXPECTED));
  assert.ok(
    isTrustedReviewRun(
      { ...run, pull_requests: [{ number: 2, head: { sha: TREE }, base: { sha: TREE } }] },
      EXPECTED,
    ),
    "mutable or missing REST PR associations are not event authority",
  );
  for (const change of [
    { event: "pull_request" },
    { path: ".github/workflows/ci.yml" },
    { head_sha: EXPECTED.base },
    { repository: { full_name: EXPECTED.repository, id: 1.5 } },
    { display_title: `Review 2 head ${SHA} base ${EXPECTED.base} source ${ID_ENV.REVIEW_TRUSTED}` },
    { display_title: `Review 1 head ${SHA} base ${SHA}` },
    { display_title: `Review 1 head ${SHA} base ${EXPECTED.base}` },
    { display_title: `Review 1 head ${SHA} base ${EXPECTED.base} source refs/heads/main` },
    { display_title: `Review 1 head ${SHA} base ${EXPECTED.base} source ${TREE} extra` },
    { repository: { full_name: "other/repository", id: 1 } },
  ])
    assert.equal(isTrustedReviewRun({ ...run, ...change }, EXPECTED), false);
  const calls = [];
  const readGitHub = async (path) => {
    calls.push(path);
    return path.includes("/artifacts?")
      ? { artifacts: [{ name: `trusted-review-passed-${TREE}`, workflow_run: { id: 7 } }] }
      : { workflow_runs: [run] };
  };
  assert.deepEqual(await findTrustedReviewRun({ ...EXPECTED, readGitHub }), {
    run: 7,
    tree: TREE,
    source: ID_ENV.REVIEW_TRUSTED,
    pending: false,
  });
  assert.match(calls[0], new RegExp(`head_sha=${SHA}`));
  assert.match(calls[1], /\/actions\/runs\/7\/artifacts/);
  run.conclusion = "failure";
  calls.length = 0;
  assert.deepEqual(await findTrustedReviewRun({ ...EXPECTED, readGitHub }), {
    run: null,
    tree: null,
    source: null,
    pending: false,
  });
  assert.equal(calls.length, 1, "failed runs need no artifact lookup");
  run.status = "in_progress";
  calls.length = 0;
  assert.deepEqual(await findTrustedReviewRun({ ...EXPECTED, readGitHub }), {
    run: null,
    tree: null,
    source: null,
    pending: true,
  });
  assert.equal(calls.length, 1, "waiting polls read only head-filtered runs");
  calls.length = 0;
  const pending = await findTrustedReviewRun({
    ...EXPECTED,
    readGitHub: async (path) => {
      calls.push(path);
      return { workflow_runs: [run, createRun({ id: 6 })] };
    },
  });
  assert.equal(pending.pending, true);
  assert.equal(calls.length, 1, "older successful runs trigger no artifact lookups while waiting");
  for (const artifact of [
    { name: `trusted-review-passed-${TREE}`, workflow_run: { id: 8 } },
    { name: `trusted-review-passed-${TREE}`, workflow_run: { id: 7 }, expired: true },
    { name: "trusted-review-passed-moving-reference", workflow_run: { id: 7 } },
    { name: "unrelated-artifact", workflow_run: { id: 7 } },
  ])
    assert.deepEqual(
      await findTrustedReviewRun({
        ...EXPECTED,
        readGitHub: async (path) =>
          path.includes("/artifacts?")
            ? { artifacts: [artifact] }
            : { workflow_runs: [createRun()] },
      }),
      { run: null, tree: null, source: null, pending: false },
    );
});

test("producer/run/artifact pagination preserves event binding and rejects ambiguous results", async () => {
  const calls = [];
  const readGitHub = async (path) => {
    calls.push(path);
    const firstPage = /(?:\?|&)page=1(?:&|$)/.test(path);
    if (path.includes("/artifacts?"))
      return {
        artifacts: firstPage
          ? Array.from({ length: 100 }, () => ({ expired: true }))
          : [{ name: `trusted-review-passed-${TREE}`, workflow_run: { id: 7 } }],
      };
    return {
      workflow_runs: firstPage
        ? Array.from({ length: 100 }, () => createRun({ head_sha: TREE }))
        : [createRun()],
    };
  };
  assert.deepEqual(await findTrustedReviewRun({ ...EXPECTED, readGitHub }), {
    run: 7,
    tree: TREE,
    source: ID_ENV.REVIEW_TRUSTED,
    pending: false,
  });
  assert.equal(calls.length, 4);
  assert.ok(
    calls
      .filter((path) => path.includes("/runs?"))
      .every((path) => path.includes(`head_sha=${SHA}`)),
  );
  await assert.rejects(
    () =>
      findTrustedReviewRun({
        ...EXPECTED,
        readGitHub: async (path) =>
          path.includes("/artifacts?")
            ? {
                artifacts: [TREE, SHA].map((tree) => ({
                  name: `trusted-review-passed-${tree}`,
                  workflow_run: { id: 7 },
                })),
              }
            : { workflow_runs: [createRun()] },
      }),
    /ambiguous/,
  );
});

/** @param {string} folder @param {any} result @param {any} [identity] */
function sealResult(folder, result, identity = IDENTITY) {
  writeJson(folder, "result.json", result);
  sealReviewArtifact(folder, "result", identity, ["result.json"]);
}

test("sealed verification rejects foreign or modified evidence and producer source drift", () => {
  const folder = createFolder();
  const result = { identity: IDENTITY, tree: TREE, passed: true };
  const env = { ...ID_ENV, REVIEW_RUN: "7", REVIEW_TREE: TREE };
  sealResult(folder, result);
  assert.deepEqual(verifyTrustedReviewResult(folder, env), { merge: IDENTITY.merge, tree: TREE });
  for (const change of [
    { REVIEW_RUN: "8" },
    { REVIEW_HEAD: TREE },
    { REVIEW_BASE: TREE },
    { REVIEW_TREE: SHA },
  ])
    assert.throws(() => verifyTrustedReviewResult(folder, { ...env, ...change }));
  for (const identity of [
    { ...IDENTITY, run: "8" },
    { ...IDENTITY, trusted: TREE },
    { ...IDENTITY, merge: "moving-reference" },
  ]) {
    sealResult(folder, { ...result, identity }, identity);
    assert.throws(() => verifyTrustedReviewResult(folder, env));
  }
  sealResult(folder, { ...result, passed: false });
  assert.throws(() => verifyTrustedReviewResult(folder, env), /does not match/);
  sealResult(folder, result);
  writeJson(folder, "result.json", { ...result, extra: "changed after sealing" });
  assert.throws(() => verifyTrustedReviewResult(folder, env), /content changed/);
  sealResult(folder, result);
  writeJson(folder, "extra.json", {});
  assert.throws(() => verifyTrustedReviewResult(folder, env), /unexpected or missing/);
});

/** @param {string} folder @param {string[]} args */
const readGit = (folder, args) =>
  execFileSync("git", args, {
    cwd: folder,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function createMergeFixture() {
  const origin = createFolder();
  readGit(origin, ["init", "-b", "main"]);
  readGit(origin, ["config", "user.name", "Example"]);
  readGit(origin, ["config", "user.email", "example@example.com"]);
  writeFileSync(join(origin, "a.js"), "base\n");
  readGit(origin, ["add", "."]);
  readGit(origin, ["commit", "-m", "base"]);
  const base = readGit(origin, ["rev-parse", "HEAD"]);
  readGit(origin, ["checkout", "-b", "change"]);
  writeFileSync(join(origin, "a.js"), "head\n");
  readGit(origin, ["commit", "-am", "head"]);
  const head = readGit(origin, ["rev-parse", "HEAD"]);
  readGit(origin, ["checkout", "main"]);
  readGit(origin, ["merge", "--no-ff", "change", "-m", "reviewed merge"]);
  const merge = readGit(origin, ["rev-parse", "HEAD"]);
  const tree = readGit(origin, ["rev-parse", "HEAD^{tree}"]);
  const checkout = join(createFolder(), "checkout");
  readGit(origin, ["init", checkout]);
  readGit(checkout, ["remote", "add", "origin", origin]);
  readGit(checkout, ["fetch", "--depth=1", "origin", base]);
  readGit(checkout, ["checkout", "--detach", "FETCH_HEAD"]);
  assert.equal(readGit(checkout, ["rev-parse", "--is-shallow-repository"]), "true");
  assert.throws(
    () => readGit(checkout, ["cat-file", "-e", merge]),
    "resolved merge must be fetched",
  );
  return { base, head, merge, tree, checkout };
}

/** @param {any} fixture @param {Record<string, string>} [changes] @param {string[]} [args] */
function invokeJoin(fixture, changes = {}, args = []) {
  const folder = createFolder();
  const output = join(folder, "output");
  const calls = join(folder, "calls.jsonl");
  const preload = join(folder, "api.mjs");
  writeFileSync(
    preload,
    `
    import { appendFileSync } from 'node:fs';
    let now = 0, reads = 0;
    const fixture = ${JSON.stringify(fixture)};
    const record = (value) => appendFileSync(${JSON.stringify(calls)}, JSON.stringify(value) + '\\n');
    Date.now = () => now;
    globalThis.setTimeout = (callback, delay) => { now += delay; record({ wait: delay }); queueMicrotask(callback); };
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname + new URL(url).search;
      record({ path, time: now });
      if (fixture.apiFailure) return new Response('', { status: 403 });
      if (path.includes('/actions/workflows/review.yml/runs?')) {
        reads++;
        return Response.json({ workflow_runs: fixture.absent ? [] : [{
          id: 7, path: '.github/workflows/review.yml', event: 'pull_request_target',
          head_sha: fixture.head, repository: { full_name: 'example/repository', id: 1 },
          display_title: 'Review 1 head ' + fixture.head + ' base ' + fixture.base + ' source ' + (fixture.source ?? fixture.base),
          status: reads <= (fixture.pendingReads ?? 0) ? 'in_progress' : 'completed',
          conclusion: fixture.failure ? 'failure' : 'success'
        }] });
      }
      if (path.includes('/actions/runs/7/artifacts?'))
        return Response.json({ artifacts: [{ name: 'trusted-review-passed-' + fixture.tree, workflow_run: { id: 7 } }] });
      throw new Error('Unexpected API request: ' + path);
    };
  `,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", preload, new URL("worker/find-trusted-review.mjs", REPO_ROOT).pathname, ...args],
    {
      cwd: fixture.checkout,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "example/repository",
        GH_TOKEN: "example",
        GITHUB_OUTPUT: output,
        GITHUB_WORKSPACE: fixture.checkout,
        REVIEW_HEAD: fixture.head,
        REVIEW_BASE: fixture.base,
        REVIEW_TIMEOUT_MINUTES: "120",
        REVIEW_RUN: "7",
        REVIEW_TREE: fixture.tree,
        REVIEW_TRUSTED: fixture.source ?? fixture.base,
        PR: "1",
        ...changes,
      },
    },
  );
  return {
    ...result,
    output: (() => {
      try {
        return readFileSync(output, "utf8");
      } catch {
        return "";
      }
    })(),
    calls: (() => {
      try {
        return readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    })(),
  };
}

test("real CLI waits cheaply, writes exact run/owed/tree evidence, and never needs an event merge", () => {
  const fixture = { ...createMergeFixture(), source: TREE };
  const result = invokeJoin({ ...fixture, pendingReads: 4 }, { REVIEW_MERGE: "stale-reference" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.output,
    `run=7\nowed=false\ntree=${fixture.tree}\nsource=${fixture.source}\n`,
  );
  assert.deepEqual(
    result.calls.filter((call) => call.wait).map((call) => call.wait),
    [60000, 120000, 240000, 300000],
  );
  const requests = result.calls.filter((call) => call.path);
  assert.equal(requests.length, 6);
  assert.equal(requests.filter((call) => call.path.includes("/artifacts?")).length, 1);
  assert.ok(requests.slice(0, -1).every((call) => call.path.includes(`head_sha=${fixture.head}`)));
  const failed = invokeJoin({ ...fixture, failure: true });
  assert.equal(failed.status, 0, failed.stderr);
  assert.equal(failed.output, "run=\nowed=true\ntree=\nsource=\n");
  assert.match(failed.stdout, /review remains owed/);
  const refused = invokeJoin({ ...fixture, apiFailure: true });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /GitHub answered 403/);
  assert.equal(refused.output, "");
});

test("real CLI deadline derives from job timeout and bounds API use while absent or pending", () => {
  const fixture = createMergeFixture();
  const workflow = readRepoFile(".github/workflows/ci.yml");
  const minutes = workflow.match(/timeout-minutes: &review-join-timeout (\d+)/)?.[1];
  assert.ok(minutes);
  assert.match(workflow, /REVIEW_TIMEOUT_MINUTES: \*review-join-timeout/);
  for (const scenario of [{ absent: true }, { pendingReads: 10000 }]) {
    const result = invokeJoin({ ...fixture, ...scenario }, { REVIEW_TIMEOUT_MINUTES: minutes });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Timed out waiting for trusted review/);
    assert.equal(result.output, "");
    const requests = result.calls.filter((call) => call.path);
    assert.ok(requests.length <= 25, `${requests.length} requests for the entire join deadline`);
    assert.ok(requests.filter((call) => call.time < 60 * 60000).length <= 14);
    assert.ok(requests.every((call) => !call.path.includes("/artifacts?")));
    assert.equal(
      result.calls.filter((call) => call.wait).reduce((sum, call) => sum + call.wait, 0),
      (Number(minutes) - 10) * 60000,
    );
  }
  const invalid = invokeJoin(fixture, { REVIEW_TIMEOUT_MINUTES: "10" });
  assert.match(invalid.stderr, /longer than its finish budget/);
});

test("real verify CLI accepts the sealed resolved merge and rejects mismatched parents, tree or run", () => {
  const fixture = { ...createMergeFixture(), source: TREE };
  const folder = createFolder();
  const identity = readReviewIdentity({
    ...ID_ENV,
    REVIEW_HEAD: fixture.head,
    REVIEW_BASE: fixture.base,
    REVIEW_MERGE: fixture.merge,
    REVIEW_TRUSTED: fixture.source,
  });
  const result = { identity, tree: fixture.tree, passed: true };
  sealResult(folder, result, identity);
  const verified = invokeJoin(fixture, { REVIEW_MERGE: "stale-reference" }, ["verify", folder]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.output, `tree=${fixture.tree}\n`);
  assert.equal(
    readGit(fixture.checkout, ["rev-parse", "HEAD"]),
    fixture.base,
    "verification never checks out reviewed code",
  );
  for (const changes of [
    { REVIEW_RUN: "8" },
    { REVIEW_BASE: fixture.head },
    { REVIEW_TREE: SHA },
    { REVIEW_TRUSTED: fixture.base },
  ]) {
    const rejected = invokeJoin(fixture, changes, ["verify", folder]);
    assert.notEqual(rejected.status, 0);
    assert.equal(rejected.output, "");
  }
  for (const changed of [
    { ...result, identity: { ...identity, merge: fixture.head } },
    { ...result, tree: SHA },
  ]) {
    sealResult(folder, changed, changed.identity);
    const rejected = invokeJoin(fixture, { REVIEW_TREE: changed.tree }, ["verify", folder]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /reviewed merge does not match/);
    assert.equal(rejected.output, "");
  }
});
