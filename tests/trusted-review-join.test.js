import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTrustedReviewRun, isTrustedReviewRun, verifyTrustedReviewResult } from "../worker/find-trusted-review.mjs";
import { readReviewIdentity, sealReviewArtifact } from "../worker/review-data.mjs";
const SHA = "a".repeat(40);
const ID_ENV = { GITHUB_REPOSITORY: "example/repository", GITHUB_RUN_ID: "7", REVIEW_HEAD: SHA, REVIEW_BASE: "b".repeat(40), REVIEW_MERGE: "c".repeat(40), REVIEW_TRUSTED: "d".repeat(40), GITHUB_WORKFLOW_REF: "example/repository/.github/workflows/review.yml@refs/heads/main" };
const IDENTITY = readReviewIdentity(ID_ENV);
const createFolder = () => mkdtempSync(join(tmpdir(), "trusted-review-join-"));
const writeJson = (folder, name, value) => writeFileSync(join(folder,name), JSON.stringify(value));
test("the join accepts results only from successful trusted workflow runs on the expected head and base", async () => {
  const expected = { repository: "example/repository", head: SHA, base: "b".repeat(40), pull: "1" };
  const run = {
    id: 7,
    path: ".github/workflows/review.yml",
    event: "pull_request_target",
    head_branch: "change",
    head_sha: expected.head,
    repository: { full_name: expected.repository, id: 1 },
    pull_requests: [
      {
        number: 1,
        head: { sha: expected.head },
        base: { ref: "main", sha: expected.base, repo: { id: 1 } },
      },
    ],
    display_title: `Review 1 head ${SHA} base ${expected.base}`,
    conclusion: "success",
    status: "completed",
  };
  assert.ok(isTrustedReviewRun(run, expected));
  for (const change of [
    { event: "pull_request" },
    { path: ".github/workflows/ci.yml" },
    { head_sha: expected.base },
    { pull_requests: [] },
    { pull_requests: [{ ...run.pull_requests[0], number: 2 }] },
    {
      pull_requests: [
        { ...run.pull_requests[0], base: { ...run.pull_requests[0].base, ref: "change" } },
      ],
    },
    {
      pull_requests: [
        { ...run.pull_requests[0], base: { ...run.pull_requests[0].base, repo: { id: 2 } } },
      ],
    },
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

