import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @typedef {(command: string, arguments_: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} InstallerSpawn */
/** @typedef {(command: string, arguments_: string[], options: import("node:child_process").SpawnSyncOptionsWithStringEncoding) => import("node:child_process").SpawnSyncReturns<string>} CleanupSpawn */

export const ATTEMPT_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_ATTEMPTS = 2;
export const CLEANUP_GRACE_MS = 1000;
export const CLEANUP_TIMEOUT_MS = 2000;
const OUTPUT_LIMIT = 16 * 1024;
const PERMANENT_FAILURE =
  /\b(?:HTTP(?:\/\d(?:\.\d)?)?\s+|status(?: code)?\s*[:=]?\s*|server returned(?: code)?\s*[:=]?\s*)(?:401|403|407)\b|Failed to fetch \S+\s+(?:401|403|407)\b|^(?:E:|Error:|npm ERR!|fatal:)[^\n]*(?:certificate|permission denied|access denied|not allowed|blocked by|unable to locate package|no installation candidate|unknown option|unsupported|not found)/im;
const TRANSIENT_FAILURE =
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_CONNECTION_RESET|socket hang up|temporary failure resolving|connection timed out|connection reset|(?:server returned(?: code)?|status(?: code)?)\s*[:=]?\s*5\d\d\b|\bHTTP(?:\/\d(?:\.\d)?)?\s+5\d\d\b|Failed to fetch \S+\s+5\d\d\b/i;

/** @param {number} processId */
function isProcessGroupPresent(processId) {
  try {
    process.kill(-processId, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH";
  }
}

/**
 * @param {number} processId
 * @param {NodeJS.Signals} signal
 */
function stopProcessGroup(processId, signal) {
  try {
    process.kill(-processId, signal);
  } catch (error) {
    if (!["ESRCH", "EPERM"].includes(/** @type {NodeJS.ErrnoException} */ (error).code))
      throw error;
  }
}

/**
 * @param {string[]} arguments_
 * @param {{ spawnImpl: InstallerSpawn, cleanupSpawn: CleanupSpawn, timeoutMs: number, signal?: AbortSignal }} options
 * @returns {Promise<{ code: number, output: string, timedOut: boolean, retryable: boolean, permanentReason: string }>}
 */
function installAttempt(arguments_, { spawnImpl, cleanupSpawn, timeoutMs, signal }) {
  return new Promise((resolve) => {
    const child = spawnImpl(
      process.execPath,
      [
        fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)),
        "install",
        ...arguments_,
      ],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let timedOut = false;
    let permanentReason = "";
    let transientFailure = false;
    let finished = false;
    let cleanup;
    const keepOutput = (chunk) => {
      const combined = output + chunk.toString();
      permanentReason ||= combined.match(PERMANENT_FAILURE)?.[0] ?? "";
      transientFailure ||= TRANSIENT_FAILURE.test(combined);
      output = combined.slice(-OUTPUT_LIMIT);
    };
    const finishAttempt = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearTimeout(cleanup);
      signal?.removeEventListener("abort", stopChild);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        output,
        timedOut,
        retryable: transientFailure && !permanentReason,
        permanentReason,
      });
    };
    const forceStopChild = () => {
      const requiresRoot =
        arguments_.includes("--with-deps") &&
        process.platform === "linux" &&
        process.getuid() !== 0;
      if (requiresRoot && isProcessGroupPresent(child.pid)) {
        const result = cleanupSpawn(
          "sudo",
          ["-n", "--", "/bin/kill", "-KILL", "--", `-${child.pid}`],
          {
            encoding: "utf8",
            timeout: CLEANUP_TIMEOUT_MS,
            killSignal: "SIGKILL",
            stdio: "pipe",
          },
        );
        if (result.status !== 0 && isProcessGroupPresent(child.pid))
          keepOutput(
            "\nCould not confirm privileged browser installer cleanup; check passwordless sudo.\n",
          );
      }
      stopProcessGroup(child.pid, "SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
      finishAttempt(1);
    };
    const stopChild = () => {
      if (!child.pid || cleanup) return;
      stopProcessGroup(child.pid, "SIGTERM");
      cleanup = setTimeout(forceStopChild, CLEANUP_GRACE_MS);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);
    child.stdout?.on("data", keepOutput);
    child.stderr?.on("data", keepOutput);
    child.on("error", (error) => keepOutput(error.message));
    signal?.addEventListener("abort", stopChild, { once: true });
    if (signal?.aborted) stopChild();
    child.once("close", finishAttempt);
  });
}

/**
 * @param {string[]} arguments_
 * @param {{ spawnImpl?: InstallerSpawn, cleanupSpawn?: CleanupSpawn, timeoutMs?: number, signal?: AbortSignal, log?: (message: string) => void }} [options]
 */
export async function installBrowsers(
  arguments_,
  {
    spawnImpl = spawn,
    cleanupSpawn = spawnSync,
    timeoutMs = ATTEMPT_TIMEOUT_MS,
    signal,
    log = console.log,
  } = {},
) {
  /** @type {number} */
  let lastCode;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) return 130;
    const result = await installAttempt(arguments_, { spawnImpl, cleanupSpawn, timeoutMs, signal });
    lastCode = result.code;
    if (signal?.aborted) {
      log("Browser installation cancelled.");
      if (result.output.trim()) log(result.output.trim());
      return 130;
    }
    if (result.code === 0) {
      log("Browser installation: ok.");
      return 0;
    }
    log(
      result.timedOut
        ? `Browser installation exceeded its ${timeoutMs / 1000}-second attempt limit.`
        : `Browser installation failed (exit ${result.code}).`,
    );
    if (result.output.trim()) log(result.output.trim());
    if (result.permanentReason)
      log(`A permanent error was reported (${result.permanentReason}); no retry.`);
    if (result.timedOut || !result.retryable) return result.code;
    if (attempt < MAX_ATTEMPTS)
      log("Retrying browser installation once after a transient transport failure.");
  }
  return lastCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => cancellation.abort());
  process.exitCode = await installBrowsers(process.argv.slice(2), { signal: cancellation.signal });
}
