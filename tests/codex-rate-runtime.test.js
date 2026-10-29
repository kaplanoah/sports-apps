import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  createNativeRateHook,
  startNativeRateRuntime,
  createProtectedRateSettings,
  createNativeQuotaRecord,
  validateNativeQuotaResult,
} from "../worker/codex-rate-runtime.mjs";
import { readNativeRatePolicyHash } from "../worker/codex-rate-policy.mjs";
import { createRateHttpFixture } from "./codex-rate-http.js";

const admission = { policy: readNativeRatePolicyHash(), notBefore: 0, port: 12345 };

test("protected settings and public quota state select fields instead of persisting credentials", () => {
  const input = {
    ...admission,
    version: 1,
    repository: "example/repo",
    run: 12,
    job: 4,
    source: "a".repeat(40),
    scanSince: 0,
    activeRuns: [12],
    token: "fake-private-value",
  };
  const settings = createProtectedRateSettings(input, ["1", "1"]);
  assert.equal(JSON.stringify(settings).includes("fake-private-value"), false);
  assert.throws(() => createProtectedRateSettings({ ...input, port: 80 }, ["1", "1"]));
  assert.throws(() => createProtectedRateSettings({ ...input, activeRuns: [12, 12] }, ["1", "1"]));
  const metrics = {
    requests: 1,
    reservedTokens: 100,
    observedTokens: null,
    unavailable: 1,
    queuedMs: 0,
    notBefore: 70000,
    feedbackFailed: false,
    headers: "fake-private-value",
  };
  const completion = {
    termination: "parent-exited",
    completedAt: 10000,
    restored: true,
    removed: true,
  };
  const record = createNativeQuotaRecord(settings, metrics, completion);
  validateNativeQuotaResult(record, input);
  for (const changed of [
    { termination: "deadline" },
    { finalized: false },
    { feedbackFailed: true },
    { namespacesRestored: false },
    { runtimeRemoved: false },
    { source: "b".repeat(40) },
    { repository: "example/other" },
    { run: 13 },
    { requests: -1 },
    { notBefore: 0 },
    { observedTokens: -1 },
    { unavailable: -1 },
  ])
    assert.throws(() => validateNativeQuotaResult({ ...record, ...changed }, input));
  assert.equal(record.observedTokens, null);
  assert.equal(JSON.stringify(record).includes("fake-private-value"), false);
  assert.throws(() =>
    createNativeQuotaRecord(settings, metrics, { ...completion, restored: false }),
  );
  assert.throws(() =>
    createNativeQuotaRecord(settings, metrics, { ...completion, removed: false }),
  );
});

test("runtime hook starts protection before native execution capture and has no credential argument", () => {
  const hook = createNativeRateHook("/tmp/codex-native-rate-example", "/usr/bin/node");
  assert.match(hook, /CODEX_PROMPT_FILE/);
  assert.match(hook, /public\/runtime\.mjs' launch .* "\$\$" \|\| exit 1/);
  assert.ok(hook.indexOf(" launch ") < hook.indexOf("exec >"));
  assert.doesNotMatch(hook, /API_KEY|AUTHORIZATION|GH_TOKEN|unsafe|eval|source /);
  assert.ok(createNativeRateHook("/tmp/example'quoted", "/usr/bin/node").includes("'\\''"));
});

test("the production controller, tokenizer and gateway forward once and reconcile actual usage", async () => {
  let fixture;
  let calls = 0;
  const runtime = await startNativeRateRuntime(admission, {
    now: () => 1000000,
    start: async (options) => {
      fixture = await createRateHttpFixture(options);
      return fixture.gateway;
    },
    send: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.redirect, "manual");
      assert.equal(options.headers.authorization, "Bearer fake-test");
      return new Response(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    },
  });
  try {
    const response = await fixture.request();
    assert.equal(response.status, 200);
    await response.text();
  } finally {
    await runtime.close();
  }
  const state = runtime.readFinalState(1000000);
  assert.equal(calls, 1);
  assert.equal(state.requests, 1);
  assert.equal(state.observedTokens, 15);
  assert.equal(state.unavailable, 0);
  assert.ok(state.reservedTokens > 32768);
  assert.equal(state.notBefore, 1060000);
});

