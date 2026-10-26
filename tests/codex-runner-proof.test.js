import test from "node:test";
import { createEvidenceCertificate } from "./evaluation-certificate.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requireCodexProofAuthority,
  verifyCodexProof,
  readCodexProofConfiguration,
} from "../worker/prove-codex-runner.mjs";
import { assertCodexSandbox } from "../worker/codex-runner-probe.mjs";
import { readRepoFile, REPO_ROOT } from "./repo-files.js";

const OWNER = {
  GITHUB_REPOSITORY: "kaplanoah/sports-apps",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_ACTOR: "kaplanoah",
  GITHUB_TRIGGERING_ACTOR: "kaplanoah",
  GITHUB_RUN_ATTEMPT: "1",
};
const PROBE = "/tmp/codex-proof/probe.mjs";
const EVENTS = [
  {
    type: "item.completed",
    item: {
      type: "command_execution",
      command: `/bin/bash -lc 'node ${PROBE}'`,
      exit_code: 0,
      aggregated_output: "TRUSTED_CODEX_TOOL_PROOF_OK\nTRUSTED_CODEX_CAPTURE_PROOF\n",
    },
  },
  { type: "turn.completed", usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 3 } },
];
const ANSWER = '{"complete":true}';
/** @param {unknown[]} [events] */
const renderEvents = (events = EVENTS) => events.map((event) => JSON.stringify(event)).join("\n");

test("only a first owner dispatch on main can use the hosted proof", () => {
  assert.doesNotThrow(() => requireCodexProofAuthority(OWNER));
  for (const [name, value] of [
    ["GITHUB_REPOSITORY", "example/fork"],
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_ACTOR", "outsider"],
    ["GITHUB_TRIGGERING_ACTOR", "outsider"],
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["TRUSTED_CODEX_REVIEW_ENABLED", "true"],
  ])
    assert.throws(() => requireCodexProofAuthority({ ...OWNER, [name]: value }));
});

test("a model's completion claim cannot substitute for successful native tool results", () => {
  const proof = verifyCodexProof(renderEvents(), ANSWER, PROBE);
  assert.equal(proof.nativeToolProof, true);
  assert.deepEqual(proof.tokens, { input: 10, output: 3, cached: 2, cacheWrite: 0 });
  assert.doesNotMatch(JSON.stringify(proof), /aggregated_output|TRUSTED_CODEX_TOOL|CAPTURE_PROOF/);
  for (const events of [
    [EVENTS[1]],
    [EVENTS[0], EVENTS[0], EVENTS[1]],
    [{ ...EVENTS[0], type: "assistant" }, EVENTS[1]],
    [{ ...EVENTS[0], item: { ...EVENTS[0].item, exit_code: 1 } }, EVENTS[1]],
    [{ ...EVENTS[0], item: { ...EVENTS[0].item, command: "echo forged" } }, EVENTS[1]],
    [
      {
        ...EVENTS[0],
        item: { ...EVENTS[0].item, aggregated_output: "TRUSTED_CODEX_TOOL_PROOF_OK" },
      },
      EVENTS[1],
    ],
    [EVENTS[0]],
  ])
    assert.throws(() => verifyCodexProof(renderEvents(events), ANSWER, PROBE));
  for (const output of [
    '{"complete":false}',
    '{"complete":true,"extra":1}',
    "null",
    "[]",
    "invalid",
  ])
    assert.throws(() => verifyCodexProof(renderEvents(), output, PROBE));
  assert.throws(
    () => verifyCodexProof('{"private":broken}', ANSWER, PROBE),
    /Malformed Codex proof evidence/,
  );
});

test("the model host receives only the disposable fixture before execution and no public raw transcript", () => {
  const workflow = readRepoFile(".github/workflows/codex-runner-proof.yml");
  const model = workflow.split("\n  model:\n")[1];
  const [before, after] = model.split("      # The model cannot see");
  assert.doesNotMatch(
    before,
    /actions\/checkout|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY|TRUSTED_REVIEW_APP_PRIVATE_KEY/,
  );
  assert.match(before, /permission-profile: ":read-only"/);
  assert.match(before, /safety-strategy: drop-sudo/);
  assert.match(before, /BASH_ENV: \$\{\{ runner.temp \}\}\/codex-log-capture.sh/);
  assert.match(after, /codex-proof-result\/proof.json/);
  assert.doesNotMatch(after, /codex-events|answer.json|usage.jsonl/);
  assert.doesNotMatch(workflow, /pull-requests: write|checks: write|secrets: inherit/);
});

