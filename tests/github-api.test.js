import test from "node:test";
import assert from "node:assert/strict";
import { GitHubError, createGitHub, createGraphQL } from "../worker/github-api.mjs";

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

test("a refusal says when the limit it ran into resets, or nothing when GitHub doesn't say", async () => {
  /** @param {Record<string, string>} headers */
  const refuseWith = (headers) =>
    createGitHub({
      repository: "o/r",
      fetchImpl: async () => new Response("{}", { status: 403, headers }),
      env,
    })("/pulls/7").catch((/** @type {unknown} */ caught) => caught);
  const limited = await refuseWith({ "x-ratelimit-reset": "1700000000" });
  assert.ok(limited instanceof GitHubError);
  assert.equal(limited.resetsAt?.toISOString(), "2023-11-14T22:13:20.000Z");
  const unsaid = await refuseWith({});
  assert.ok(unsaid instanceof GitHubError);
  assert.equal(unsaid.resetsAt, null);
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
