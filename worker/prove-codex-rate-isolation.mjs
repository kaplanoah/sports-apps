import { fork, execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { verifyWithRateNamespaces, RateNamespaceError } from "./codex-rate-namespaces.mjs";
import { writeRateProbeResult } from "./codex-rate-probe-output.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const proofModules = [
  "budget",
  "estimate",
  "controller",
  "gateway",
  "isolation-holder",
  "isolation-probe",
  "probe-output",
];
const privateEnvironment = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "TRUSTED_REVIEW_OPENAI_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "TRUSTED_REVIEW_APP_PRIVATE_KEY",
];
const proofStages = new Set([
  "holder-startup",
  "unsandboxed-baseline",
  "root-process-boundary",
  "pinned-read-only-sandbox",
  "pinned-sandbox-launcher",
  "authorized-fake-route",
  "privileged-process",
  "namespace-preparation",
  "namespace-restoration",
]);

class IsolationProofError extends Error {
  constructor(stage, failedFacts = [], commandFacts = null) {
    super("Isolation proof could not establish its facts.");
    this.stage = proofStages.has(stage) ? stage : "privileged-process";
    this.failedFacts = failedFacts.filter((name) => completedFacts.includes(name));
    this.commandFacts = commandFacts;
  }
}

/** @param {any} error */
export function summarizeIsolationCommandFailure(error) {
  const stdout = Buffer.isBuffer(error?.stdout)
    ? error.stdout.toString("utf8")
    : typeof error?.stdout === "string"
      ? error.stdout
      : "";
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString("utf8")
    : typeof error?.stderr === "string"
      ? error.stderr
      : "";
  return {
    exitCode: Number.isSafeInteger(error?.status) ? error.status : null,
    terminated: typeof error?.signal === "string",
    timedOut: error?.code === "ETIMEDOUT",
    malformedProbeOutput: error instanceof SyntaxError,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutEmpty: stdout.length === 0,
    stdoutStartsWithObject: /^\s*\{/.test(stdout),
    stdoutEndsWithObject: /\}\s*$/.test(stdout),
    stdoutAdjacentObjects: /\}\s*\{/.test(stdout),
    stdoutContainsAnsi: stdout.includes("\u001b["),
    mentionsPermissionDenial: /permission denied|operation not permitted/i.test(stderr),
    mentionsUserNamespace: /user namespace|userns|bubblewrap|bwrap/i.test(stderr),
    mentionsMissingFile: /no such file|not found/i.test(stderr),
    mentionsInvalidConfiguration: /invalid config|error loading config|config.*invalid/i.test(
      stderr,
    ),
    mentionsUnsupportedOption: /unexpected argument|unrecognized option|unknown option/i.test(
      stderr,
    ),
  };
}

/** @param {any} result */
export function parseIsolationCommandResult(result) {
  const details = {
    status: result.status,
    signal: result.signal,
    code: result.error?.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
  if (result.error || result.status !== 0)
    throw Object.assign(new Error("Probe command failed.", { cause: result.error }), details);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw Object.assign(
      new SyntaxError("Probe output is not one JSON value.", { cause: error }),
      details,
    );
  }
}

