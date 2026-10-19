// Calls GitHub's REST API for one repository, and its GraphQL API, as the tooling's scripts that
// read and write its pull requests and issues do.

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10000;
const PAGE_SIZE = 100;

/**
 * Whether GitHub refused an answer for a limit on requests: a 429, or a 403 with none left or a
 * wait to keep, as for a secondary limit, rather than for a permission.
 * @param {number} status
 * @param {Headers | undefined} headers
 */
const isLimitRefusal = (status, headers) =>
  status === 429 ||
  (status === 403 &&
    (headers?.get("x-ratelimit-remaining") === "0" || Boolean(headers?.has("retry-after"))));

/**
 * When a limit GitHub refused an answer for lets requests through again, from the wait it names or
 * the time its limit resets, or null when it names neither.
 * @param {Headers | undefined} headers
 * @param {number} now
 */
function readLimitEnd(headers, now) {
  const wait = Number(headers?.get("retry-after"));
  if (wait > 0) return new Date(now + wait * 1000);
  const reset = Number(headers?.get("x-ratelimit-reset"));
  return reset > 0 ? new Date(reset * 1000) : null;
}

/**
 * An answer GitHub refused, with the status it answered, and, for one it refused for a limit on
 * requests, the limit and when it lets requests through again.
 */
export class GitHubError extends Error {
  /**
   * @param {number} status
   * @param {string} request
   * @param {Headers} [headers] the answer's
   * @param {number} [now] when it answered
   */
  constructor(status, request, headers, now = Date.now()) {
    super(`GitHub answered ${status} for ${request}`);
    this.status = status;
    this.isLimited = isLimitRefusal(status, headers);
    const limit = Number(headers?.get("x-ratelimit-limit"));
    /** @type {number | null} requests an hour */
    this.limit = this.isLimited && limit > 0 ? limit : null;
    /** @type {Date | null} */
    this.resetsAt = this.isLimited ? readLimitEnd(headers, now) : null;
  }
}

// With no token, as in a cloud session, a read of the public repo goes unsigned, within GitHub's
// limit for an address.
/** @param {NodeJS.ProcessEnv} env */
const writeHeaders = (env) => ({
  accept: "application/vnd.github+json",
  ...(env.GH_TOKEN ? { authorization: `Bearer ${env.GH_TOKEN}` } : {}),
  "x-github-api-version": "2022-11-28",
});

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 */
export function createGitHub({ repository, fetchImpl, env }) {
  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown }} [request]
   */
  return async (path, { method = "GET", body } = {}) => {
    const response = await fetchImpl(`${API}/repos/${repository}${path}`, {
      method,
      headers: { ...writeHeaders(env), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new GitHubError(response.status, `${method} ${path}`, response.headers);
    return response.json();
  };
}

/**
 * Calls GitHub's GraphQL API, for what its REST API doesn't say, like whether a review thread is
 * resolved.
 * @param {object} options
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 */
export function createGraphQL({ fetchImpl, env }) {
  /**
   * @param {string} query
   * @param {Record<string, unknown>} variables
   */
  return async (query, variables) => {
    const response = await fetchImpl(`${API}/graphql`, {
      method: "POST",
      headers: { ...writeHeaders(env), "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new GitHubError(response.status, "a GraphQL query", response.headers);
    const answer = await response.json();
    if (answer.errors?.length)
      throw new Error(`GitHub's GraphQL API refused the query: ${answer.errors[0].message}`);
    return answer.data;
  };
}

/**
 * Every page of a listing, in order.
 * @param {(path: string) => Promise<any[]>} readJson
 * @param {string} path
 */
export async function readAllPages(readJson, path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = await readJson(
      `${path}${path.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`,
    );
    items.push(...batch);
    if (batch.length < PAGE_SIZE) return items;
  }
}
