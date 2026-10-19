// Calls GitHub's REST API for one repository, and its GraphQL API, as the tooling's scripts that
// read and write its pull requests and issues do.

const API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10000;
const PAGE_SIZE = 100;

/**
 * Whether an answer says the hour's requests are all used up, which GitHub names on every answer
 * with how many are left.
 * @param {Headers | undefined} headers
 */
const isHourUsedUp = (headers) => headers?.get("x-ratelimit-remaining") === "0";

/**
 * Whether GitHub refused an answer for a limit on requests: a 429, or a 403 with the hour's used
 * up or a wait to keep, as for a secondary limit, rather than for a permission.
 * @param {number} status
 * @param {Headers | undefined} headers
 */
const isLimitRefusal = (status, headers) =>
  status === 429 ||
  (status === 403 && (isHourUsedUp(headers) || Boolean(headers?.has("retry-after"))));

/**
 * When a limit GitHub refused an answer for lets requests through again: the hour's reset once
 * they're all used up, or else the wait a secondary limit names, or null when it names none.
 * @param {Headers | undefined} headers
 * @param {number} now
 */
function readLimitEnd(headers, now) {
  if (isHourUsedUp(headers)) {
    const reset = Number(headers?.get("x-ratelimit-reset"));
    return reset > 0 ? new Date(reset * 1000) : null;
  }
  const wait = Number(headers?.get("retry-after"));
  return wait > 0 ? new Date(now + wait * 1000) : null;
}

/**
 * An answer GitHub refused, with the status it answered, and, for one it refused for a limit on
 * requests, the hour's limit once it's used up, and when it lets requests through again.
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
    this.limit = this.isLimited && isHourUsedUp(headers) && limit > 0 ? limit : null;
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
   * @param {{ method?: string, body?: unknown, withLastPage?: boolean }} [request] withLastPage
   *   answers { answer, lastPage }, with the number of the listing's last page from the Link
   *   header, or null when the answer is its only page
   */
  return async (path, { method = "GET", body, withLastPage = false } = {}) => {
    const response = await fetchImpl(`${API}/repos/${repository}${path}`, {
      method,
      headers: { ...writeHeaders(env), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new GitHubError(response.status, `${method} ${path}`, response.headers);
    const answer = await response.json();
    if (!withLastPage) return answer;
    return { answer, lastPage: readLastPageNumber(response.headers.get("link")) };
  };
}

/**
 * The number of the last page a Link header names, or null when it names none.
 * @param {string | null} link
 */
function readLastPageNumber(link) {
  const last = link?.split(",").find((part) => /rel="last"/.test(part));
  const page = last?.match(/<([^>]+)>/)?.[1];
  return page ? Number(new URL(page).searchParams.get("page")) : null;
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

/** @param {string} path @param {number} page */
const addPage = (path, page) =>
  `${path}${path.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`;

/**
 * The last page of a listing, which holds the newest of one listed oldest first, in one request
 * when the listing fits one page, and two otherwise.
 * @param {(path: string, request?: { withLastPage?: boolean }) => Promise<any>} readJson
 * @param {string} path
 */
export async function readLastPage(readJson, path) {
  const { answer, lastPage } = await readJson(addPage(path, 1), { withLastPage: true });
  return lastPage ? readJson(addPage(path, lastPage)) : answer;
}

/**
 * Every page of a listing, in order.
 * @param {(path: string) => Promise<any>} readJson
 * @param {string} path
 * @param {(answer: any) => any[]} [pickItems] the listing's items from a page's answer, for a
 *   listing that wraps them, as a run's jobs are in { jobs }
 */
export async function readAllPages(readJson, path, pickItems = (answer) => answer) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const batch = pickItems(await readJson(addPage(path, page)));
    items.push(...batch);
    if (batch.length < PAGE_SIZE) return items;
  }
}
