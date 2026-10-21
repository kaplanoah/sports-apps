import { abortAfter } from "./timeout.js";

// Reading a league's own feeds, which every app's Worker does the same way, and reusing a recent
// load.

export const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * Asks a feed for `url` and reads its whole answer, giving up after UPSTREAM_TIMEOUT_MS, and
 * letting Cloudflare's edge keep the answer for `cacheSeconds`, or not at all when it's null.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 * @param {string} url
 * @param {{ headers: Record<string, string>, cacheSeconds: number | null }} options
 * @returns {Promise<Response>}
 */
export const fetchUpstream = (fetchImpl, url, { headers, cacheSeconds }) =>
  abortAfter(UPSTREAM_TIMEOUT_MS, async (signal) => {
    const response = await fetchImpl(url, {
      headers,
      signal,
      ...(cacheSeconds !== null && { cf: { cacheTtl: cacheSeconds, cacheEverything: true } }),
    });
    const body = response.body ? await response.arrayBuffer() : null;
    return new Response(body, response);
  });

/**
 * `load`, except that a call for a key loaded in the last `reuseMs`, or still loading, gets that
 * load's promise. A load that fails is forgotten, so the next call tries again.
 * @template Key, Value
 * @param {(key: Key, requestedAt: number) => Promise<Value>} load
 * @param {number} reuseMs
 * @param {() => number} now
 * @returns {(key: Key) => Promise<Value>}
 */
export function createReusedLoader(load, reuseMs, now) {
  const recentLoads = new Map();
  return (key) => {
    const requestedAt = now();
    const recent = recentLoads.get(key);
    if (recent && requestedAt - recent.at < reuseMs) return recent.promise;
    const promise = load(key, requestedAt);
    recentLoads.set(key, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentLoads.get(key)?.promise === promise) recentLoads.delete(key);
    });
    return promise;
  };
}
