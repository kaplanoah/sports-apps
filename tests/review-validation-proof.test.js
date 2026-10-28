import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareValidationFixture,
  verifyValidationFixture,
  requireRejection,
} from "../worker/prove-review-validation.mjs";
import { readRepoFile } from "./repo-files.js";

const OWNER = {
  GITHUB_REPOSITORY: "kaplanoah/sports-apps",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_ACTOR: "kaplanoah",
  GITHUB_TRIGGERING_ACTOR: "kaplanoah",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "f".repeat(40),
  GITHUB_RUN_ID: "123",
};

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "validator-proof-test-"));
  const folder = join(root, "prepared");
  const env = { ...OWNER, RUNNER_TEMP: root };
  prepareValidationFixture(folder, env);
  const transferred = join(root, "downloaded");
  cpSync(folder, transferred, { recursive: true });
  rmSync(folder, { recursive: true });
  return { root, folder: transferred, env };
}

test("transferred controls exercise production rejection without claiming model or publishing evidence", () => {
  const { folder, env, root } = createFixture();
  try {
    const proof = verifyValidationFixture(folder, env);
    assert.equal(proof.kind, "synthetic-validator-proof");
    assert.equal(proof.source, OWNER.GITHUB_SHA);
    assert.equal(proof.run, OWNER.GITHUB_RUN_ID);
    assert.deepEqual(proof.checks, [
      "valid-sealed-artifact-fixture",
      "valid-empty-integration-fixture",
      "stale-head",
      "stale-base",
      "stale-source",
      "stale-run",
      "mixed-provider",
      "changed-provider-selection",
      "malformed-answer",
      "incomplete-answer",
      "unjudged-answer",
      "missing-supplied-coverage",
      "missing-integration-evidence",
      "valid-publication-producers-fixture",
      "missing-integration-producer",
      "interrupted-model-producer",
      "missing-validation-producer",
    ]);
    assert.equal(proof.modelExecuted, false);
    assert.equal(proof.githubCheckPublished, false);
    assert.equal(proof.actualInterruptionProved, false);
    assert.doesNotMatch(JSON.stringify(proof), /binding|promptSha256|candidates|tries/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("negative controls must actually reject for the expected reason", () => {
  assert.throws(
    () => requireRejection(() => {}, /expected/),
    /Validator accepted a negative control/,
  );
  assert.throws(
    () =>
      requireRejection(() => {
        throw new Error("a different failure");
      }, /expected/),
    /Validator proof failed for an unexpected reason/,
  );
  assert.doesNotThrow(() =>
    requireRejection(() => {
      throw new Error("expected failure");
    }, /expected/),
  );
});

test("CLI reports only known failure messages and keeps unexpected diagnostics out of logs", () => {
  const { root, folder, env } = createFixture();
  const command = fileURLToPath(new URL("../worker/prove-review-validation.mjs", import.meta.url));
  const invokeProof = (argument, changes = {}) =>
    spawnSync(process.execPath, [command, argument], {
      encoding: "utf8",
      env: { ...process.env, ...env, ...changes },
    });
  try {
    const denied = invokeProof("prepare", { GITHUB_ACTOR: "outsider" });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /one owner dispatch on main/);
    const unknown = invokeProof("unknown");
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown validator proof command/);
    const input = join(root, "codex-validation-fixture");
    const prepared = invokeProof("prepare");
    assert.equal(prepared.status, 0, prepared.stderr);
    const accepted = invokeProof("verify");
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(
      JSON.parse(readFileSync(join(root, "codex-validation-proof.json"), "utf8")).kind,
      "synthetic-validator-proof",
    );
    writeFileSync(join(input, "manifest.json"), "private-invalid-manifest-data");
    const malformed = invokeProof("verify");
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /Validator proof failed/);
    assert.doesNotMatch(malformed.stderr, /private-invalid-manifest-data|SyntaxError|node:fs/);
    const foreign = {
      kind: "synthetic-validator-fixture",
      source: "e".repeat(40),
      run: env.GITHUB_RUN_ID,
    };
    writeFileSync(join(input, "manifest.json"), JSON.stringify(foreign));
    const rejected = invokeProof("verify");
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Foreign validator fixture/);
    cpSync(join(folder, "manifest.json"), join(input, "manifest.json"));
    writeFileSync(
      join(input, "artifacts/trusted-review-plan/plan.json"),
      "private-invalid-fixture-data",
    );
    const unexpected = invokeProof("verify");
    assert.notEqual(unexpected.status, 0);
    assert.match(
      unexpected.stderr,
      /Control valid-sealed-artifact-fixture: Unexpected validator error/,
    );
    assert.doesNotMatch(unexpected.stderr, /private-invalid-fixture-data|SyntaxError|node:fs/);
    assert.equal(unknown.stdout, "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("foreign source, run and fixture kind cannot produce a proof", () => {
  const { folder, env, root } = createFixture();
  const path = join(folder, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  try {
    for (const mutation of [
      { source: "e".repeat(40) },
      { run: "124" },
      { kind: "native-review" },
    ]) {
      writeFileSync(path, JSON.stringify({ ...manifest, ...mutation }));
      assert.throws(() => verifyValidationFixture(folder, env), /Foreign validator fixture/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken positive control fails instead of being counted as a successful rejection", () => {
  const { folder, env, root } = createFixture();
  try {
    writeFileSync(join(folder, "artifacts/trusted-review-plan/plan.json"), "{}");
    assert.throws(() => verifyValidationFixture(folder, env));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fixture preparation and verification both reject unauthorized execution", () => {
  const { folder, env, root } = createFixture();
  try {
    for (const changes of [
      { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_ACTOR: "outsider" },
      { GITHUB_REF: "refs/heads/feature" },
      { TRUSTED_CODEX_REVIEW_ENABLED: "true" },
    ]) {
      assert.throws(() => prepareValidationFixture(join(root, "denied"), { ...env, ...changes }));
      assert.throws(() => verifyValidationFixture(folder, { ...env, ...changes }));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hosted controls transfer artifacts between isolated jobs with no paid or publishing credentials", () => {
  const workflow = readRepoFile(".github/workflows/codex-validation-proof.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /prepare:\n {4}if: &authority .*github.actor == github.repository_owner.*github.triggering_actor == github.repository_owner.*github.run_attempt == 1.*TRUSTED_CODEX_REVIEW_ENABLED != 'true'/,
  );
  assert.match(workflow, /verify:\n {4}needs: prepare\n {4}if: \*authority/);
  assert.equal(workflow.match(/runs-on: ubuntu-latest/g)?.length, 2);
  assert.match(workflow, /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/);
  assert.match(workflow, /actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333/);
  assert.match(workflow, /node worker\/prove-review-validation.mjs prepare/);
  assert.match(workflow, /node worker\/prove-review-validation.mjs verify/);
  assert.match(
    workflow,
    /codex-validation-proof.json\n {10}retention-days: 14\n {10}if-no-files-found: error/,
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.|openai\/codex-action|checks: write|pull-requests: write|continue-on-error/,
  );
});