export function validateSandboxLauncherResult(result) {
  if (result.error || result.status !== 19 || result.stdout !== "rate-proof-launcher") {
    throw new IsolationProofError("pinned-sandbox-launcher", [], {
      ...summarizeIsolationCommandFailure({
        status: result.status,
        signal: result.signal,
        code: result.error?.code,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
      expectedExitStatus: result.status === 19,
      expectedOutput: result.stdout === "rate-proof-launcher",
    });
  }
}

const baselineFacts = ["gatewayReachable", "upstreamReachable", "checkoutWritable"];
const processFacts = [
  "unprivileged",
  "noNewPrivileges",
  "noCapabilities",
  "rootEnvironmentDenied",
  "rootDescriptorsDenied",
  "rootFileDenied",
  "controlsWriteDenied",
  "rootSignalDenied",
  "ptraceDenied",
  "sudoDenied",
];
const sandboxFacts = [
  "unprivileged",
  "noNewPrivileges",
  "noCapabilities",
  "gatewayNetworkDenied",
  "upstreamNetworkDenied",
  "checkoutWriteDenied",
];
const runnerFacts = [
  ...new Set([
    ...baselineFacts,
    ...processFacts,
    ...sandboxFacts,
    "authorizedFakeRoute",
    "sandboxLauncherExecuted",
    "rootRuntimeRemoved",
    "listenersClosed",
    "noCapturedCanary",
  ]),
];
const completedFacts = [...runnerFacts, "namespacesRestored"];

export function requiresRateIsolation(paths) {
  return paths.some(
    (path) =>
      path.startsWith("worker/codex-rate-") ||
      path.startsWith("tests/codex-rate-") ||
      [
        "worker/prove-codex-rate-isolation.mjs",
        ".github/workflows/ci.yml",
        ".github/workflows/codex-runner-proof.yml",
        "package.json",
        "package-lock.json",
        ".nvmrc",
      ].includes(path),
  );
}

export function validateRateIsolationFacts(facts, stage = "complete") {
  const expected = {
    "unsandboxed-baseline": baselineFacts,
    "root-process-boundary": processFacts,
    "pinned-read-only-sandbox": sandboxFacts,
    "runner-complete": runnerFacts,
    complete: completedFacts,
  }[stage];
  if (
    !facts ||
    !expected ||
    Object.keys(facts).length !== expected.length ||
    !expected.every((name) => facts[name] === true)
  )
    throw new IsolationProofError(stage, expected?.filter((name) => facts?.[name] !== true) ?? []);
}

function writeScope(env) {
  const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "HEAD^1", "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  writeFileSync(env.GITHUB_OUTPUT, `needed=${requiresRateIsolation(paths)}\n`, { flag: "a" });
}

async function installProofCli(env) {
  const { readCodexProofConfiguration } = await import("./prove-codex-runner.mjs");
  const profile = readCodexProofConfiguration(
    readFileSync(join(root, ".github/workflows/codex-runner-proof.yml"), "utf8"),
  );
  const folder = join(env.RUNNER_TEMP, "codex-rate-proof-cli");
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      folder,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `@openai/codex@${profile.cli}`,
    ],
    { stdio: "pipe", timeout: 180000 },
  );
  const cli = join(folder, "node_modules/.bin/codex");
  const version = execFileSync(cli, ["--version"], { encoding: "utf8", timeout: 10000 });
  if (version.trim() !== `codex-cli ${profile.cli}`)
    throw new Error("Pinned CLI verification failed.");
  const help = execFileSync(cli, ["sandbox", "--help"], { encoding: "utf8", timeout: 10000 });
  if (!help.includes("--permission-profile"))
    throw new Error("Pinned sandbox command unavailable.");
  writeFileSync(
    join(env.RUNNER_TEMP, "codex-rate-proof-cli.json"),
    JSON.stringify({ folder, cli: profile.cli }),
  );
}

function createRootFixtures(settings) {
  const folder = mkdtempSync(join(tmpdir(), "codex-rate-isolation-"));
  try {
    chmodSync(folder, 0o755);
    const worker = join(folder, "worker");
    mkdirSync(worker, { mode: 0o755 });
    for (const name of proofModules) {
      const target = join(worker, `codex-rate-${name}.mjs`);
      cpSync(join(root, "worker", `codex-rate-${name}.mjs`), target);
      chmodSync(target, 0o444);
    }
    mkdirSync(join(folder, "node_modules"), { mode: 0o755 });
    for (const name of ["js-tiktoken", "base64-js"])
      cpSync(join(root, "node_modules", name), join(folder, "node_modules", name), {
        recursive: true,
      });
    cpSync(settings.cliFolder, join(folder, "cli"), { recursive: true, verbatimSymlinks: true });
    const home = join(folder, "home");
    const project = join(folder, "project");
    const temporary = join(folder, "temporary");
    for (const path of [home, project, temporary]) {
      mkdirSync(path, { mode: 0o700 });
      chownSync(path, settings.uid, settings.gid);
    }
    const projectFile = join(project, "writable-before-sandbox.txt");
    writeFileSync(projectFile, "initial");
    chownSync(projectFile, settings.uid, settings.gid);
    const privateFolder = join(folder, "private");
    mkdirSync(privateFolder, { mode: 0o700 });
    const privateFile = join(privateFolder, "canary.txt");
    const canary = randomBytes(24).toString("hex");
    writeFileSync(privateFile, canary, { mode: 0o600 });
    return {
      folder,
      worker,
      home,
      temporary,
      project,
      projectFile,
      privateFile,
      canary,
      controls: join(worker, "codex-rate-isolation-holder.mjs"),
      probe: join(worker, "codex-rate-isolation-probe.mjs"),
      cli: join(folder, "cli/node_modules/.bin/codex"),
    };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

export function createProbeEnvironment(fixtures) {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    CODEX_HOME: fixtures.home,
    TMPDIR: fixtures.temporary,
  };
}

function launchBoundaryCommand(settings, fixtures, command) {
  const groups = settings.groups.length
    ? [`--groups=${settings.groups.join(",")}`]
    : ["--clear-groups"];
  return spawnSync(
    "/usr/bin/setpriv",
    [
      `--reuid=${settings.uid}`,
      `--regid=${settings.gid}`,
      ...groups,
      "--no-new-privs",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      ...command,
    ],
    {
      env: createProbeEnvironment(fixtures),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 65536,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function probeBoundary(settings, fixtures, command) {
  return parseIsolationCommandResult(launchBoundaryCommand(settings, fixtures, command));
}

function createSandboxCommand(fixtures, command) {
  return [
    fixtures.cli,
    "sandbox",
    "--permission-profile",
    ":read-only",
    "--cd",
    fixtures.project,
    "--",
    ...command,
  ];
}

/** @returns {Promise<any>} */
function waitForHolder(holder) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Holder startup timed out.")), 10000);
    holder.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    holder.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Holder exited before readiness."));
    });
    holder.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Holder startup failed."));
    });
  });
}