test("an interrupted or partial response keeps usage unavailable without replay", async () => {
  let fixture;
  let calls = 0;
  const runtime = await startNativeRateRuntime(admission, {
    now: () => 1000000,
    start: async (options) => {
      fixture = await createRateHttpFixture(options);
      return fixture.gateway;
    },
    send: async () => {
      calls++;
      return new Response(
        'data: {"type":"response.failed","response":{"error":{"code":"example"}}}\n\n',
      );
    },
  });
  await (await fixture.request()).text();
  await runtime.close();
  const state = runtime.readFinalState(1000000);
  assert.equal(calls, 1);
  assert.equal(state.observedTokens, null);
  assert.equal(state.unavailable, 1);
  assert.ok(state.reservedTokens > 0);
});

test("unused admission reports unavailable usage and rejects policy drift before listening", async () => {
  let fixture;
  const runtime = await startNativeRateRuntime(admission, {
    now: () => 1000000,
    start: async (options) => {
      fixture = await createRateHttpFixture(options);
      return fixture.gateway;
    },
  });
  await runtime.close();
  assert.equal(runtime.readFinalState(1000000).observedTokens, null);
  await assert.rejects(
    startNativeRateRuntime({ ...admission, policy: "wrong" }),
    /policy mismatch/,
  );
});

test("every native entry point authenticates admission before the only model action and retains cleanup state", () => {
  for (const name of ["trusted-codex-review", "provider-review-session", "codex-runner-proof"]) {
    const workflow = readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    const model = workflow.indexOf("uses: openai/codex-action@");
    const prepare = workflow.indexOf('runtime.mjs" prepare');
    const cleanup = workflow.indexOf('collect "$RATE_FOLDER"');
    assert.ok(prepare > 0 && prepare < model && model < cleanup, name);
    assert.equal(workflow.match(/uses: openai\/codex-action@/g).length, 1);
    assert.match(workflow, /BASH_ENV: \$\{\{ steps.rate.outputs.hook \}\}/);
    assert.match(workflow, /responses-api-endpoint: \$\{\{ steps.rate.outputs.endpoint \}\}/);
    assert.match(workflow, /safety-strategy: drop-sudo/);
    assert.match(workflow, /permission-profile: ":read-only"/);
    const admission = workflow.slice(workflow.lastIndexOf("      - name:", prepare), model);
    assert.match(admission, /GH_TOKEN: \$\{\{ github.token \}\}/);
    assert.doesNotMatch(admission, /secrets\.|actions: write|contents: write/);
    const native = workflow.slice(model, cleanup);
    assert.doesNotMatch(native, /GH_TOKEN:|GITHUB_TOKEN:|secrets: inherit/);
    assert.match(native, /Retain fixed native admission failure facts/);
    assert.match(workflow.slice(cleanup), /name: \$\{\{ steps.rate.outputs.artifact \}\}/);
    assert.match(workflow.slice(cleanup), /retention-days: 90/);
    assert.doesNotMatch(workflow, /actions: (?:read|write)/);
  }
});

test("the hosted access diagnostic uses current read-only permissions in a separate non-model step", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = workflow.split("  codex-rate-control-isolation:\n")[1].split("\n  review-join:")[0];
  assert.match(job, /permissions:\n {6}contents: read/);
  assert.doesNotMatch(job, /actions:|secrets\.|openai\/codex-action/);
  assert.ok(job.indexOf("prove-codex-rate-isolation.mjs prove") < job.indexOf("GH_TOKEN:"));
  assert.match(job, /node worker\/codex-rate-access.mjs/);
});
