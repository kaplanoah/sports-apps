import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createAdmissionController } from "./codex-rate-controller.mjs";
import { createRequestEstimator } from "./codex-rate-estimate.mjs";
import { startAdmissionGateway } from "./codex-rate-gateway.mjs";
import { readNativeQuotaAdmission } from "./codex-rate-handoff.mjs";
import {
  readNativeRatePolicy,
  readNativeRatePolicyHash,
  readRateReleaseTime,
  requireNativeQuotaIdentity,
} from "./codex-rate-policy.mjs";
import { inspectProcessLifetime, monitorNativeLifetime } from "./codex-rate-lifecycle.mjs";
import { snapshotRateNamespaces, restoreRateNamespaces } from "./codex-rate-namespaces.mjs";

export { inspectProcessLifetime };

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** @param {string} folder @param {string} node */
export function createNativeRateHook(folder, node) {
  const runtime = join(folder, "public/runtime.mjs");
  return [
    'if [ -n "${CODEX_PROMPT_FILE:-}" ]; then',
    `  ${quoteShell(node)} ${quoteShell(runtime)} launch ${quoteShell(folder)} "$$" || exit 1`,
    '  exec > "$RUNNER_TEMP/codex-events.jsonl" 2>&1',
    "fi",
    "",
  ].join("\n");
}

/** @param {any} admission @param {any} [options] */
export async function startNativeRateRuntime(
  admission,
  { start = startAdmissionGateway, now = Date.now, send = fetch } = {},
) {
  if (admission.policy !== readNativeRatePolicyHash())
    throw new Error("Native quota policy mismatch.");
  const controller = createAdmissionController(readNativeRatePolicy(), {
    now,
    notBefore: admission.notBefore,
  });
  const metrics = {
    requests: 0,
    reservedTokens: 0,
    observedTokens: 0,
    unavailable: 0,
    queuedMs: 0,
  };
  const tickets = new Set();
  const gateway = await start({
    port: admission.port,
    estimate: createRequestEstimator(readNativeRatePolicy()),
    send,
    now,
    budget: {
      async reserve(amount, signal) {
        const queued = now();
        const ticket = await controller.reserve(amount, signal);
        metrics.queuedMs += Math.max(0, now() - queued);
        metrics.requests++;
        metrics.reservedTokens += amount;
        tickets.add(ticket);
        return ticket;
      },
      settle(ticket, observed) {
        controller.settle(ticket, observed);
        tickets.delete(ticket);
        if (observed === null) metrics.unavailable++;
        else metrics.observedTokens += observed;
      },
      defer: controller.defer,
      observeHeaders: controller.observeHeaders,
    },
  });
  return {
    address: gateway.address,
    close: gateway.close,
    readFinalState(completedAt) {
      const snapshot = controller.readSnapshot();
      const values = Object.values(metrics);
      if (tickets.size || values.some((value) => !Number.isSafeInteger(value) || value < 0))
        throw new Error("Native quota accounting did not finalize.");
      return {
        ...metrics,
        feedbackFailed: snapshot.feedbackFailed,
        observedTokens: metrics.unavailable || !metrics.requests ? null : metrics.observedTokens,
        notBefore: readRateReleaseTime(snapshot, completedAt),
      };
    },
  };
}

function requireHosted(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_OS !== "Linux" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_RUN_ATTEMPT !== "1"
  )
    throw new Error("Native admission requires a first-attempt disposable hosted Linux job.");
}

function readRootConfiguration(folder) {
  const root = resolve(folder);
  const info = lstatSync(root);
  if (
    process.getuid?.() !== 0 ||
    !root.startsWith("/tmp/codex-native-rate-") ||
    info.isSymbolicLink() ||
    info.uid !== 0 ||
    (info.mode & 0o777) !== 0o711
  )
    throw new Error("Invalid native root runtime.");
  return JSON.parse(readFileSync(join(root, "private/settings.json"), "utf8"));
}

