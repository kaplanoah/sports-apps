import { createHash } from "node:crypto";

export const NATIVE_ADMISSION_STEP =
  "Authenticate preceding quota state and prepare protected admission";

/** @param {string} portion */
export function createNativeAdmissionStepName(portion) {
  if (!/^(?:[1-9]\d*|integration|proof)$/.test(portion))
    throw new Error("Invalid native quota portion.");
  return `${NATIVE_ADMISSION_STEP} (${portion})`;
}

const headroom = 0.2;
const policy = Object.freeze({
  tokens: 1000000,
  requests: 30,
  windowMs: 60000,
  spacingMs: 2000,
  maxWaitMs: 300000,
  runtimeMs: 45 * 60000,
  feedbackHeadroom: headroom,
  encodingName: "o200k_base",
  outputReserveTokens: 32768,
  overheadTokens: 1024,
  headroom,
});

export function readNativeRatePolicy() {
  return policy;
}

export function readNativeRatePolicyHash() {
  return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function createBoundedNativeConfig() {
  return "[features]\nunbounded_connection_retries = false\n";
}

/** @param {any} value */
export function requireNativeQuotaIdentity(value, expectedPolicy = readNativeRatePolicyHash()) {
  if (
    value?.version !== 1 ||
    !/^[\w.-]+\/[\w.-]+$/.test(value.repository ?? "") ||
    !/^[a-f0-9]{40}$/.test(value.source ?? "") ||
    !/^[a-f0-9]{64}$/.test(expectedPolicy) ||
    value.policy !== expectedPolicy ||
    [value.run, value.job].some((number) => !Number.isSafeInteger(number) || number <= 0) ||
    [value.notBefore, value.scanSince].some(
      (number) => !Number.isSafeInteger(number) || number < 0,
    ) ||
    !Array.isArray(value.activeRuns) ||
    value.activeRuns.length > 256 ||
    new Set(value.activeRuns).size !== value.activeRuns.length ||
    value.activeRuns.some((number) => !Number.isSafeInteger(number) || number <= 0)
  )
    throw new Error("Invalid native quota identity.");
}

/** @param {any} snapshot @param {number} completedAt */
export function readRateReleaseTime(snapshot, completedAt) {
  const times = [
    completedAt + policy.windowMs,
    snapshot?.local?.blockedUntil,
    ...Object.values(snapshot?.provider ?? {}).map((value) => value?.until ?? 0),
    ...(snapshot?.local?.events ?? []).map((event) => event.expires),
  ];
  if (
    !Number.isSafeInteger(completedAt) ||
    completedAt < 0 ||
    times.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error("Unavailable native quota release time.");
  return Math.max(...times);
}
