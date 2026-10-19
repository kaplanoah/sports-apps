import test from "node:test";
import assert from "node:assert/strict";
import { GitHubError, createGitHub, createGraphQL, readLastPage } from "../worker/github-api.mjs";

/**
 * A fetch that answers every request with this status and body.
 * @param {number} status
 * @param {string} body
 */
const answerWith = (status, body) => async () => new Response(body, { status });

const env = { GH_TOKEN: "t0ken" };

test("a refused REST request says GitHub's status, which a caller can tell apart", async () => {
  const callGitHub = createGitHub({ repository: "o/r", fetchImpl: answerWith(422, "{}"), env });
  const error = await callGitHub("/pulls/7/comments", { method: "POST", body: {} }).catch(
    (/** @type {unknown} */ caught) => caught,
  );
  assert.ok(error instanceof GitHubError);
  assert.equal(error.status, 422);
  assert.match(error.message, /GitHub answered 422 for POST \/pulls\/7\/comments/);
});

test("a refusal counts as a limit for a 429, or a 403 with the hour used up or a wait, naming the hour's limit and reset only once it's used up, and otherwise the wait a secondary limit names", async () => {
  const reset = { "x-ratelimit-reset": "1700000000", "x-ratelimit-limit": "60" };
  /**
   * What REST and GraphQL each throw for one refusal.
   * @param {number} status
   * @param {Record<string, string>} headers
   */
  const refuseWith = async (status, headers) => {
    const fetchImpl = async () => new Response("{}", { status, headers });
    return Promise.all([
      createGitHub({ repository: "o/r", fetchImpl, env })("/pulls/7").catch((caught) => caught),
      createGraphQL({ fetchImpl, env })("query { x }", {}).catch((caught) => caught),
    ]);
  };
  /** @param {unknown} error */
  const describe = (error) => {
    assert.ok(error instanceof GitHubError);
    return [error.isLimited, error.limit, error.resetsAt?.toISOString() ?? null];
  };
  const usedUp = [true, 60, "2023-11-14T22:13:20.000Z"];
  for (const status of [403, 429])
    for (const error of await refuseWith(status, { ...reset, "x-ratelimit-remaining": "0" }))
      assert.deepEqual(describe(error), usedUp, String(status));
  for (const error of await refuseWith(429, { ...reset, "x-ratelimit-remaining": "5" }))
    assert.deepEqual(describe(error), [true, null, null], "a secondary limit that names no wait");
  for (const error of await refuseWith(403, { ...reset, "x-ratelimit-remaining": "12" }))
    assert.deepEqual(describe(error), [false, null, null]);
  for (const error of await refuseWith(403, {}))
    assert.deepEqual(describe(error), [false, null, null]);
  /** @param {Record<string, string>} headers */
  const refuseAtZero = (headers) => new GitHubError(403, "GET /pulls/7", new Headers(headers), 0);
  const secondary = { ...reset, "x-ratelimit-remaining": "5", "retry-after": "90" };
  assert.deepEqual(describe(refuseAtZero(secondary)), [true, null, "1970-01-01T00:01:30.000Z"]);
  assert.deepEqual(
    describe(refuseAtZero({ ...secondary, "x-ratelimit-remaining": "0" })),
    usedUp,
    "a wait named beside a used-up hour waits for the hour",
  );
});

test("a REST request is signed with the token when there is one, and goes unsigned without one", async () => {
  /** @type {any[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response("{}");
  };
  await createGitHub({ repository: "o/r", fetchImpl, env })("/pulls/7");
  await createGitHub({ repository: "o/r", fetchImpl, env: {} })("/pulls/7");
  assert.equal(requests[0].url, "https://api.github.com/repos/o/r/pulls/7");
  assert.equal(requests[0].init.headers.authorization, "Bearer t0ken");
  assert.ok(!("authorization" in requests[1].init.headers));
  assert.equal(requests[1].init.headers.accept, "application/vnd.github+json");
});

test("a listing's last page, where the newest of one listed oldest first are, takes one request for one page and two for several, never reading the pages between", async () => {
  /** @type {string[]} */
  const requests = [];
  /**
   * A fetch that lists this many pages of events, with the Link header GitHub sends.
   * @param {number} pageCount
   * @returns {typeof fetch}
   */
  const listPages = (pageCount) => async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    const page = Number(url.searchParams.get("page"));
    /** @param {number} to @param {string} rel */
    const linkTo = (to, rel) =>
      `<https://api.github.com/repositories/1/issues/7/events?per_page=100&page=${to}>; rel="${rel}"`;
    const link = [linkTo(page + 1, "next"), linkTo(pageCount, "last")].join(", ");
    return new Response(JSON.stringify([{ page }]), {
      headers: page < pageCount ? { link } : {},
    });
  };
  /** @param {number} pageCount */
  const readEvents = (pageCount) =>
    readLastPage(
      createGitHub({ repository: "o/r", fetchImpl: listPages(pageCount), env }),
      "/issues/7/events",
    );
  assert.deepEqual(await readEvents(1), [{ page: 1 }]);
  assert.deepEqual(requests, ["/repos/o/r/issues/7/events?per_page=100&page=1"]);
  requests.length = 0;
  assert.deepEqual(await readEvents(3), [{ page: 3 }]);
  assert.deepEqual(requests, [
    "/repos/o/r/issues/7/events?per_page=100&page=1",
    "/repos/o/r/issues/7/events?per_page=100&page=3",
  ]);
});

test("a GraphQL query's status is checked before its answer is read", async () => {
  const callGraphQL = createGraphQL({
    fetchImpl: answerWith(502, "<html>bad gateway</html>"),
    env,
  });
  await assert.rejects(callGraphQL("query { viewer { login } }", {}), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.status, 502);
    return true;
  });
});

test("a GraphQL query GitHub refuses says why, and one it answers returns its data", async () => {
  const refused = createGraphQL({
    fetchImpl: answerWith(200, '{"errors":[{"message":"Field x does not exist"}]}'),
    env,
  });
  await assert.rejects(refused("query { x }", {}), /refused the query: Field x does not exist/);
  /** @type {any[]} */
  const requests = [];
  const answered = createGraphQL({
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response('{"data":{"viewer":{"login":"o"}}}');
    },
    env,
  });
  assert.deepEqual(await answered("query { viewer { login } }", { a: 1 }), {
    viewer: { login: "o" },
  });
  assert.equal(requests[0].url, "https://api.github.com/graphql");
  assert.equal(requests[0].init.headers.authorization, "Bearer t0ken");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    query: "query { viewer { login } }",
    variables: { a: 1 },
  });
});
