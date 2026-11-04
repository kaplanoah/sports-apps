import test from "node:test";
import assert from "node:assert/strict";
import { listCodeScanningAlerts } from "../worker/list-code-scanning-alerts.mjs";

const REPOSITORY = "owner/sports-apps";
const MAIN_COMMIT = "a".repeat(40);

/**
 * GitHub's API with these code-scanning alerts and analyses of main.
 * @param {object[]} alerts
 * @param {object[]} [analyses]
 */
function createFakeGitHub(alerts, analyses = [{ commit_sha: MAIN_COMMIT, created_at: "now" }]) {
  /** @type {string[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url) => {
    const { pathname, search } = new URL(String(url));
    requests.push(`${pathname}${search}`);
    if (pathname.endsWith("/code-scanning/analyses")) return Response.json(analyses);
    const page = Number(new URLSearchParams(search).get("page"));
    return Response.json(alerts.slice((page - 1) * 100, page * 100));
  };
  return { fetchImpl, requests };
}

const list = (github) =>
  listCodeScanningAlerts({
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
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

test("each alert prints on one line with its number, state, severity, rule, and place, after main's analysis", async () => {
  const github = createFakeGitHub([
    createAlert(3),
    createAlert(5, {
      state: "dismissed",
      dismissed_reason: "false positive",
      rule: { id: "js/unused-local-variable", severity: "note", security_severity_level: null },
      most_recent_instance: { location: { path: "tests/a.test.js", start_line: 4 } },
    }),
    createAlert(8, { state: "fixed", most_recent_instance: {} }),
  ]);

  assert.deepEqual(await list(github), [
    `Main's latest analysis: ${MAIN_COMMIT} at now`,
    "Alerts, in every state (3):",
    "#3 open high js/xss shared/page/html.js:12",
    "#5 dismissed/false positive note js/unused-local-variable tests/a.test.js:4",
    "#8 fixed high js/xss no location",
  ]);
  assert.equal(
    github.requests[0],
    `/repos/${REPOSITORY}/code-scanning/analyses?ref=refs/heads/main&per_page=1`,
  );
});

test("every page of alerts is read, in every state", async () => {
  const alerts = Array.from({ length: 150 }, (_, index) => createAlert(index + 1));
  const github = createFakeGitHub(alerts);

  const lines = await list(github);

  assert.equal(lines.length, 152);
  assert.equal(lines.at(-1), "#150 open high js/xss shared/page/html.js:12");
  const alertRequests = github.requests.filter((request) => request.includes("/alerts"));
  assert.equal(alertRequests.length, 2);
  for (const request of alertRequests) assert.doesNotMatch(request, /state=/);
});

test("with no analysis of main yet, it says so", async () => {
  const github = createFakeGitHub([], []);

  assert.deepEqual(await list(github), [
    "Main has no analysis yet.",
    "Alerts, in every state (0):",
  ]);
});
