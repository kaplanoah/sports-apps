import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findTrustedReviewRun,
  isTrustedReviewRun,
  verifyTrustedReviewResult,
} from "../worker/find-trusted-review.mjs";
import { readReviewIdentity, sealReviewArtifact } from "../worker/review-data.mjs";
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
const createFolder = () => mkdtempSync(join(tmpdir(), "trusted-review-join-"));
const writeJson = (folder, name, value) => writeFileSync(join(folder, name), JSON.stringify(value));
test("the join accepts results only from successful trusted workflow runs on the expected head and base", async () => {
  const expected = { repository: "example/repository", head: SHA, base: "b".repeat(40), pull: "1" };
  const run = {
    id: 7,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_branch: "change",
    head_sha: expected.head,
    repository: { full_name: expected.repository, id: 1 },
    pull_requests: [],
    display_title: `Review 1 head ${SHA} base ${expected.base}`,
    conclusion: "success",
    status: "completed",
  };
  assert.ok(isTrustedReviewRun(run, expected));
  // GitHub omits REST associations for fork-triggered runs.
  assert.deepEqual(run.pull_requests, []);
  // The REST association may also describe a later PR head/base; it is not event authority.
  assert.ok(
    isTrustedReviewRun(
      {
        ...run,
        pull_requests: [
          { number: 1, head: { sha: "e".repeat(40) }, base: { sha: "f".repeat(40) } },
        ],
      },
      expected,
    ),
  );
  for (const change of [
    { event: "pull_request" },
    { path: ".github/workflows/ci.yml" },
    { head_sha: expected.base },
    { repository: { full_name: expected.repository, id: 1.5 } },
    { display_title: `Review 2 head ${SHA} base ${expected.base}` },
    { display_title: `Review 1 head ${SHA} base ${SHA}` },
    { display_title: "another head" },
    { repository: { full_name: "other/repository", id: 1 } },
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
  for (const field of ["REVIEW_HEAD", "REVIEW_BASE"])
    assert.throws(
      () => verifyTrustedReviewResult(folder, { ...env, [field]: "e".repeat(40) }),
      /stale or foreign/,
    );
  assert.throws(
    () => verifyTrustedReviewResult(folder, { ...env, REVIEW_TREE: "b".repeat(40) }),
    /does not match/,
  );
  writeJson(folder, "result.json", {
    identity: { ...IDENTITY, run: "8" },
    tree: SHA,
    passed: true,
  });
  sealReviewArtifact(folder, "result", IDENTITY, ["result.json"]);
  assert.throws(() => verifyTrustedReviewResult(folder, env), /does not match/);
  writeJson(folder, "result.json", { identity: IDENTITY, tree: SHA, passed: false });
  sealReviewArtifact(folder, "result", IDENTITY, ["result.json"]);
  assert.throws(() => verifyTrustedReviewResult(folder, env), /does not match/);
});

test("the join searches every artifact page and filters run listings to the immutable head", async () => {
  const expected = {
    repository: "example/repository",
    head: SHA,
    base: "b".repeat(40),
    pull: "1",
    tree: SHA,
  };
  const run = {
    id: 7,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_sha: SHA,
    repository: { full_name: expected.repository, id: 1 },
    pull_requests: [
      { number: 1, head: { sha: SHA }, base: { ref: "main", sha: expected.base, repo: { id: 1 } } },
    ],
    display_title: `Review 1 head ${SHA} base ${expected.base}`,
    conclusion: "success",
    status: "completed",
  };
  const calls = [];
  const readGitHub = async (path) => {
    calls.push(path);
    if (path.includes("artifacts?"))
      return {
        artifacts: /(?:\?|&)page=1(?:&|$)/.test(path)
          ? Array.from({ length: 100 }, () => ({ expired: true }))
          : [{ workflow_run: { id: 7 } }],
      };
    return run;
  };
  assert.deepEqual(await findTrustedReviewRun({ ...expected, readGitHub }), {
    run: 7,
    pending: false,
  });
  assert.ok(calls.some((path) => path.includes("page=2")));
  calls.length = 0;
  const pending = { ...run, status: "in_progress", conclusion: null };
  const readRuns = async (path) => {
    calls.push(path);
    if (path.includes("artifacts?")) return { artifacts: [] };
    return {
      workflow_runs: /(?:\?|&)page=1(?:&|$)/.test(path)
        ? Array.from({ length: 100 }, () => ({ ...run, head_sha: expected.base }))
        : [pending],
    };
  };
  assert.deepEqual(await findTrustedReviewRun({ ...expected, readGitHub: readRuns }), {
    run: null,
    pending: true,
  });
  const listings = calls.filter((path) => path.includes("workflows/review.yml/runs?"));
  assert.ok(listings.some((path) => path.includes("page=2")));
  assert.ok(listings.every((path) => path.includes(`head_sha=${SHA}`)));
});

test("an unrelated fork PR on the same head cannot supply a trusted review result", async () => {
  const expected = {
    repository: "example/repository",
    head: SHA,
    base: "b".repeat(40),
    pull: "1",
    tree: SHA,
  };
  const run = {
    id: 7,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_sha: SHA,
    repository: { full_name: expected.repository, id: 1 },
    pull_requests: [],
    display_title: `Review 2 head ${SHA} base ${expected.base}`,
    conclusion: "success",
    status: "completed",
  };
  const requested = [];
  const readGitHub = async (path) => {
    requested.push(path);
    if (path.includes("artifacts?")) return { artifacts: [{ workflow_run: { id: 7 } }] };
    if (path.includes("/runs/7")) return run;
    return { workflow_runs: [run] };
  };
  assert.deepEqual(await findTrustedReviewRun({ ...expected, readGitHub }), {
    run: null,
    pending: true,
  });
  assert.ok(requested.some((path) => path.includes(`head_sha=${SHA}`)));
  run.display_title = `Review 1 head ${SHA} base ${SHA}`;
  assert.deepEqual(await findTrustedReviewRun({ ...expected, readGitHub }), {
    run: null,
    pending: true,
  });
  run.display_title = `Review 1 head ${SHA} base ${expected.base}`;
  assert.deepEqual(await findTrustedReviewRun({ ...expected, readGitHub }), {
    run: 7,
    pending: false,
  });
});


test("the join rejects changed content and extra files even when result identity fields match", () => {
  const env = { ...ID_ENV, REVIEW_RUN: "7", REVIEW_TREE: SHA };
  const result = { identity: IDENTITY, tree: SHA, passed: true };
  const changed = createFolder();
  writeJson(changed, "result.json", result);
  sealReviewArtifact(changed, "result", IDENTITY, ["result.json"]);
  writeJson(changed, "result.json", { ...result, extra: "changed after sealing" });
  assert.throws(() => verifyTrustedReviewResult(changed, env), /content changed/);
  const extra = createFolder();
  writeJson(extra, "result.json", result);
  sealReviewArtifact(extra, "result", IDENTITY, ["result.json"]);
  writeJson(extra, "extra.json", {});
  assert.throws(() => verifyTrustedReviewResult(extra, env), /unexpected or missing/);
});
