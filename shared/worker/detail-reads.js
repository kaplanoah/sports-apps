import { isSameJson } from "../page/compare.js";
import { createReusedLoader } from "./upstream.js";
import { respondError, respondJson } from "./responses.js";

export const DETAIL_REUSE_MS = 5000;
export const DETAIL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DETAIL_ANSWERS = 100;
const ANSWER_PREFIX = "detail-answer:";

/**
 * @typedef {object} DetailRead
 * @property {string[]} parameters the parameters this service reads
 * @property {(services: any, url: URL) => Promise<Response>} read
 * @property {(url: URL) => string} [nameKey] the canonical document path
 * @property {string} [field] the answer's field inside its canonical document
 */

/**
 * Store-owned reads share work, prefer canonical documents on failures, and retain a bounded
 * cache for answers that have no canonical document.
 * @param {Record<string, DetailRead>} reads
 * @param {{ storage: import("./season-store.js").JobContext["storage"], now: () => number, docs: import("./season-store.js").SeasonDocuments, services: any }} context
 */
export function createDetailReads(reads, { storage, now, docs, services }) {
  let saving = Promise.resolve();

  async function keepAnswer(key, body) {
    saving = saving
      .catch(() => {})
      .then(async () => {
        const entries = await storage.list(ANSWER_PREFIX);
        entries.delete(ANSWER_PREFIX + key);
        const retained = [...entries].filter(([, value]) => now() - value.at < DETAIL_RETENTION_MS);
        retained.sort(([, first], [, second]) => second.at - first.at);
        const keep = new Set(retained.slice(0, MAX_DETAIL_ANSWERS - 1).map(([entry]) => entry));
        for (const entry of entries.keys()) if (!keep.has(entry)) await storage.delete(entry);
        await storage.put(ANSWER_PREFIX + key, { at: now(), body });
      });
    return saving;
  }

  const load = createReusedLoader(
    async (key) => {
      const url = new URL(key, "https://store");
      const service = reads[url.pathname];
      const canonicalKey = service.nameKey?.(url);
      const before = canonicalKey ? await docs.read(canonicalKey) : null;
      const response = await service.read(services, url);
      if (!response.ok) throw response;
      let body = await response.json();
      if (canonicalKey) {
        await docs.update(canonicalKey, (stored) => {
          const previous = service.field ? before?.[service.field] : before;
          const current = service.field ? stored?.[service.field] : stored;
          if (!isSameJson(previous, current)) {
            body = current ?? body;
            return null;
          }
          const answer = service.field ? { ...stored, [service.field]: body } : body;
          return isSameJson(stored, answer) ? null : answer;
        });
      } else await keepAnswer(url.pathname + url.search, body);
      return body;
    },
    DETAIL_REUSE_MS,
    now,
  );

  /** @param {URL} asked */
  return async function readDetail(asked) {
    const service = reads[asked.pathname];
    if (!service) return null;
    const url = new URL(asked.pathname, "https://store");
    for (const parameter of service.parameters) {
      if (asked.searchParams.has(parameter))
        url.searchParams.set(parameter, asked.searchParams.get(parameter));
    }
    url.searchParams.sort();
    const key = url.pathname + url.search;
    try {
      return respondJson(await load(key));
    } catch (error) {
      if (error instanceof Response && error.status < 500 && ![404, 409].includes(error.status))
        return error.clone();
      if (service.nameKey) {
        const stored = await docs.read(service.nameKey(url));
        const kept = service.field ? stored?.[service.field] : stored;
        if (kept) return respondJson(kept);
      } else {
        const cached = await storage.get(ANSWER_PREFIX + key);
        if (cached && now() - cached.at < DETAIL_RETENTION_MS) return respondJson(cached.body);
        if (cached) await storage.delete(ANSWER_PREFIX + key);
      }
      return error instanceof Response
        ? error.clone()
        : respondError(502, "upstream_error", "Couldn't read the stored details. Try again.");
    }
  };
}

/**
 * @param {Record<string, unknown>} reads
 * @param {(request: Request, env: any, path: string) => Promise<Response>} forwardToStore
 */
export const createDetailForwards = (reads, forwardToStore) =>
  Object.fromEntries(
    Object.keys(reads).map((path) => [
      path,
      (url, env) => forwardToStore(new Request(url), env, path),
    ]),
  );
