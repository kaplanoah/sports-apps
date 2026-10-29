import test from "node:test";
import assert from "node:assert/strict";
import { listNativeRateControls, readNativeRateEntries } from "../worker/codex-rate-source.mjs";
import { readFileSync } from "node:fs";
import {
  requiresRateIsolation,
  validateRateIsolationFacts,
  summarizeIsolationCommandFailure,
  parseIsolationCommandResult,
  createProbeEnvironment,
  validateSandboxLauncherResult,
  parsePrivilegedProofResult,
} from "../worker/prove-codex-rate-isolation.mjs";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("command diagnostics keep exit facts and fixed flags without publishing private output", () => {
  const facts = summarizeIsolationCommandFailure({
    status: 1,
    signal: null,
    stderr: Buffer.from(
      "bwrap: user namespace: Operation not permitted; fake-private-output; https://example.invalid/private",
    ),
    stdout: "fake-private-output",
  });
  assert.equal(facts.exitCode, 1);
  assert.equal(facts.mentionsPermissionDenial, true);
  assert.equal(facts.mentionsUserNamespace, true);
  assert.equal(facts.malformedProbeOutput, false);
  assert.equal(JSON.stringify(facts).includes("fake-private-output"), false);
  assert.equal(JSON.stringify(facts).includes("https://"), false);
  assert.equal(
    summarizeIsolationCommandFailure(new SyntaxError("private")).malformedProbeOutput,
    true,
  );
  assert.equal(summarizeIsolationCommandFailure({}).exitCode, null);
});

test("sandbox launcher must preserve the harmless child's exact output and intentional nonzero status", () => {
  assert.doesNotThrow(() =>
    validateSandboxLauncherResult({ status: 19, stdout: "rate-proof-launcher" }),
  );
  for (const result of [
    { status: 0, stdout: "" },
    { status: 0, stdout: "rate-proof-launcher" },
    { status: 19, stdout: "" },
    { status: 19, stdout: "fake-private-output" },
    { status: 19, stdout: "rate-proof-launcher", error: { code: "ETIMEDOUT" } },
  ]) {
    assert.throws(
      () => validateSandboxLauncherResult(result),
      (error) => {
        if (!(error instanceof Error) || !("stage" in error) || !("commandFacts" in error))
          return false;
        assert.equal(error.stage, "pinned-sandbox-launcher");
        assert.equal(JSON.stringify(error.commandFacts).includes("fake-private-output"), false);
        return true;
      },
    );
  }
});

test("the cleared probe environment keeps CLI home outside its temporary directory", () => {
  const fixtures = { home: "/proof/home", temporary: "/proof/temporary" };
  const env = createProbeEnvironment(fixtures);
  assert.equal(env.CODEX_HOME, fixtures.home);
  assert.equal(env.TMPDIR, fixtures.temporary);
  assert.equal(env.CODEX_HOME.startsWith(env.TMPDIR), false);
  assert.deepEqual(Object.keys(env).sort(), ["CODEX_HOME", "PATH", "TMPDIR"]);
});

test("probe output diagnosis preserves status and fixed shape facts without accepting malformed output", () => {
  assert.deepEqual(parseIsolationCommandResult({ status: 0, stdout: '{"boundary":true}' }), {
    boundary: true,
  });
  for (const stdout of [
    "",
    "fake-private-output",
    '{"boundary":true}{"boundary":true}',
    '\u001b[31m{"boundary":true}',
  ]) {
    let failure;
    try {
      parseIsolationCommandResult({ status: 0, stdout, stderr: "fake-private-stderr" });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof SyntaxError);
    const facts = summarizeIsolationCommandFailure(failure);
    assert.equal(facts.exitCode, 0);
    assert.equal(facts.stdoutBytes, Buffer.byteLength(stdout));
    assert.equal(facts.stderrBytes, Buffer.byteLength("fake-private-stderr"));
    assert.equal(facts.stdoutEmpty, stdout === "");
    assert.equal(facts.stdoutStartsWithObject, stdout.startsWith("{"));
    assert.equal(facts.stdoutEndsWithObject, stdout.endsWith("}"));
    assert.equal(facts.stdoutAdjacentObjects, stdout.includes("}{"));
    assert.equal(facts.stdoutContainsAnsi, stdout.includes("\u001b["));
    assert.equal(JSON.stringify(facts).includes("fake-private"), false);
  }
});

test("nonzero or timed-out commands cannot pass even with valid-looking JSON", () => {
  for (const result of [
    { status: 1, stdout: '{"boundary":true}' },
    { status: null, stdout: '{"boundary":true}', error: { code: "ETIMEDOUT" } },
  ]) {
    assert.throws(() => parseIsolationCommandResult(result));
  }
});
test("privileged proof parsing retains real command metadata on malformed or failed output", () => {
  for (const result of [
    { status: 0, stdout: "malformed-private-output" },
    { status: 1, stdout: "{}" },
  ]) {
    let failure;
    try {
      parsePrivilegedProofResult(result);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error);
    const facts = summarizeIsolationCommandFailure(failure);
    assert.equal(facts.exitCode, result.status);
    assert.equal(facts.stdoutBytes, Buffer.byteLength(result.stdout));
    assert.equal(JSON.stringify(facts).includes("private-output"), false);
  }
  assert.throws(() =>
    parsePrivilegedProofResult({ status: 0, stdout: JSON.stringify({ facts: {} }) }),
  );
});

