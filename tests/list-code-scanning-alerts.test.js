import test from "node:test";
import assert from "node:assert/strict";
import { listCodeScanningAlerts } from "../worker/list-code-scanning-alerts.mjs";

const REPOSITORY = "owner/sports-apps";
const MAIN_COMMIT = "a".repeat(40);
const EARLIER_COMMIT = "b".repeat(40);

/**
 * GitHub's API with these code-scanning alerts and analyses, newest first.
 * @param {object[]} alerts
 * @param {object[]} analyses
 */
function createFakeGitHub(alerts, analyses) {
  /** @type {URL[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    const request = new URL(String(url));
    requests.push(request);
    const listing = request.pathname.endsWith("/code-scanning/analyses") ? analyses : alerts;
    const page = Number(request.searchParams.get("page"));
    return Response.json(listing.slice((page - 1) * 100, page * 100));
  };
  return { fetchImpl, requests };
}

/**
 * @param {{ fetchImpl: typeof fetch }} github
 * @param {string} [pull]
 */
const list = (github, pull) =>
  listCodeScanningAlerts({
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token", PULL: pull },
  });

/**
 * @param {number} number
 * @param {object} [fields]
 */
const createAlert = (number, fields = {}) => ({
  number,
  state: "open",
  rule: { id: "js/xss", severity: "error", security_severity_level: "high" },
  most_recent_instance: { location: { path: "shared/page/html.js", start_line: 12 } },
  ...fields,
});

/**
 * @param {string} category
 * @param {string} commit
 * @param {string} createdAt
 */
const createAnalysis = (category, commit, createdAt) => ({
  category,
  commit_sha: commit,
  created_at: createdAt,
});

const JAVASCRIPT = "/language:javascript-typescript";

test("each alert prints on one line with its number, state, severity, rule, and place, after main's analyses", async () => {
  const github = createFakeGitHub(
    [
      createAlert(3),
      createAlert(5, {
        state: "dismissed",
        dismissed_reason: "false positive",
        rule: { id: "js/unused-local-variable", severity: "note", security_severity_level: null },
        most_recent_instance: { location: { path: "tests/a.test.js", start_line: 4 } },
      }),
      createAlert(8, { state: "fixed", most_recent_instance: {} }),
    ],
    [createAnalysis(JAVASCRIPT, MAIN_COMMIT, "today")],
  );

  assert.deepEqual(await list(github), [
    "Latest CodeQL analysis of each category on refs/heads/main (1):",
    `${JAVASCRIPT}: ${MAIN_COMMIT} at today`,
    "CodeQL alerts on refs/heads/main, in every state (3):",
    "#3 open high js/xss shared/page/html.js:12",
    "#5 dismissed/false positive note js/unused-local-variable tests/a.test.js:4",
    "#8 fixed high js/xss no location",
  ]);
});

test("a category whose latest analysis is behind main's still shows its own commit", async () => {
  const github = createFakeGitHub(
    [],
    [
      createAnalysis("/language:actions", MAIN_COMMIT, "today"),
      createAnalysis("/language:actions", EARLIER_COMMIT, "yesterday"),
      createAnalysis(JAVASCRIPT, EARLIER_COMMIT, "yesterday"),
    ],
  );

  assert.deepEqual((await list(github)).slice(0, 3), [
    "Latest CodeQL analysis of each category on refs/heads/main (2):",
    `/language:actions: ${MAIN_COMMIT} at today`,
    `${JAVASCRIPT}: ${EARLIER_COMMIT} at yesterday`,
  ]);
  for (const request of github.requests)
    assert.equal(request.searchParams.get("ref"), "refs/heads/main");
});

test("a pull request's number reads the analyses and alerts of its head instead of main's", async () => {
  const github = createFakeGitHub(
    [createAlert(3)],
    [createAnalysis(JAVASCRIPT, MAIN_COMMIT, "today")],
  );

  assert.deepEqual(await list(github, "42"), [
    "Latest CodeQL analysis of each category on refs/pull/42/head (1):",
    `${JAVASCRIPT}: ${MAIN_COMMIT} at today`,
    "CodeQL alerts on refs/pull/42/head, in every state (1):",
    "#3 open high js/xss shared/page/html.js:12",
  ]);
  assert.equal(github.requests.length, 2);
  for (const request of github.requests)
    assert.equal(request.searchParams.get("ref"), "refs/pull/42/head");
});

test("an empty pull request input, as the workflow sends when none is given, reads main's", async () => {
  const github = createFakeGitHub(
    [createAlert(3)],
    [createAnalysis(JAVASCRIPT, MAIN_COMMIT, "today")],
  );

  assert.deepEqual(await list(github, ""), [
    "Latest CodeQL analysis of each category on refs/heads/main (1):",
    `${JAVASCRIPT}: ${MAIN_COMMIT} at today`,
    "CodeQL alerts on refs/heads/main, in every state (1):",
    "#3 open high js/xss shared/page/html.js:12",
  ]);
  assert.equal(github.requests.length, 2);
  for (const request of github.requests)
    assert.equal(request.searchParams.get("ref"), "refs/heads/main");
});

test("a pull request input that is not a number reads nothing", async () => {
  const github = createFakeGitHub([], []);

  for (const pull of ["main", "42&ref=refs/heads/beta", "0", "-1"])
    await assert.rejects(list(github, pull), /is not a pull request's number/);
  assert.equal(github.requests.length, 0);
});

test("a category analyzed last before main's newest page of analyses still shows", async () => {
  const github = createFakeGitHub(
    [],
    [
      ...Array.from({ length: 100 }, () =>
        createAnalysis("/language:actions", MAIN_COMMIT, "today"),
      ),
      createAnalysis(JAVASCRIPT, EARLIER_COMMIT, "last month"),
    ],
  );

  assert.deepEqual((await list(github)).slice(0, 3), [
    "Latest CodeQL analysis of each category on refs/heads/main (2):",
    `/language:actions: ${MAIN_COMMIT} at today`,
    `${JAVASCRIPT}: ${EARLIER_COMMIT} at last month`,
  ]);
});

// Another scanner's alerts may come from queries or code the public can't see.
test("only CodeQL's analyses and alerts are read, every page of alerts in every state", async () => {
  const alerts = Array.from({ length: 150 }, (_, index) => createAlert(index + 1));
  const github = createFakeGitHub(alerts, []);

  const lines = await list(github);

  assert.equal(lines.length, 152);
  assert.equal(lines.at(-1), "#150 open high js/xss shared/page/html.js:12");
  assert.equal(github.requests.length, 3);
  for (const request of github.requests) {
    assert.equal(request.searchParams.get("tool_name"), "CodeQL");
    assert.equal(request.searchParams.get("state"), null);
  }
});