async function stopHolder(holder) {
  if (holder.exitCode !== null || holder.signalCode) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => holder.kill("SIGKILL"), 5000);
    holder.once("exit", () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    if (holder.connected) holder.send("close");
    else holder.kill("SIGTERM");
  });
}

async function proveRunnerBoundary(settings) {
  const fixtures = createRootFixtures(settings);
  const holder = fork(join(fixtures.worker, "codex-rate-isolation-holder.mjs"), [], {
    env: { ...createProbeEnvironment(fixtures), ISOLATION_FAKE_CANARY: fixtures.canary },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let captured = "";
  holder.stdout.on("data", (chunk) => {
    captured += chunk;
  });
  holder.stderr.on("data", (chunk) => {
    captured += chunk;
  });
  let stage = "holder-startup";
  let facts;
  try {
    const ports = await waitForHolder(holder);
    const input = JSON.stringify({
      ...ports,
      pid: holder.pid,
      privateFile: fixtures.privateFile,
      controls: fixtures.controls,
      projectFile: fixtures.projectFile,
    });
    stage = "unsandboxed-baseline";
    const baseline = probeBoundary(settings, fixtures, [
      process.execPath,
      fixtures.probe,
      "baseline",
      input,
    ]);
    validateRateIsolationFacts(baseline, stage);
    stage = "root-process-boundary";
    const processBoundary = probeBoundary(settings, fixtures, [
      process.execPath,
      fixtures.probe,
      "process",
      input,
    ]);
    validateRateIsolationFacts(processBoundary, stage);
    stage = "pinned-sandbox-launcher";
    validateSandboxLauncherResult(
      launchBoundaryCommand(
        settings,
        fixtures,
        createSandboxCommand(fixtures, [
          process.execPath,
          "-e",
          'require("node:fs").writeFileSync(1, "rate-proof-launcher"); process.exitCode = 19;',
        ]),
      ),
    );
    stage = "pinned-read-only-sandbox";
    const sandbox = probeBoundary(
      settings,
      fixtures,
      createSandboxCommand(fixtures, [process.execPath, fixtures.probe, "sandbox", input]),
    );
    validateRateIsolationFacts(sandbox, stage);
    stage = "authorized-fake-route";
    const response = await fetch(`http://127.0.0.1:${ports.gateway}/v1/responses`, {
      method: "POST",
      headers: { authorization: "Bearer isolation-test-only", "content-type": "application/json" },
      body: JSON.stringify({ stream: true, input: "isolation proof" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !(await response.text()).includes('"input_tokens":4'))
      throw new Error(stage);
    facts = {
      ...baseline,
      ...processBoundary,
      ...sandbox,
      sandboxLauncherExecuted: true,
      authorizedFakeRoute: true,
    };
  } catch (error) {
    throw new IsolationProofError(
      stage,
      error instanceof IsolationProofError ? error.failedFacts : [],
      {
        ...(error instanceof IsolationProofError
          ? error.commandFacts
          : summarizeIsolationCommandFailure(error)),
        ...settings.namespaceFacts,
      },
    );
  } finally {
    await stopHolder(holder);
    rmSync(fixtures.folder, { recursive: true, force: true });
  }
  const closed = !holder.connected && (holder.exitCode !== null || holder.signalCode !== null);
  validateRateIsolationFacts(
    {
      ...facts,
      rootRuntimeRemoved: !existsSync(fixtures.folder),
      listenersClosed: closed,
      noCapturedCanary: !captured.includes(fixtures.canary),
    },
    "runner-complete",
  );
  return { ...facts, rootRuntimeRemoved: true, listenersClosed: true, noCapturedCanary: true };
}

async function proveRootBoundary(settings) {
  if (process.getuid() !== 0 || settings.uid === 0 || settings.githubHosted !== true)
    throw new Error("Expected disposable hosted root holder and unprivileged probe.");
  try {
    const { namespacePolicy, ...facts } = await verifyWithRateNamespaces((namespaceFacts) =>
      proveRunnerBoundary({ ...settings, namespaceFacts }),
    );
    return { facts, namespacePolicy };
  } catch (error) {
    if (error instanceof RateNamespaceError) throw new IsolationProofError(error.phase);
    throw error;
  }
}

async function proveHostedBoundary(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_OS !== "Linux" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    privateEnvironment.some((name) => env[name])
  ) {
    throw new Error("Proof requires a secret-free GitHub-hosted Linux job.");
  }
  const profile = JSON.parse(
    readFileSync(join(env.RUNNER_TEMP, "codex-rate-proof-cli.json"), "utf8"),
  );
  const settings = {
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
    cliFolder: profile.folder,
    githubHosted: true,
  };
  const output = execFileSync(
    "sudo",
    [
      "-n",
      "/usr/bin/env",
      "-i",
      `PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
      process.execPath,
      fileURLToPath(import.meta.url),
      "privileged",
      JSON.stringify(settings),
    ],
    { encoding: "utf8", timeout: 120000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] },
  );
  const result = JSON.parse(output);
  if (result.passed === false)
    throw new IsolationProofError(result.stage, result.failedFacts, result.commandFacts);
  validateRateIsolationFacts(result.facts);
  return {
    version: 1,
    passed: true,
    source: env.GITHUB_SHA,
    run: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    nativeModelStarted: false,
    realCredentialUsed: false,
    cliVersion: profile.cli,
    facts: result.facts,
    namespacePolicy: result.namespacePolicy,
  };
}

function removeProofInstallation(env) {
  for (const name of ["codex-rate-proof-cli", "codex-rate-proof-cli.json"])
    rmSync(join(env.RUNNER_TEMP, name), { recursive: true, force: true });
  const path = join(env.RUNNER_TEMP, "codex-rate-isolation-proof.json");
  const result = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {
        version: 1,
        passed: false,
        stage: "cli-installation",
        source: env.GITHUB_SHA,
        run: env.GITHUB_RUN_ID,
        attempt: env.GITHUB_RUN_ATTEMPT,
        nativeModelStarted: false,
        realCredentialUsed: false,
      };
  result.installationRemoved = !existsSync(join(env.RUNNER_TEMP, "codex-rate-proof-cli"));
  result.passed = result.passed && result.installationRemoved;
  writeFileSync(path, JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "scope") writeScope(process.env);
    else if (command === "install") await installProofCli(process.env);
    else if (command === "cleanup") removeProofInstallation(process.env);
    else if (command === "privileged")
      writeRateProbeResult(await proveRootBoundary(JSON.parse(process.argv[3])));
    else if (command === "prove") {
      const result = await proveHostedBoundary(process.env);
      writeFileSync(
        join(process.env.RUNNER_TEMP, "codex-rate-isolation-proof.json"),
        JSON.stringify(result),
      );
      console.log(
        "Secret-free Codex rate-control isolation proof passed. No native model or real credential was used.",
      );
    } else throw new Error("Unsupported proof command.");
  } catch (error) {
    const stage = error instanceof IsolationProofError ? error.stage : "privileged-process";
    const failedFacts = error instanceof IsolationProofError ? error.failedFacts : [];
    const commandFacts =
      error instanceof IsolationProofError
        ? error.commandFacts
        : summarizeIsolationCommandFailure(error);
    if (command === "privileged") {
      writeRateProbeResult({ passed: false, stage, failedFacts, commandFacts });
    }
    if (command === "prove")
      writeFileSync(
        join(process.env.RUNNER_TEMP, "codex-rate-isolation-proof.json"),
        JSON.stringify({
          version: 1,
          passed: false,
          source: process.env.GITHUB_SHA,
          run: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT,
          stage,
          failedFacts,
          commandFacts,
          nativeModelStarted: false,
          realCredentialUsed: false,
        }),
      );
    if (command !== "privileged") {
      console.error(
        `Secret-free rate-control isolation proof failed at ${stage}; no model work was started.`,
      );
      process.exitCode = 1;
    }
  }
}
