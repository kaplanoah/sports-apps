import { setTimeout as delay } from "node:timers/promises";

const requireCount = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}.`);
  return value;
};

/** @param {Headers} headers @param {number} now */
export function parseRetryAfter(headers, now) {
  const value = headers.get("retry-after");
  if (value !== null) {
    if (/^\d+$/.test(value)) return now + Number(value) * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date) && date >= now) return date;
  }
  const milliseconds = headers.get("retry-after-ms");
  return milliseconds !== null && /^\d+$/.test(milliseconds) ? now + Number(milliseconds) : null;
}

/** @param {string | null} value @param {number} now */
export function parseReset(value, now) {
  if (value === null) return null;
  let total = 0;
  let end = 0;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    if (match.index !== end) return null;
    total += Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
    end += match[0].length;
  }
  return end === value.length && end > 0 && Number.isSafeInteger(Math.ceil(total))
    ? now + Math.ceil(total)
    : null;
}

/** @param {any} policy @param {any} [options] */
export function createRateBudget(
  policy,
  {
    now = Date.now,
    wait = (ms, signal) => delay(ms, undefined, { signal }),
    admit = () => ({ admitted: true }),
  } = {},
) {
  const tokenLimit = requireCount(policy.tokens, "token limit");
  const requestLimit = requireCount(policy.requests, "request limit");
  const window = requireCount(policy.windowMs, "window");
  const spacing = requireCount(policy.spacingMs ?? 0, "spacing");
  const maxWait = requireCount(policy.maxWaitMs ?? window * 2, "wait budget");
  if (!tokenLimit || !requestLimit || !window) throw new Error("Rate limits must be positive.");
  const events = [];
  const changed = new Set();
  let sequence = 0;
  let blockedUntil = 0;
  let nextStart = 0;
  let pending = Promise.resolve();

  const wake = () => {
    for (const notify of changed) notify();
    changed.clear();
  };
  const prune = (time) => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].expires <= time && events[i].settled) events.splice(i, 1);
    }
  };
  async function waitForChange(ms, signal) {
    const controller = new AbortController();
    let notify;
    const abort = () => {
      controller.abort();
      notify();
    };
    const change = new Promise((resolve) => {
      notify = resolve;
      changed.add(resolve);
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await Promise.race([wait(ms, controller.signal), change]);
    } finally {
      controller.abort();
      changed.delete(notify);
      signal?.removeEventListener("abort", abort);
    }
  }
  async function reserveNow(tokens, signal, deadline) {
    requireCount(tokens, "reservation");
    if (tokens > tokenLimit)
      throw new Error("Request reservation exceeds the configured token limit.");
    for (;;) {
      if (signal?.aborted) throw new Error("Rate admission aborted.");
      const time = now();
      if (time > deadline) throw new Error("Rate admission wait budget exhausted.");
      prune(time);
      const used = events.reduce((sum, event) => sum + event.charge, 0);
      const slots = events.length;
      let providerUntil = 0;
      if (
        time >= blockedUntil &&
        time >= nextStart &&
        used + tokens <= tokenLimit &&
        slots < requestLimit
      ) {
        const provider = admit(tokens);
        if (provider.admitted === true) {
          const event = {
            id: ++sequence,
            charge: tokens,
            observed: null,
            settled: false,
            expires: time + window,
          };
          events.push(event);
          nextStart = time + spacing;
          return event.id;
        }
        providerUntil = requireCount(provider.notBefore, "provider admission deadline");
      }
      const expires = events.filter((event) => event.settled).map((event) => event.expires);
      const due = Math.max(
        time + 1,
        blockedUntil,
        providerUntil,
        nextStart,
        used + tokens > tokenLimit || slots >= requestLimit ? Math.min(...expires, deadline) : time,
      );
      if (due > deadline || time >= deadline)
        throw new Error("Rate admission wait budget exhausted.");
      await waitForChange(due - time, signal);
    }
  }
  return {
    async reserve(tokens, signal) {
      if (signal?.aborted) throw new Error("Rate admission aborted.");
      const deadline = now() + maxWait;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const cancellation = new Promise((resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("Rate admission aborted.")),
          { once: true },
        );
      });
      const admission = pending.then(() => reserveNow(tokens, controller.signal, deadline));
      pending = admission.then(
        () => undefined,
        () => undefined,
      );
      try {
        return await Promise.race([admission, cancellation]);
      } finally {
        controller.abort();
        signal?.removeEventListener("abort", abort);
      }
    },
    settle(id, observedTokens) {
      const event = events.find((event) => event.id === id);
      if (!event || event.settled) throw new Error("Unknown or completed reservation.");
      if (observedTokens !== null) {
        event.charge = requireCount(observedTokens, "observed usage");
        event.observed = observedTokens;
      }
      event.settled = true;
      event.expires = now() + window;
      wake();
    },
    defer(until) {
      requireCount(until, "retry deadline");
      blockedUntil = Math.max(blockedUntil, until);
      wake();
    },
    readSnapshot() {
      prune(now());
      return {
        tokenLimit,
        requestLimit,
        windowMs: window,
        blockedUntil,
        events: events.map((event) => ({ ...event })),
      };
    },
  };
}
