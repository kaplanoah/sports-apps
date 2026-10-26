import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { requireCodexProofAuthority, verifyCodexProof } from "../worker/prove-codex-runner.mjs";
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
  assert.match(before, /openai\/codex-action@c05cfd74ad95c626cdf05c6685e62becc3bf7813/);
  assert.match(before, /codex-version: 0.164.0/);
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
      env: { ...process.env, ...OWNER, RUNNER_TEMP: folder },
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
  const probe = readFileSync(join(folder, "codex-proof/probe.mjs"), "utf8").replace(
    /^import .*;\n/gm,
    "",
  );
  const blocked = () => {
    throw new Error("Blocked by the sandbox.");
  };
  const sandbox = {
    assert,
    process: { getuid: () => 1001, env: {} },
    spawnSync: () => ({ status: 1 }),
    writeFileSync: blocked,
    console: { log: () => {}, error: () => {} },
  };
  assert.doesNotThrow(() => runInNewContext(probe, sandbox));
  for (const change of [
    { process: { getuid: () => 0, env: {} } },
    { process: { getuid: () => 1001, env: { TRIAL_SECRET_CANARY: "present" } } },
    { spawnSync: () => ({ status: 0 }) },
    { writeFileSync: () => {} },
  ])
    assert.throws(() => runInNewContext(probe, { ...sandbox, ...change }));
});
