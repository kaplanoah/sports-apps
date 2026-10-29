import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCodexProofScenario,
  readCodexProofTimeout,
  verifyEmptyCodexIntegration,
} from "../worker/codex-acceptance.mjs";
import { inspectCodexInterruption } from "../worker/prove-codex-runner.mjs";
import { createEvidenceCertificate } from "./evaluation-certificate.js";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const OWNER = {
  GITHUB_REPOSITORY: "kaplanoah/sports-apps",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_ACTOR: "kaplanoah",
  GITHUB_TRIGGERING_ACTOR: "kaplanoah",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "7",
};
const PROBE = "/tmp/example-proof/probe.mjs";
const PROBE_EVENT = {
  type: "item.completed",
  item: {
    id: "probe",
    type: "command_execution",
    command: `node ${PROBE}`,
    exit_code: 0,
    aggregated_output: "TRUSTED_CODEX_TOOL_PROOF_OK\nTRUSTED_CODEX_CAPTURE_PROOF\n",
  },
};
const WAIT_EVENT = {
  type: "item.started",
  item: { id: "waiting", type: "command_execution", command: "sleep 3600" },
};
const USAGE_EVENT = {
  type: "turn.completed",
  usage: { input_tokens: 12, cached_input_tokens: 2, output_tokens: 3 },
};
/** @param {any[]} events */
const renderEvents = (events) => events.map((event) => JSON.stringify(event)).join("\n");

test("proof scenarios are explicit and never imply another model execution", () => {
  assert.equal(readCodexProofScenario(undefined), "runner");
  for (const scenario of ["runner", "interruption", "integration"])
    assert.equal(readCodexProofScenario(scenario), scenario);
  for (const scenario of ["other", "integration\nrunner", "retry", "constructor", "__proto__"])
    assert.throws(() => readCodexProofScenario(scenario));
  const workflow = readRepoFile(".github/workflows/codex-runner-proof.yml");
  assert.match(workflow, /options: \[runner, interruption, integration\]/);
  assert.match(
    workflow,
    /timeout-minutes: \$\{\{ fromJSON\(needs.prepare.outputs.model-timeout\) \}\}/,
  );
  const modelMinutes = Number(workflow.split("\n  model:\n")[1].match(/timeout-minutes: (\d+)/)[1]);
  for (const scenario of ["runner", "interruption", "integration"])
    assert.ok(readCodexProofTimeout(scenario) <= modelMinutes - 10);
  assert.equal(readCodexProofTimeout("interruption"), 5);
  assert.equal(readCodexProofTimeout("integration"), 20);
  assert.equal(workflow.match(/uses: openai\/codex-action@/g).length, 1);
  assert.doesNotMatch(
    workflow,
    /actions: write|checks: write|pull-requests: write|workflow_run:|schedule:/,
  );
});