test("preparation archives only the synthetic project and production configuration, with no answer rubric", () => {
  const folder = mkdtempSync(join(tmpdir(), "codex-proof-"));
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT)), "prepare"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...OWNER,
        RUNNER_TEMP: folder,
        CODEX_EVIDENCE_CERTIFICATE: createEvidenceCertificate(folder),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const listed = spawnSync("tar", ["-tzf", join(folder, "codex-proof-input.tgz")], {
    encoding: "utf8",
  });
  assert.equal(listed.status, 0);
  assert.doesNotMatch(
    listed.stdout,
    /review-evaluation|rubric|TRUSTED_REVIEW|package-lock|shared\/|apps\//,
  );
  assert.match(
    readFileSync(join(folder, "codex-home/config.toml"), "utf8"),
    /project_doc_max_bytes = 0/,
  );
  assert.match(readFileSync(join(folder, "codex-home/config.toml"), "utf8"), /inherit = "none"/);
  assert.match(
    readFileSync(join(folder, "codex-proof/checkout/AGENTS.md"), "utf8"),
    /UNTRUSTED_PROJECT_INSTRUCTIONS_EXECUTED/,
  );
  const gitObjects = spawnSync(
    "git",
    ["-C", join(folder, "codex-proof/checkout"), "rev-list", "--all"],
    { encoding: "utf8" },
  );
  assert.equal(gitObjects.status, 0);
  assert.equal(gitObjects.stdout, "");
  assert.equal(
    readFileSync(join(folder, "codex-proof/probe.mjs"), "utf8"),
    readRepoFile("worker/codex-runner-probe.mjs"),
  );
});

test("the trusted probe rejects root, credentials, sudo and writable checkout independently", () => {
  const blocked = () => {
    throw new Error("Blocked by the sandbox.");
  };
  const checks = { uid: 1001, environment: {}, sudoStatus: () => 1, writeCheckout: blocked };
  assert.doesNotThrow(() => assertCodexSandbox(checks));
  let credentialRead = false;
  const environment = Object.defineProperty({}, "OPENAI_API_KEY", {
    get() {
      credentialRead = true;
      return "private-fixture-value";
    },
  });
  assert.throws(() => assertCodexSandbox({ ...checks, environment }));
  assert.equal(credentialRead, false);
  for (const change of [
    { uid: 0 },
    { environment: { TRIAL_SECRET_CANARY: "present" } },
    { sudoStatus: () => 0 },
    { writeCheckout: () => {} },
  ])
    assert.throws(() => assertCodexSandbox({ ...checks, ...change }));
  for (const name of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
  ])
    assert.throws(() => assertCodexSandbox({ ...checks, environment: { [name]: "present" } }));
});

test("paid execution independently checks authority when preparation is reused", () => {
  const workflow = readRepoFile(".github/workflows/codex-runner-proof.yml");
  assert.match(
    workflow,
    /prepare:\n {4}if: &proof-authority .*github.actor == github.repository_owner.*github.triggering_actor == github.repository_owner.*github.run_attempt == 1.*TRUSTED_CODEX_REVIEW_ENABLED != 'true'/,
  );
  assert.match(workflow, /model:\n {4}needs: prepare\n {4}if: \*proof-authority/);
  assert.match(workflow, /node-version: \$\{\{ needs.prepare.outputs.node-version \}\}/);
  assert.match(workflow, /node-version: \$\{\{ steps.node.outputs.node-version \}\}/);
});

test("recorded configured pins come from the workflow and agree with production", () => {
  const configured = readCodexProofConfiguration(
    readRepoFile(".github/workflows/codex-runner-proof.yml"),
  );
  assert.deepEqual(
    configured,
    readCodexProofConfiguration(readRepoFile(".github/workflows/trusted-codex-review.yml")),
  );
  assert.throws(() => readCodexProofConfiguration("model: example"), /configuration missing/);
  assert.deepEqual(
    readCodexProofConfiguration(
      `uses: openai/codex-action@${"a".repeat(40)}\ncodex-version: 1.2.3\nmodel: example-model`,
    ),
    { action: "a".repeat(40), cli: "1.2.3", configuredModel: "example-model" },
  );
});

test("fixed proof errors are reported while unexpected diagnostic contents stay private", () => {
  const command = fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT));
  const denied = spawnSync(process.execPath, [command, "prepare"], {
    encoding: "utf8",
    env: { ...process.env, ...OWNER, GITHUB_RUN_ATTEMPT: "2" },
  });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /one owner dispatch on main/);
  const missing = spawnSync(process.execPath, [command, "collect"], {
    encoding: "utf8",
    env: { ...process.env, ...OWNER, RUNNER_TEMP: "/tmp/private-unavailable-proof" },
  });
  assert.notEqual(missing.status, 0);
  assert.doesNotMatch(missing.stderr, /private-unavailable-proof|ENOENT|node:fs/);
});

