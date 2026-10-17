import test from "node:test";
import assert from "node:assert/strict";
import { nameOutageIssue, watchApps } from "../worker/watch-apps.mjs";

const REPOSITORY = "owner/sports-apps";
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const API = `https://api.github.com/repos/${REPOSITORY}`;

/**
 * GitHub with `openIssues` open, recording each call that writes.
 * @param {any[]} openIssues
 */
function createFakeGitHub(openIssues) {
  const writes = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace(API, "");
    const method = init.method ?? "GET";
    if (method === "GET") return Response.json(path.startsWith("/issues?") ? openIssues : []);
    writes.push({ method, path, body: JSON.parse(String(init.body)) });
    return Response.json({ number: 7 });
  };
  return { fetchImpl, writes };
}

/**
 * @param {Record<string, import("../worker/check-page.mjs").PageCheck>} checks by app
 * @param {any[]} [openIssues]
 */
async function watch(checks, openIssues = []) {
  const github = createFakeGitHub(openIssues);
  const lines = await watchApps({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    apps: Object.keys(checks),
    checkApp: async (app) => checks[app],
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return { lines, writes: github.writes };
}

/** @type {import("../worker/check-page.mjs").PageCheck} */
const BROKEN = { status: "broken", reason: "the page drew nothing within 30 seconds" };

test("an app that isn't opening gets one issue, saying why and linking the run", async () => {
  const { lines, writes } = await watch({ wnba: BROKEN, mlb: { status: "drawn" } });

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues",
      body: {
        title: "The WNBA app isn't opening",
        body: `Opened twice a minute apart, the page drew nothing within 30 seconds.\n\nSee [the check's run](${RUN_URL}). This issue closes itself once the app opens again.`,
      },
    },
  ]);
  assert.deepEqual(lines, [
    "wnba: not opening, the page drew nothing within 30 seconds; opened #7",
    "mlb: opens",
  ]);
});

test("an app still not opening leaves its open issue as it is", async () => {
  const open = { number: 3, title: nameOutageIssue("wnba") };

  const { lines, writes } = await watch({ wnba: BROKEN }, [open]);

  assert.deepEqual(writes, []);
  assert.deepEqual(lines, [
    "wnba: still not opening, the page drew nothing within 30 seconds; #3 is open",
  ]);
});

test("an app that opens again says so on its issue and closes it", async () => {
  const pullRequest = { number: 2, title: nameOutageIssue("wnba"), pull_request: {} };
  const open = { number: 3, title: nameOutageIssue("wnba") };

  const { lines, writes } = await watch({ wnba: { status: "drawn" } }, [pullRequest, open]);

  assert.deepEqual(writes, [
    {
      method: "POST",
      path: "/issues/3/comments",
      body: { body: `The app opens again, as of [this run](${RUN_URL}).` },
    },
    { method: "PATCH", path: "/issues/3", body: { state: "closed", state_reason: "completed" } },
  ]);
  assert.deepEqual(lines, ["wnba: opens again, so #3 is closed"]);
});

test("an app that can't be checked warns in the run and touches no issue", async () => {
  const open = { number: 3, title: nameOutageIssue("mlb") };

  const { lines, writes } = await watch(
    { mlb: { status: "unchecked", reason: "the Worker refused the access code" } },
    [open],
  );

  assert.deepEqual(writes, []);
  assert.deepEqual(lines, ["::warning::mlb: not checked, the Worker refused the access code"]);
});

test("a check that can't open a browser fails the watch's run, rather than passing it unchecked", async () => {
  const github = createFakeGitHub([]);
  await assert.rejects(
    watchApps({
      repository: REPOSITORY,
      runUrl: RUN_URL,
      apps: ["mlb"],
      checkApp: async () => {
        throw new Error("browserType.launch: Executable doesn't exist");
      },
      fetchImpl: github.fetchImpl,
      env: { GH_TOKEN: "token" },
    }),
    /Executable doesn't exist/,
  );
});