test("an unfinished native wait is only an interruption candidate until the actual timeout is independently verified", () => {
  const candidate = inspectCodexInterruption(
    renderEvents([PROBE_EVENT, WAIT_EVENT]),
    PROBE,
    "failure",
  );
  assert.equal(candidate.interruptionCandidate, true);
  assert.equal(candidate.workflowTimeoutVerificationRequired, true);
  assert.equal(candidate.nativeOutcome, "failure");
  assert.equal("tokens" in candidate, false);
  assert.equal("passed" in candidate, false);
  assert.equal(
    inspectCodexInterruption(renderEvents([PROBE_EVENT, WAIT_EVENT]), PROBE, "cancelled")
      .nativeOutcome,
    "cancelled",
  );
  for (const events of [
    [],
    [WAIT_EVENT],
    [PROBE_EVENT],
    [PROBE_EVENT, PROBE_EVENT, WAIT_EVENT],
    [PROBE_EVENT, WAIT_EVENT, USAGE_EVENT],
    [PROBE_EVENT, WAIT_EVENT, { type: "error" }],
    [PROBE_EVENT, WAIT_EVENT, { type: "turn.failed" }],
    [WAIT_EVENT, PROBE_EVENT],
    [PROBE_EVENT, { ...WAIT_EVENT, item: { ...WAIT_EVENT.item, id: "probe" } }],
    [PROBE_EVENT, { ...WAIT_EVENT, item: { ...WAIT_EVENT.item, id: undefined } }],
    [PROBE_EVENT, { ...WAIT_EVENT, item: { ...WAIT_EVENT.item, command: "echo fake" } }],
    [
      PROBE_EVENT,
      WAIT_EVENT,
      { type: "item.completed", item: { ...WAIT_EVENT.item, exit_code: 0 } },
    ],
  ])
    assert.throws(() => inspectCodexInterruption(renderEvents(events), PROBE, "failure"));
  for (const outcome of ["success", undefined])
    assert.throws(() =>
      inspectCodexInterruption(renderEvents([PROBE_EVENT, WAIT_EVENT]), PROBE, outcome),
    );
  assert.throws(() =>
    inspectCodexInterruption(
      renderEvents([PROBE_EVENT, WAIT_EVENT]) + '\n{"type":',
      PROBE,
      "failure",
    ),
  );
});

test("empty integration uses actual two-commit code, synthetic empty seeds and the production completion guards", (context) => {
  const temporary = mkdtempSync(join(tmpdir(), "codex-empty-integration-"));
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const command = fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT));
  const env = {
    ...process.env,
    ...OWNER,
    RUNNER_TEMP: temporary,
    GITHUB_OUTPUT: join(temporary, "outputs"),
    CODEX_PROOF_SCENARIO: "integration",
    CODEX_EVIDENCE_CERTIFICATE: createEvidenceCertificate(temporary),
  };
  const prepared = spawnSync(process.execPath, [command, "prepare"], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  const root = join(temporary, "codex-proof");
  const identity = JSON.parse(readFileSync(join(root, "identity.json"), "utf8"));
  assert.equal(identity.source, env.GITHUB_SHA);
  assert.equal(identity.run, env.GITHUB_RUN_ID);
  assert.notEqual(identity.base, identity.head);
  const history = execFileSync("git", ["-C", join(root, "checkout"), "rev-list", "--all"], {
    encoding: "utf8",
  });
  assert.equal(history.trim().split("\n").length, 2);
  assert.match(
    readFileSync(join(root, "data/first/1.diff"), "utf8"),
    /-export const describeScore = \(score\).*\n\+export const describeScore = \(runs\)/,
  );
  const prompt = readFileSync(join(root, "prompt.txt"), "utf8");
  assert.match(prompt, /mandatory independent integration pass, even when candidates are empty/);
  assert.match(prompt, /Both portion results are synthetic empty seeds/);
  assert.match(
    readFileSync(join(temporary, "codex-home/config.toml"), "utf8"),
    /web_search = "disabled"/,
  );
  assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /model-timeout=20/);
  const binding = JSON.parse(readFileSync(join(root, "schema.json"), "utf8")).properties.binding
    .enum[0];
  const answer = { binding, complete: true, unfinished: [], unjudged: [], findings: [] };
  const transcript = renderEvents([
    {
      ...PROBE_EVENT,
      item: {
        ...PROBE_EVENT.item,
        command: "git diff HEAD^ HEAD",
        aggregated_output: "fixture diff",
      },
    },
    USAGE_EVENT,
  ]);
  const proof = verifyEmptyCodexIntegration(root, env, transcript, JSON.stringify(answer));
  assert.equal(proof.nativeIntegration, true);
  assert.equal(proof.syntheticPortionSeeds, 2);
  assert.equal(proof.candidates, 0);
  assert.deepEqual(proof.tokens, {
    input: 10,
    cached: 2,
    output: 3,
    cacheWrite: null,
    reasoningOutput: null,
  });
  for (const change of [
    { binding: "b".repeat(64) },
    { complete: false },
    { unfinished: ["required work"] },
    { unjudged: [{ file: "REVIEW.md", why: "not assessed" }] },
  ])
    assert.throws(() =>
      verifyEmptyCodexIntegration(root, env, transcript, JSON.stringify({ ...answer, ...change })),
    );
  for (const change of [
    { GITHUB_SHA: "b".repeat(40) },
    { GITHUB_RUN_ID: "8" },
    { GITHUB_REPOSITORY: "example/fork" },
  ])
    assert.throws(() =>
      verifyEmptyCodexIntegration(root, { ...env, ...change }, transcript, JSON.stringify(answer)),
    );
  for (const events of [
    [USAGE_EVENT],
    [PROBE_EVENT],
    [PROBE_EVENT, USAGE_EVENT, { type: "error" }],
  ])
    assert.throws(() =>
      verifyEmptyCodexIntegration(root, env, renderEvents(events), JSON.stringify(answer)),
    );
  for (const path of ["prompt.txt", "schema.json", "data/candidates.json", "data/first/1.diff"]) {
    const changed = join(temporary, "changed");
    cpSync(root, changed, { recursive: true });
    writeFileSync(join(changed, path), "changed");
    assert.throws(() =>
      verifyEmptyCodexIntegration(changed, env, transcript, JSON.stringify(answer)),
    );
    rmSync(changed, { recursive: true });
  }
  for (const areaCount of [1, 3]) {
    const changed = join(temporary, "changed");
    cpSync(root, changed, { recursive: true });
    const plan = JSON.parse(readFileSync(join(changed, "data/plan.json"), "utf8"));
    plan.areas = Array.from({ length: areaCount }, (_, index) => plan.areas[index % 2]);
    writeFileSync(join(changed, "data/plan.json"), JSON.stringify(plan));
    assert.throws(() =>
      verifyEmptyCodexIntegration(changed, env, transcript, JSON.stringify(answer)),
    );
    rmSync(changed, { recursive: true });
  }
});

