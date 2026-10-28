import { setTimeout as delay } from "node:timers/promises";
import { createRateBudget } from "./codex-rate-budget.mjs";
import { createProviderFeedback } from "./codex-rate-estimate.mjs";

/** @param {any} policy @param {any} [options] */
export function createAdmissionController(
  policy,
  { now = Date.now, wait = (ms, signal) => delay(ms, undefined, { signal }), notBefore = 0 } = {},
) {
  const budget = createRateBudget(policy, { now, wait });
  const feedback = createProviderFeedback(
    { ...policy, headroom: policy.feedbackHeadroom ?? 0.2 },
    now,
  );
  const reservations = new Map();
  let failure = false;
  budget.defer(notBefore);
  return {
    async reserve(amount, signal) {
      if (failure) throw new Error("Provider budget feedback is unavailable or malformed.");
      const deadline = now() + (policy.maxWaitMs ?? policy.windowMs * 2);
      const ticket = await budget.reserve(amount, signal);
      try {
        for (;;) {
          if (signal?.aborted) throw new Error("Admission aborted.");
          if (failure) throw new Error("Provider budget feedback is unavailable or malformed.");
          const result = feedback.reserve(amount);
          if (result.admitted) {
            reservations.set(ticket, amount);
            return ticket;
          }
          if (result.notBefore > deadline || now() >= deadline)
            throw new Error("Provider budget wait exhausted.");
          await wait(Math.max(1, result.notBefore - now()), signal);
        }
      } catch (error) {
        budget.settle(ticket, null);
        throw error;
      }
    },
    settle(ticket, observed) {
      const reserved = reservations.get(ticket);
      if (reserved === undefined) throw new Error("Unknown admitted request.");
      if (observed !== null && observed > reserved) feedback.debitExtra(observed - reserved);
      budget.settle(ticket, observed);
      reservations.delete(ticket);
    },
    defer(until) {
      budget.defer(until);
    },
    observeHeaders(headers) {
      try {
        feedback.observe(headers);
      } catch {
        failure = true;
      }
    },
    readSnapshot() {
      return {
        local: budget.readSnapshot(),
        provider: feedback.readSnapshot(),
        feedbackFailed: failure,
      };
    },
  };
}
