import { parseReset } from "./codex-rate-budget.mjs";
import { getEncoding } from "js-tiktoken";

/** @param {any} policy */
export function createRequestEstimator(policy) {
  if (!policy.encodingName) throw new Error("An explicit estimation encoding is required.");
  const encoder = getEncoding(policy.encodingName);
  return (payload) => ({
    ...estimateRequestTokens(payload, policy, (text) => encoder.encode(text).length),
    encoding: policy.encodingName,
    modelTokenizerVerified: false,
  });
}

/** @param {any} payload @param {any} policy @param {(value:string)=>number} tokenize */
export function estimateRequestTokens(payload, policy, tokenize) {
  if (
    typeof tokenize !== "function" ||
    !Number.isSafeInteger(policy.outputReserveTokens) ||
    policy.outputReserveTokens <= 0 ||
    !Number.isSafeInteger(policy.overheadTokens) ||
    policy.overheadTokens < 0 ||
    !Number.isFinite(policy.headroom) ||
    policy.headroom < 0 ||
    policy.headroom >= 1
  ) {
    throw new Error("Incomplete request estimation policy.");
  }
  const serialized = JSON.stringify(payload);
  const input = tokenize(serialized);
  if (!Number.isSafeInteger(input) || input < 0) throw new Error("Unavailable input estimate.");
  const estimate = Math.ceil(
    (input + policy.overheadTokens + policy.outputReserveTokens) / (1 - policy.headroom),
  );
  if (!Number.isSafeInteger(estimate)) throw new Error("Request estimate overflow.");
  return {
    reservation: estimate,
    estimatedInputTokens: input,
    outputReserveTokens: policy.outputReserveTokens,
    observedTokens: null,
  };
}

/** @param {any} options @param {()=>number} [now] */
export function createProviderFeedback(
  { tokens, requests, windowMs, headroom = 0.2 },
  now = Date.now,
) {
  if (
    ![tokens, requests, windowMs].every((value) => Number.isSafeInteger(value) && value > 0) ||
    !Number.isFinite(headroom) ||
    headroom < 0 ||
    headroom >= 1
  )
    throw new Error("Invalid feedback policy.");
  const state = { tokens: null, requests: null };
  function prune() {
    for (const name of Object.keys(state)) if (state[name]?.until <= now()) state[name] = null;
  }
  function requireInteger(value) {
    if (!/^\d+$/.test(value ?? "") || !Number.isSafeInteger(Number(value)))
      throw new Error("Malformed provider budget feedback.");
    return Number(value);
  }
  function readReset(value) {
    if (value === null) return now() + windowMs;
    const result = parseReset(value, now());
    if (!Number.isSafeInteger(result)) throw new Error("Malformed provider reset.");
    return result;
  }
  return {
    observe(headers) {
      prune();
      for (const [name, configured] of [
        ["tokens", tokens],
        ["requests", requests],
      ]) {
        const rawRemaining = headers.get(`x-ratelimit-remaining-${name}`);
        const rawLimit = headers.get(`x-ratelimit-limit-${name}`);
        if (rawRemaining === null && rawLimit === null) continue;
        const remaining = rawRemaining === null ? 0 : requireInteger(rawRemaining);
        const limit =
          rawLimit === null ? configured : Math.min(configured, requireInteger(rawLimit));
        const capacity = Math.floor(Math.min(remaining, limit) * (1 - headroom));
        const until = readReset(headers.get(`x-ratelimit-reset-${name}`));
        state[name] = {
          remaining: Math.min(state[name]?.remaining ?? capacity, capacity),
          until: Math.max(state[name]?.until ?? until, until),
        };
      }
    },
    reserve(amount) {
      prune();
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid reservation.");
      const blocked = [
        state.tokens?.remaining < amount ? state.tokens.until : null,
        state.requests?.remaining < 1 ? state.requests.until : null,
      ].filter((value) => value !== null);
      if (blocked.length) return { admitted: false, notBefore: Math.max(...blocked) };
      if (state.tokens) state.tokens.remaining -= amount;
      if (state.requests) state.requests.remaining -= 1;
      return { admitted: true };
    },
    debitExtra(amount) {
      prune();
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid usage adjustment.");
      if (state.tokens) state.tokens.remaining -= amount;
    },
    readSnapshot() {
      prune();
      return structuredClone(state);
    },
  };
}
