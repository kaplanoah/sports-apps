import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubError,
  createGitHub,
  createGitHubRoot,
  createGraphQL,
  findInPages,
  readAllPages,
} from "../worker/github-api.mjs";

/**
 * A fetch that answers every request with this status and body.
 * @param {number} status
 * @param {string} body
 */
const answerWith = (status, body) => async () => new Response(body, { status });

const env = { GH_TOKEN: "t0ken" };

test("API-root metadata shares REST authentication, version, timeout and sanitized errors", async () => {
  const requests = [];
  const readRoot = createGitHubRoot({
    env,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response('{"total_count":1,"repositories":[]}');
    },
  });
  assert.deepEqual(await readRoot("/installation/repositories?per_page=100"), {
    total_count: 1,
    repositories: [],
  });
  assert.equal(requests[0].url, "https://api.github.com/installation/repositories?per_page=100");
  assert.equal(requests[0].init.headers.authorization, "Bearer t0ken");
  assert.equal(requests[0].init.headers["x-github-api-version"], "2022-11-28");
  assert.ok(requests[0].init.signal instanceof AbortSignal);
  const denied = createGitHubRoot({ env, fetchImpl: answerWith(403, "untrusted response body") });
  await assert.rejects(denied("/installation/repositories"), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.status, 403);
    assert.doesNotMatch(error.message, /untrusted response body|t0ken/);
    return true;
  });
});

test("a refused REST request says GitHub's status, which a caller can tell apart", async () => {
  const callGitHub = createGitHub({ repository: "o/r", fetchImpl: answerWith(422, "{}"), env });
  const error = await callGitHub("/pulls/7/comments", { method: "POST", body: {} }).catch(
    (/** @type {unknown} */ caught) => caught,
  );
  assert.ok(error instanceof GitHubError);
  assert.equal(error.status, 422);
  assert.match(error.message, /GitHub answered 422 for POST \/pulls\/7\/comments/);
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

/** @param {any[][]} pages */
function createListing(pages) {
  const requested = [];
  const readJson = async (path) => {
    requested.push(path);
    const url = new URL(path, "https://api.github.com");
    assert.equal(url.searchParams.get("per_page"), "100");
    return pages[Number(url.searchParams.get("page")) - 1];
  };
  return { readJson, requested };
}

test("complete listings keep query parameters and wrapper selection across pages", async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({ id }));
  const listing = createListing([first, [{ id: 100 }]]);
  const readJson = async (path) => ({ items: await listing.readJson(path) });
  const all = await readAllPages(readJson, "/issues?state=closed", (answer) => answer.items);
  assert.deepEqual(all, [...first, { id: 100 }]);
  assert.deepEqual(listing.requested, [
    "/issues?state=closed&per_page=100&page=1",
    "/issues?state=closed&per_page=100&page=2",
  ]);
});

test("matching a paginated item stops without reading later pages and missing matches return undefined", async () => {
  const first = Array.from({ length: 100 }, (_, id) => ({ id }));
  for (const [id, pages] of [
    [50, 1],
    [100, 2],
    [101, 2],
  ]) {
    const listing = createListing([first, [{ id: 100 }]]);
    const found = await findInPages(listing.readJson, "/issues", (item) => item.id === id);
    assert.deepEqual(found, id === 101 ? undefined : { id });
    assert.equal(listing.requested.length, pages);
  }
});

test("failed pages propagate from both complete and early-stop listings", async () => {
  const readJson = async () => {
    throw new Error("listing unavailable");
  };
  await assert.rejects(readAllPages(readJson, "/issues"), /listing unavailable/);
  await assert.rejects(
    findInPages(readJson, "/issues", () => true),
    /listing unavailable/,
  );
});