test("the collector records configured pins and observed CLI, rejecting an installed-version mismatch", () => {
  const configured = readCodexProofConfiguration(
    readRepoFile(".github/workflows/codex-runner-proof.yml"),
  );
  for (const installed of [configured.cli, "0.0.0"]) {
    const folder = mkdtempSync(join(tmpdir(), "codex-proof-collect-"));
    const certificate = createEvidenceCertificate(folder);
    const prepared = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT)), "prepare"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...OWNER,
          RUNNER_TEMP: folder,
          CODEX_EVIDENCE_CERTIFICATE: certificate,
        },
      },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    mkdirSync(join(folder, "codex-answer"));
    mkdirSync(join(folder, "bin"));
    const events = structuredClone(EVENTS);
    events[0].item.command = `/bin/bash -lc 'node ${join(folder, "codex-proof/probe.mjs")}'`;
    writeFileSync(join(folder, "codex-events.jsonl"), renderEvents(events));
    writeFileSync(join(folder, "codex-answer/answer.json"), ANSWER);
    writeFileSync(
      join(folder, "bin/codex"),
      '#!/usr/bin/env node\nconsole.log("codex-cli " + process.env.PROOF_TEST_CLI);\n',
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT)), "collect"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...OWNER,
          RUNNER_TEMP: folder,
          PATH: `${join(folder, "bin")}:${process.env.PATH}`,
          GITHUB_SHA: "a".repeat(40),
          GITHUB_RUN_ID: "7",
          PROOF_TEST_CLI: installed,
          MODEL_OUTCOME: "success",
        },
      },
    );
    if (installed !== configured.cli) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unexpected installed Codex CLI/);
      continue;
    }
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(readFileSync(join(folder, "codex-proof-result/proof.json"), "utf8"));
    assert.equal(proof.action, configured.action);
    assert.equal(proof.cli, configured.cli);
    assert.equal(proof.configuredModel, configured.configuredModel);
    assert.equal(proof.observedCli, `codex-cli ${installed}`);
    assert.equal(proof.source, "a".repeat(40));
    assert.equal(proof.run, "7");
    assert.equal(proof.nativeToolProof, true);
  }
});

test("failed and interrupted native proofs retain encrypted diagnostics and never claim success", () => {
  for (const [outcome, hasUsage] of /** @type {const} */ ([
    ["failure", false],
    ["failure", true],
    ["cancelled", false],
    ["cancelled", true],
  ])) {
    const root = mkdtempSync(join(tmpdir(), "codex-proof-failure-"));
    const command = fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT));
    const env = {
      ...process.env,
      ...OWNER,
      RUNNER_TEMP: root,
      GITHUB_SHA: "a".repeat(40),
      GITHUB_RUN_ID: "7",
      CODEX_EVIDENCE_CERTIFICATE: createEvidenceCertificate(root),
      MODEL_OUTCOME: outcome,
    };
    const prepared = spawnSync(process.execPath, [command, "prepare"], { env, encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    const diagnostic =
      '{"type":"error","message":"private execution diagnostic"}' +
      (hasUsage
        ? '\n{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":2,"output_tokens":3}}'
        : "");
    writeFileSync(join(root, "codex-events.jsonl"), diagnostic);
    const failed = spawnSync(process.execPath, [command, "collect"], { env, encoding: "utf8" });
    assert.notEqual(failed.status, 0);
    assert.doesNotMatch(failed.stdout + failed.stderr, /private execution diagnostic/);
    const proof = JSON.parse(readFileSync(join(root, "codex-proof-result/proof.json"), "utf8"));
    assert.equal(proof.nativeToolProof, false);
    assert.equal(proof.failureStage, "provider-action");
    assert.equal(proof.source, env.GITHUB_SHA);
    assert.equal(proof.run, "7");
    if (hasUsage) assert.deepEqual(proof.tokens, { input: 8, output: 3, cached: 2, cacheWrite: 0 });
    else {
      assert.equal("tokens" in proof, false);
      assert.equal(proof.telemetryUnavailable, true);
    }
    const decoded = join(root, "decoded.tgz");
    assert.equal(
      spawnSync(
        "openssl",
        [
          "cms",
          "-decrypt",
          "-binary",
          "-inform",
          "DER",
          "-in",
          join(root, "trial-private/evidence.cms"),
          "-out",
          decoded,
          "-recip",
          join(root, "certificate.pem"),
          "-inkey",
          join(root, "key.pem"),
        ],
        { stdio: "pipe" },
      ).status,
      0,
    );
    assert.equal(
      spawnSync("tar", ["-xOf", decoded, "./transcript.json"], { encoding: "utf8" }).stdout,
      diagnostic,
    );
  }
});

test("missing or private evidence certificates fail preparation before a model input is uploaded", () => {
  for (const certificate of [
    undefined,
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN PUBLIC KEY-----",
  ]) {
    const root = mkdtempSync(join(tmpdir(), "codex-proof-certificate-"));
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT)), "prepare"],
      {
        env: {
          ...process.env,
          ...OWNER,
          RUNNER_TEMP: root,
          CODEX_EVIDENCE_CERTIFICATE: certificate,
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(root, "codex-proof-input.tgz")), false);
    assert.doesNotMatch(result.stderr, /BEGIN PRIVATE KEY|BEGIN PUBLIC KEY/);
  }
});
