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

// How deep into an answer, and how long, an error describes one without its data: enough to tell
// a refusal from a feed that has nothing to send or has changed its shape.
const SHAPE_DEPTH = 2;
const DESCRIPTION_LENGTH = 200;

/** @returns {any} the JSON `text` holds, or undefined when it isn't JSON */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Each field's name and kind, `depth` levels down, leaving out every value.
 * @param {any} value
 * @param {number} depth
 * @returns {string}
 */
function describeShape(value, depth) {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty list" : "list";
  if (typeof value !== "object") return typeof value;
  if (depth === 0) return "{...}";
  const fields = Object.entries(value).map(
    ([key, field]) => `${key}: ${describeShape(field, depth - 1)}`,
  );
  return `{${fields.join(", ")}}`;
}

const readPageTitle = (/** @type {string} */ text) =>
  /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1].replace(/\s+/g, " ").trim() ?? "";

/**
 * What came back in place of a feed's data.
 * @param {string} text
 * @param {any} answer the JSON `text` holds, or undefined
 */
function describeAnswer(text, answer) {
  if (answer !== undefined) return `JSON shaped ${describeShape(answer, SHAPE_DEPTH)}`;
  if (text.trim() === "") return "nothing";
  const title = readPageTitle(text);
  if (title) return `a web page titled "${title}"`;
  return text.trimStart().startsWith("<") ? "a web page" : "text that isn't JSON";
}

const shorten = (/** @type {string} */ text) =>
  text.length > DESCRIPTION_LENGTH ? `${text.slice(0, DESCRIPTION_LENGTH)}...` : text;

const isJson = (/** @type {any} */ answer) => answer !== undefined;

/**
 * The JSON a feed answered with, once `hasData`, by default any JSON at all, finds its data in it. A
 * feed can refuse with a web page, or have nothing to send, and still answer 200, so the error for
 * any other answer says what came back, never its values.
 * @param {Response} response
 * @param {{ feed: string, path: string, hasData?: (answer: any) => boolean }} source who answered,
 *   and for what
 */
export async function readFeedJson(response, { feed, path, hasData = isJson }) {
  const text = await response.text();
  const answer = parseJson(text);
  if (!hasData(answer))
    throw new Error(
      `${feed} answered ${path} with ${shorten(describeAnswer(text, answer))} rather than data`,
    );
  return answer;
}

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
