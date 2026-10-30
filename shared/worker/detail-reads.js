import { createReusedLoader } from "./upstream.js";
import { respondError, respondJson } from "./responses.js";

// A store's detail reads share work and retain usable answers across object restarts.

/**
 * @param {Record<string, (url: URL) => Promise<Response>>} reads
 * @param {{ storage: { get: (key: string) => Promise<any>, put: (key: string, value: any) => Promise<void> }, now: () => number }} context
 */
export function createDetailReads(reads, { storage, now }) {
  const load = createReusedLoader(
    async (key) => {
      const url = new URL(key, "https://store");
      const response = await reads[url.pathname](url);
      if (!response.ok) throw response;
      const body = await response.json();
      await storage.put(`detail-answer:${key}`, body);
      return body;
    },
    5000,
    now,
  );

  /** @param {URL} url */
  return async function readDetail(url) {
    if (!Object.hasOwn(reads, url.pathname)) return null;
    url.searchParams.sort();
    const key = url.pathname + url.search;
    try {
      return respondJson(await load(key));
    } catch (error) {
      if (error instanceof Response && error.status < 500) return error.clone();
      const kept = await storage.get(`detail-answer:${key}`);
      if (kept) return respondJson(kept);
      return error instanceof Response
        ? error.clone()
        : respondError(502, "upstream_error", "Couldn't read the stored details. Try again.");
    }
  };
}
