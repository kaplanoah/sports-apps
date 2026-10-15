// The Worker's health, for an uptime monitor. It answers without the page's key, so the monitor
// holds no secret, and says only whether the Worker and its store answer. It asks the store once a
// minute at most, however often it's hit, so a flood of requests costs the store no more than the
// monitor does.
import { abortAfter } from "./timeout.js";
import { createReusedLoader } from "./upstream.js";

export const HEALTH_REUSE_MS = 60 * 1000;
export const STORE_TIMEOUT_MS = 5000;

const HEALTH_HEADERS = {
  "content-type": "application/json",
  "cache-control": `public, max-age=${HEALTH_REUSE_MS / 1000}`,
  "x-robots-tag": "noindex, nofollow",
};

/**
 * Settles as `ask` does, or rejects once `signal` aborts, whichever comes first, since a call to
 * the store ignores the signal.
 * @template Result
 * @param {AbortSignal} signal
 * @param {() => Promise<Result>} ask
 * @returns {Promise<Result>}
 */
const giveUpOnAbort = (signal, ask) =>
  new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    ask().then(resolve, reject);
  });

/**
 * @param {object} options
 * @param {(env: any) => Promise<boolean>} options.isStoreAnswering
 * @param {string | null} options.release the commit the Worker was built from
 * @param {() => number} [options.now]
 */
export function createHealthServer({ isStoreAnswering, release, now = Date.now }) {
  const askStore = (env) =>
    abortAfter(STORE_TIMEOUT_MS, (signal) =>
      giveUpOnAbort(signal, () => isStoreAnswering(env)),
    ).catch(() => false);
  const checkStore = createReusedLoader(askStore, HEALTH_REUSE_MS, now);

  /** @param {any} env the Worker's bindings */
  return async function serveHealth(env) {
    const isAnswering = await checkStore(env);
    const health = { ok: isAnswering, release, store: isAnswering ? "ok" : "no answer" };
    return new Response(JSON.stringify(health), {
      status: isAnswering ? 200 : 503,
      headers: HEALTH_HEADERS,
    });
  };
}