test("a privileged proof failure retains its original stage, failed facts and command facts", () => {
  const result = {
    passed: false,
    stage: "pinned-read-only-sandbox",
    failedFacts: ["checkoutWriteDenied"],
    commandFacts: { exitCode: 0 },
  };
  assert.throws(
    () => parsePrivilegedProofResult({ status: 0, stdout: JSON.stringify(result) }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.constructor.name, "IsolationProofError");
      assert.ok("stage" in error && "failedFacts" in error && "commandFacts" in error);
      assert.equal(error.stage, result.stage);
      assert.deepEqual(error.failedFacts, result.failedFacts);
      assert.deepEqual(error.commandFacts, result.commandFacts);
      return true;
    },
  );
});

const readJob = (name) =>
  workflow.match(new RegExp(`^  ${name}:\\n(?:(?:    .*|)\\n)*`, "m"))?.[0] ?? "";

test("native code, dependencies and runner controls request isolation while app-only changes do not", () => {
  for (const path of [
    ...listNativeRateControls(),
    ...readNativeRateEntries().flatMap(({ workflow, entry }) => [
      `.github/workflows/${workflow}`,
      `.github/workflows/${entry}`,
    ]),
    "worker/prepare-codex-rate.mjs",
    "worker/codex-rate-budget.mjs",
    "worker/codex-rate-gateway.mjs",
    "worker/codex-rate-isolation-probe.mjs",
    "worker/prove-codex-rate-isolation.mjs",
    "worker/prove-codex-runner.mjs",
    "tests/codex-rate-controller.test.js",
    ".github/workflows/ci.yml",
    ".github/workflows/codex-runner-proof.yml",
    "package.json",
    "package-lock.json",
    ".nvmrc",
  ])
    assert.equal(requiresRateIsolation([path]), true, path);
  assert.equal(requiresRateIsolation(["apps/mlb/page/js/app.js", "README.md"]), false);
});

test("isolation is a read-only secret-free job with pinned setup and explicit cleanup", () => {
  const job = readJob("codex-rate-control-isolation");
  assert.match(job, /permissions:\n {6}contents: read\n/);
  assert.doesNotMatch(
    job,
    /secrets\.|environment:|write|id-token|openai-api-key|codex exec|codex-action@/,
  );
  assert.match(job, /persist-credentials: false/);
  for (const command of ["scope", "install", "prove", "cleanup"])
    assert.match(job, new RegExp(`run: node worker/prove-codex-rate-isolation\\.mjs ${command}`));
  assert.match(job, /name: Remove only proof installation files\n {8}if: always\(\)/);
  assert.match(job, /path: \$\{\{ runner.temp \}\}\/codex-rate-isolation-proof.json/);
  assert.match(job, /if-no-files-found: error/);
});

test("a failed hosted proof blocks both tested evidence and the final check", () => {
  for (const name of ["tested", "check"])
    assert.match(readJob(name), /needs:\s*\[[^\]]*codex-rate-control-isolation/);
  assert.match(readJob("tested"), /needs.codex-rate-control-isolation.result == 'success'/);
  assert.match(readJob("check"), /contains\(needs\.\*\.result, 'failure'\)/);
});

test("the hosted harness invokes only pinned CLI sandbox and never a native evaluation", () => {
  const harness = readFileSync(
    new URL("../worker/prove-codex-rate-isolation.mjs", import.meta.url),
    "utf8",
  ).replace(/\s+/g, " ");
  assert.match(harness, /readCodexProofConfiguration/);
  assert.match(harness, /"sandbox", "--permission-profile", ":read-only"/);
  assert.match(
    harness,
    /"--no-new-privs", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all"/,
  );
  assert.match(harness, /"-n", "\/usr\/bin\/env", "-i"/);
  assert.doesNotMatch(harness, /\["exec"|systemctl|useradd|sudoers|setcap|iptables/);
  assert.match(harness, /env.RUNNER_ENVIRONMENT !== "github-hosted"/);
  assert.match(harness, /"--clear-groups"/);
  assert.doesNotMatch(harness, /--groups=/);
  assert.match(harness, /verifyWithRateNamespaces\(/);
  assert.match(harness, /validateSandboxLauncherResult\( launchBoundaryCommand\(/);
  assert.match(harness, /nativeModelStarted: false, realCredentialUsed: false/);
});

test("missing, false or invented isolation facts cannot pass the proof", () => {
  const facts = {
    gatewayReachable: true,
    upstreamReachable: true,
    checkoutWritable: true,
    unprivileged: true,
    noNewPrivileges: true,
    noCapabilities: true,
    supplementaryGroupsCleared: true,
    rootServiceSocketsDenied: true,
    rootEnvironmentDenied: true,
    rootDescriptorsDenied: true,
    rootFileDenied: true,
    controlsWriteDenied: true,
    rootSignalDenied: true,
    ptraceDenied: true,
    sudoDenied: true,
    gatewayNetworkDenied: true,
    upstreamNetworkDenied: true,
    checkoutWriteDenied: true,
    authorizedFakeRoute: true,
    sandboxLauncherExecuted: true,
    rootRuntimeRemoved: true,
    listenersClosed: true,
    noCapturedCanary: true,
    namespacesRestored: true,
  };
  assert.doesNotThrow(() => validateRateIsolationFacts(facts));
  for (const name of Object.keys(facts)) {
    const missing = { ...facts };
    delete missing[name];
    assert.throws(() => validateRateIsolationFacts(missing));
    assert.throws(() => validateRateIsolationFacts({ ...facts, [name]: false }));
  }
  assert.throws(() => validateRateIsolationFacts({ ...facts, extra: true }));
  assert.throws(() => validateRateIsolationFacts({ passed: true }));
});