async function selectLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve(undefined))),
  );
  if (!address || typeof address === "string")
    throw new Error("Native admission port unavailable.");
  return address.port;
}

export function prepareProtectedNativeRuntime(input) {
  if (
    process.getuid?.() !== 0 ||
    input.hosted !== true ||
    input.policy !== readNativeRatePolicyHash()
  )
    throw new Error("Invalid native root preparation.");
  const folder = mkdtempSync("/tmp/codex-native-rate-");
  chmodSync(folder, 0o711);
  try {
    mkdirSync(join(folder, "private"), { mode: 0o700 });
    mkdirSync(join(folder, "public"), { mode: 0o755 });
    for (const target of ["private/runtime.mjs", "public/runtime.mjs"]) {
      copyFileSync(fileURLToPath(import.meta.url), join(folder, target));
      chmodSync(join(folder, target), 0o444);
    }
    const settings = createProtectedRateSettings(input, snapshotRateNamespaces());
    writeFileSync(join(folder, "private/settings.json"), JSON.stringify(settings), { mode: 0o400 });
    writeFileSync(join(folder, "public/hook.sh"), createNativeRateHook(folder, process.execPath), {
      mode: 0o444,
    });
    writeFileSync(
      join(folder, "public/identity.json"),
      JSON.stringify({
        job: input.job,
        source: input.source,
        policy: input.policy,
        port: input.port,
      }),
      { mode: 0o444 },
    );
    return { folder, port: input.port };
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

/** @param {any} input @param {any} namespaces */
export function createProtectedRateSettings(input, namespaces) {
  requireNativeQuotaIdentity(input);
  if (!Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65535)
    throw new Error("Invalid native loopback port.");
  return {
    version: 1,
    repository: input.repository,
    run: input.run,
    job: input.job,
    source: input.source,
    policy: input.policy,
    notBefore: input.notBefore,
    scanSince: input.scanSince,
    activeRuns: input.activeRuns,
    port: input.port,
    namespaces,
  };
}

/** @param {any} config @param {any} metrics @param {any} result */
export function createNativeQuotaRecord(
  config,
  metrics,
  { termination, completedAt, restored, removed },
) {
  requireNativeQuotaIdentity(config);
  if (
    !restored ||
    !removed ||
    !["parent-exited", "deadline", "not-started"].includes(termination) ||
    (termination === "not-started" &&
      (metrics.requests !== 0 ||
        metrics.reservedTokens !== 0 ||
        metrics.observedTokens !== null)) ||
    !Number.isSafeInteger(completedAt) ||
    completedAt < 0 ||
    [
      metrics.requests,
      metrics.reservedTokens,
      metrics.unavailable,
      metrics.queuedMs,
      metrics.notBefore,
    ].some((value) => !Number.isSafeInteger(value) || value < 0) ||
    (metrics.observedTokens !== null &&
      (!Number.isSafeInteger(metrics.observedTokens) || metrics.observedTokens < 0)) ||
    typeof metrics.feedbackFailed !== "boolean" ||
    metrics.notBefore < completedAt + readNativeRatePolicy().windowMs
  )
    throw new Error("Native quota cleanup is incomplete.");
  return {
    version: 1,
    repository: config.repository,
    run: config.run,
    job: config.job,
    source: config.source,
    policy: config.policy,
    finalized: true,
    termination,
    completedAt,
    scanSince: config.scanSince,
    activeRuns: config.activeRuns,
    namespacesRestored: true,
    runtimeRemoved: true,
    requests: metrics.requests,
    reservedTokens: metrics.reservedTokens,
    observedTokens: metrics.observedTokens,
    unavailable: metrics.unavailable,
    feedbackFailed: metrics.feedbackFailed,
    queuedMs: metrics.queuedMs,
    notBefore: metrics.notBefore,
  };
}

/** @param {string} inputFolder @param {any} expected */
export function readNativeRateInput(inputFolder, expected) {
  const manifest = JSON.parse(readFileSync(join(inputFolder, "manifest.json"), "utf8"));
  const runtimeHash = createHash("sha256")
    .update(readFileSync(join(inputFolder, "runtime.mjs")))
    .digest("hex");
  if (
    manifest.version !== 1 ||
    manifest.runtimeSHA256 !== runtimeHash ||
    manifest.source !== expected.source ||
    manifest.run !== expected.run ||
    manifest.repository !== expected.repository ||
    manifest.portion !== expected.portion ||
    manifest.policy !== readNativeRatePolicyHash()
  )
    throw new Error("Native rate input identity mismatch.");
  return manifest;
}

/** @param {string} inputFolder @param {any} env @param {any} [options] */
export async function prepareNativeAdmission(
  inputFolder,
  env,
  {
    readAdmission = readNativeQuotaAdmission,
    now = Date.now,
    wait = delay,
    selectPort = selectLoopbackPort,
    spawnRoot = spawnSync,
  } = {},
) {
  requireHosted(env);
  const source = env.REVIEW_TRUSTED ?? env.GITHUB_SHA;
  const portion = env.PORTION ?? "proof";
  readNativeRateInput(inputFolder, {
    source,
    portion,
    run: Number(env.GITHUB_RUN_ID),
    repository: env.GITHUB_REPOSITORY,
  });
  const admission = await readAdmission({
    source,
    portion,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    owner: env.GITHUB_REPOSITORY_OWNER,
    run: Number(env.GITHUB_RUN_ID),
    token: env.GH_TOKEN,
  });
  const remaining = admission.notBefore - now();
  if (remaining > readNativeRatePolicy().maxWaitMs)
    throw new Error("Preceding native quota cooldown exceeds pre-model wait budget.");
  if (remaining > 0) await wait(remaining);
  const input = { ...admission, hosted: true, port: await selectPort() };
  const result = spawnRoot(
    "sudo",
    [
      "-n",
      "/usr/bin/env",
      "-i",
      `PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
      "NODE_OPTIONS=--disable-sigusr1",
      process.execPath,
      "--disable-sigusr1",
      fileURLToPath(import.meta.url),
      "root-prepare",
    ],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) throw new Error("Could not prepare protected native admission.");
  const prepared = JSON.parse(result.stdout);
  if (
    !/^\/tmp\/codex-native-rate-[A-Za-z0-9]+$/.test(prepared.folder) ||
    prepared.port !== input.port
  )
    throw new Error("Invalid protected native admission result.");
  appendFileSync(
    env.GITHUB_OUTPUT,
    [
      `endpoint=http://127.0.0.1:${prepared.port}/v1/responses`,
      `hook=${prepared.folder}/public/hook.sh`,
      `collector=${prepared.folder}/public/runtime.mjs`,
      `folder=${prepared.folder}`,
      `artifact=codex-rate-handoff-${admission.job}`,
      `result=${prepared.folder}/public/cooldown.json`,
      "",
    ].join("\n"),
  );
}

/** @param {string} folder @param {string} parentPid @param {any} [options] */
export async function launchNativeAdmission(
  folder,
  parentPid,
  { inspect = inspectProcessLifetime, spawnRoot = spawn, now = Date.now, wait = delay } = {},
) {
  const parent = inspect(Number(parentPid));
  if (!parent) throw new Error("Native invocation parent is unavailable.");
  const child = spawnRoot(
    "sudo",
    [
      "-n",
      "/usr/bin/env",
      "-i",
      `PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
      "NODE_OPTIONS=--disable-sigusr1",
      process.execPath,
      "--disable-sigusr1",
      join(folder, "private/runtime.mjs"),
      "serve",
      folder,
      JSON.stringify(parent),
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  let failed = false;
  child.once("error", () => {
    failed = true;
  });
  const until = now() + 10000;
  const path = join(folder, "public/ready.json");
  while (!existsSync(path)) {
    if (failed || existsSync(join(folder, "public/failed.json")) || now() >= until)
      throw new Error("Native admission did not become ready.");
    await wait(50);
  }
  const ready = JSON.parse(readFileSync(path, "utf8"));
  const identity = JSON.parse(readFileSync(join(folder, "public/identity.json"), "utf8"));
  if (
    !ready.passed ||
    ready.job !== identity.job ||
    ready.port !== identity.port ||
    ready.parent !== parent.pid
  )
    throw new Error("Native admission readiness mismatch.");
}

function restoreNativeControls(folder, config, restore) {
  try {
    restore(config.namespaces);
  } finally {
    rmSync(join(folder, "private"), { recursive: true, force: true });
    rmSync(join(folder, "public/hook.sh"), { force: true });
  }
}

function createUnusedQuotaMetrics(completedAt) {
  return {
    requests: 0,
    reservedTokens: 0,
    observedTokens: null,
    unavailable: 0,
    queuedMs: 0,
    feedbackFailed: false,
    notBefore: completedAt + readNativeRatePolicy().windowMs,
  };
}

/** @param {string} folder @param {any} parent @param {any} [options] */
export async function superviseNativeAdmission(
  folder,
  parent,
  {
    start = startNativeRateRuntime,
    readConfiguration = readRootConfiguration,
    restore = restoreRateNamespaces,
    now = Date.now,
    monitor = monitorNativeLifetime,
  } = {},
) {
  const config = readConfiguration(folder);
  let runtime;
  let restored = false;
  let finalized = false;
  let ready = false;
  let closed = false;
  async function closeRuntime() {
    if (closed) return;
    closed = true;
    const errors = [];
    try {
      await runtime?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      restoreNativeControls(folder, config, restore);
      restored = true;
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "Native runtime could not close safely.");
  }
  function publishQuota(metrics, termination, completedAt) {
    const record = createNativeQuotaRecord(config, metrics, {
      termination,
      completedAt,
      restored,
      removed: !existsSync(join(folder, "private")),
    });
    writeFileSync(join(folder, "public/cooldown.json"), JSON.stringify(record), {
      mode: 0o444,
      flag: "wx",
    });
    finalized = true;
  }
  try {
    runtime = await start(config);
    writeFileSync(
      join(folder, "public/ready.json"),
      JSON.stringify({
        passed: true,
        job: config.job,
        port: runtime.address.port,
        parent: parent.pid,
      }),
      { mode: 0o444, flag: "wx" },
    );
    ready = true;
    await monitor({
      parent,
      deadline: now() + readNativeRatePolicy().runtimeMs,
      stop: closeRuntime,
      finalize({ termination, completedAt }) {
        publishQuota(runtime.readFinalState(completedAt), termination, completedAt);
      },
    });
  } catch (error) {
    if (!ready) {
      try {
        await closeRuntime();
        const completedAt = now();
        publishQuota(
          runtime?.readFinalState(completedAt) ?? createUnusedQuotaMetrics(completedAt),
          "not-started",
          completedAt,
        );
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Native startup and cleanup failed.", {
          cause: error,
        });
      }
    }
    throw error;
  } finally {
    try {
      if (!closed) await closeRuntime();
    } finally {
      if (!finalized || !ready)
        writeFileSync(join(folder, "public/failed.json"), '{"passed":false}', { mode: 0o444 });
    }
  }
}

/** @param {string} folder @param {any} [options] */
export function finishUnstartedAdmission(
  folder,
  {
    readConfiguration = readRootConfiguration,
    restore = restoreRateNamespaces,
    now = Date.now,
  } = {},
) {
  const config = readConfiguration(folder);
  if (existsSync(join(folder, "public/ready.json")))
    throw new Error("An active native runtime owns its cleanup.");
  try {
    restoreNativeControls(folder, config, restore);
    const completedAt = now();
    const record = createNativeQuotaRecord(config, createUnusedQuotaMetrics(completedAt), {
      termination: "not-started",
      completedAt,
      restored: true,
      removed: !existsSync(join(folder, "private")),
    });
    writeFileSync(join(folder, "public/cooldown.json"), JSON.stringify(record), {
      flag: "wx",
      mode: 0o444,
    });
  } catch (error) {
    writeFileSync(join(folder, "public/failed.json"), '{"passed":false}', { mode: 0o444 });
    throw error;
  }
}

/** @param {string} folder @param {any} env @param {any} [options] */
export async function collectNativeAdmission(
  folder,
  env,
  { spawnRoot = spawnSync, now = Date.now, wait = delay, stat = lstatSync } = {},
) {
  requireHosted(env);
  const path = join(folder, "public/cooldown.json");
  if (!existsSync(path) && !existsSync(join(folder, "public/ready.json"))) {
    const cleanup = spawnRoot(
      "sudo",
      [
        "-n",
        "/usr/bin/env",
        "-i",
        `PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
        "NODE_OPTIONS=--disable-sigusr1",
        process.execPath,
        "--disable-sigusr1",
        join(folder, "private/runtime.mjs"),
        "not-started",
        folder,
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    if (cleanup.status !== 0) throw new Error("Native startup cleanup failed.");
  }
  const deadline = now() + 10000;
  while (!existsSync(path)) {
    if (existsSync(join(folder, "public/failed.json")) || now() >= deadline)
      throw new Error("Native quota state could not finalize.");
    await wait(50);
  }
  const result = JSON.parse(readFileSync(path, "utf8"));
  validateNativeQuotaResult(result, {
    run: Number(env.GITHUB_RUN_ID),
    repository: env.GITHUB_REPOSITORY,
    source: env.REVIEW_TRUSTED ?? env.GITHUB_SHA,
  });
  const info = stat(path);
  if (info.uid !== 0 || info.isSymbolicLink() || (info.mode & 0o222) !== 0)
    throw new Error("Native quota state did not preserve its trusted boundary.");
}

/** @param {any} result @param {any} expected */
export function validateNativeQuotaResult(result, expected) {
  requireNativeQuotaIdentity(result);
  createNativeQuotaRecord(result, result, {
    termination: result.termination,
    completedAt: result.completedAt,
    restored: result.namespacesRestored === true,
    removed: result.runtimeRemoved === true,
  });
  if (
    result.run !== expected.run ||
    result.repository !== expected.repository ||
    result.source !== expected.source ||
    result.policy !== readNativeRatePolicyHash() ||
    result.finalized !== true ||
    !["parent-exited", "not-started"].includes(result.termination) ||
    result.feedbackFailed !== false
  )
    throw new Error("Native quota state did not preserve its trusted boundary.");
}

async function dispatchNativeAdmission() {
  const [command, folder, parent] = process.argv.slice(2);
  if (command === "prepare") await prepareNativeAdmission(folder, process.env);
  else if (command === "root-prepare") {
    const settings = prepareProtectedNativeRuntime(JSON.parse(readFileSync(0, "utf8")));
    writeFileSync(1, JSON.stringify(settings));
  } else if (command === "launch") await launchNativeAdmission(folder, parent);
  else if (command === "serve") await superviseNativeAdmission(folder, JSON.parse(parent));
  else if (command === "not-started") finishUnstartedAdmission(folder);
  else if (command === "collect") await collectNativeAdmission(folder, process.env);
  else throw new Error("Unknown native admission command.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dispatchNativeAdmission().catch((error) => {
    if (process.argv[2] === "prepare" && process.env.RUNNER_TEMP) {
      const status = Number(error?.status);
      writeFileSync(
        join(process.env.RUNNER_TEMP, "native-rate-setup.json"),
        JSON.stringify({
          version: 1,
          passed: false,
          modelStarted: false,
          status: Number.isSafeInteger(status) && status >= 400 && status <= 599 ? status : null,
        }),
      );
    }
    console.error("Native admission did not establish its required controls.");
    process.exitCode = 1;
  });
}