test("interruption preparation gives a bounded native step and never starts a recovery model", (context) => {
  const temporary = mkdtempSync(join(tmpdir(), "codex-interruption-"));
  context.after(() => rmSync(temporary, { recursive: true, force: true }));
  const env = {
    ...process.env,
    ...OWNER,
    RUNNER_TEMP: temporary,
    GITHUB_OUTPUT: join(temporary, "outputs"),
    CODEX_PROOF_SCENARIO: "interruption",
    CODEX_EVIDENCE_CERTIFICATE: createEvidenceCertificate(temporary),
  };
  const command = fileURLToPath(new URL("worker/prove-codex-runner.mjs", REPO_ROOT));
  const prepared = spawnSync(process.execPath, [command, "prepare"], { env, encoding: "utf8" });
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.match(readFileSync(env.GITHUB_OUTPUT, "utf8"), /model-timeout=5/);
  assert.match(readFileSync(join(temporary, "codex-proof/prompt.txt"), "utf8"), /sleep 3600/);
  const events = [structuredClone(PROBE_EVENT), WAIT_EVENT];
  events[0].item.command = `node ${join(temporary, "codex-proof/probe.mjs")}`;
  writeFileSync(join(temporary, "codex-events.jsonl"), renderEvents(events));
  const collected = spawnSync(process.execPath, [command, "collect"], {
    env: { ...env, MODEL_OUTCOME: "failure" },
    encoding: "utf8",
  });
  assert.notEqual(collected.status, 0);
  assert.match(collected.stderr, /Verify the actual GitHub step timeout/);
  const proof = JSON.parse(readFileSync(join(temporary, "codex-proof-result/proof.json"), "utf8"));
  assert.equal(proof.workflowTimeoutVerificationRequired, true);
  assert.equal(proof.telemetryUnavailable, true);
  assert.equal("tokens" in proof, false);
  assert.equal(proof.source, env.GITHUB_SHA);
});
