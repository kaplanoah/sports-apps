import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requiresRateIsolation,
  validateRateIsolationFacts,
  summarizeIsolationCommandFailure,
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
const readJob = (name) =>
  workflow.match(new RegExp(`^  ${name}:\\n(?:(?:    .*|)\\n)*`, "m"))?.[0] ?? "";

test("native code, dependencies and runner controls request isolation while app-only changes do not", () => {
  for (const path of [
    "worker/codex-rate-budget.mjs",
    "worker/codex-rate-gateway.mjs",
    "worker/codex-rate-isolation-probe.mjs",
    "worker/prove-codex-rate-isolation.mjs",
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
  assert.doesNotMatch(harness, /\["exec"|systemctl|useradd|sudoers|setcap|sysctl|iptables/);
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
    rootRuntimeRemoved: true,
    listenersClosed: true,
    noCapturedCanary: true,
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
