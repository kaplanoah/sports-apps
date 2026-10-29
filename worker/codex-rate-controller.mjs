import { setTimeout as delay } from "node:timers/promises";
import { createRateBudget } from "./codex-rate-budget.mjs";
import { createProviderFeedback } from "./codex-rate-estimate.mjs";

/** @param {any} policy @param {any} [options] */
export function createAdmissionController(
  policy,
  { now = Date.now, wait = (ms, signal) => delay(ms, undefined, { signal }), notBefore = 0 } = {},
) {
  const feedback = createProviderFeedback({ ...policy, headroom: policy.feedbackHeadroom }, now);
  const reservations = new Map();
  let failure = false;
  const budget = createRateBudget(policy, {
    now,
    wait,
    admit(amount) {
      if (failure) throw new Error("Provider budget feedback is unavailable or malformed.");
      return feedback.reserve(amount);
    },
  });
  budget.defer(notBefore);
  return {
    async reserve(amount, signal) {
      if (failure) throw new Error("Provider budget feedback is unavailable or malformed.");
      const ticket = await budget.reserve(amount, signal);
      reservations.set(ticket, amount);
      return ticket;
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
