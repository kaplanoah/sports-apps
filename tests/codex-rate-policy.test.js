import test from "node:test";
import assert from "node:assert/strict";
import {
  readNativeRatePolicy,
  readNativeRatePolicyHash,
  readRateReleaseTime,
  createBoundedNativeConfig,
  createNativeAdmissionStepName,
  isNativeAdmissionStepName,
} from "../worker/codex-rate-policy.mjs";
import { createRequestEstimator } from "../worker/codex-rate-estimate.mjs";

test("native policy has conservative per-request and rolling admission without claiming exact tokenization", () => {
  const policy = readNativeRatePolicy();
  assert.equal(policy.tokens, 1000000);
  assert.equal(policy.windowMs, 60000);
  assert.ok(policy.requests <= 30);
  assert.ok(policy.spacingMs * policy.requests >= policy.windowMs);
  assert.equal(policy.headroom, policy.feedbackHeadroom);
  assert.ok(policy.headroom >= 0.2);
  assert.ok(policy.outputReserveTokens > 0);
  const estimate = createRequestEstimator(policy)({ stream: true, input: "example" });
  assert.equal(estimate.modelTokenizerVerified, false);
  assert.ok(estimate.reservation > estimate.outputReserveTokens);
  assert.match(readNativeRatePolicyHash(), /^[a-f0-9]{64}$/);
  assert.throws(() => {
    Object.assign(policy, { tokens: 999999999 });
  });
});

test("native configuration bounds connection retries without overriding the official provider", () => {
  const config = createBoundedNativeConfig();
  assert.match(config, /^\[features\]\nunbounded_connection_retries = false\n$/);
  assert.doesNotMatch(config, /model_provider|model_providers|unsafe|disable.*sandbox/);
});

test("quota handoff waits for unknown usage and the longest provider or local deadline", () => {
  const completedAt = 1000000;
  const snapshot = {
    local: { blockedUntil: completedAt + 120000, events: [{ expires: completedAt + 60000 }] },
    provider: { tokens: { until: completedAt + 180000 }, requests: null },
  };
  assert.equal(readRateReleaseTime(snapshot, completedAt), completedAt + 180000);
  assert.equal(
    readRateReleaseTime({ local: { blockedUntil: 0, events: [] }, provider: {} }, completedAt),
    completedAt + 60000,
  );
  for (const bad of [null, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.throws(() => readRateReleaseTime(snapshot, bad));
  assert.throws(() =>
    readRateReleaseTime({ ...snapshot, local: { blockedUntil: null } }, completedAt),
  );
});

test("admission step recognition uses the exact shared portion format", () => {
  for (const portion of ["1", "27", "integration", "proof"])
    assert.equal(isNativeAdmissionStepName(createNativeAdmissionStepName(portion)), true);
  for (const name of [
    null,
    1,
    "Other (1)",
    "Authenticate preceding quota state and prepare protected admission (0)",
    "Authenticate preceding quota state and prepare protected admission (1) extra",
    "Authenticate preceding quota state and prepare protected admission(1)",
  ])
    assert.equal(isNativeAdmissionStepName(name), false);
});
