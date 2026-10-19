// Calls GitHub's REST API for one repository, and its GraphQL API, as the tooling's scripts that
// read and write its pull requests and issues do.

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10000;
const PAGE_SIZE = 100;

/** An answer GitHub refused, with the status it answered and when a used-up limit resets. */
export class GitHubError extends Error {
  /**
   * @param {number} status
   * @param {string} request
   * @param {Headers} [headers] the answer's
   */
  constructor(status, request, headers) {
    super(`GitHub answered ${status} for ${request}`);
    this.status = status;
    const reset = Number(headers?.get("x-ratelimit-reset"));
    /** @type {Date | null} */
    this.resetsAt = reset > 0 ? new Date(reset * 1000) : null;
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
