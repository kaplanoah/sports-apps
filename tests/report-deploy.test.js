import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./repo-files.js";
import { DEPLOY_ISSUE_TITLE, reportDeploy } from "../worker/report-deploy.mjs";

const REPOSITORY = "owner/sports-apps";
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const COMMIT = "a".repeat(40);
const OPEN_ISSUE = { number: 12, title: DEPLOY_ISSUE_TITLE };

/**
 * Reports a run to GitHub with `openIssues` open, and gives what it said and each call it made.
 * @param {{ jobResult: string, deployOutcome: string }} run
 * @param {any[]} [openIssues]
 */
async function report(run, openIssues = []) {
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace(API, "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") return Response.json(path.startsWith("/issues?") ? openIssues : []);
    return Response.json({ number: 7 });
  };
  const line = await reportDeploy({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    commit: COMMIT,
    ...run,
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return { line, writes: calls.filter((call) => call.method !== "GET"), calls };
}

test("a failed deploy opens one issue naming its commit and run", async () => {
  const { line, writes } = await report({ jobResult: "failure", deployOutcome: "failure" });
  assert.equal(line, "The deploy failed, so #7 is open");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/issues");
  assert.equal(writes[0].body.title, "The production deploy is failing");
  assert.match(writes[0].body.body, /main at aaaaaaa /);
  assert.ok(writes[0].body.body.includes(`(${RUN_URL})`));
});

test("a run that fails before its deploy step opens the issue too", async () => {
  const { writes } = await report({ jobResult: "failure", deployOutcome: "skipped" });
  assert.equal(writes[0]?.body.title, DEPLOY_ISSUE_TITLE);
});

test("a deploy that fails again leaves its open issue as it is", async () => {
  const { line, writes } = await report({ jobResult: "failure", deployOutcome: "failure" }, [
    OPEN_ISSUE,
  ]);
  assert.equal(line, "The deploy failed again; #12 is open");
  assert.deepEqual(writes, []);
});

test("a deploy that goes through closes the open issue with a link to its run", async () => {
  const { line, writes } = await report({ jobResult: "success", deployOutcome: "success" }, [
    { number: 3, title: DEPLOY_ISSUE_TITLE, pull_request: {} },
    OPEN_ISSUE,
  ]);
  assert.equal(line, "The deploy went through, so #12 is closed");
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/12/comments", "PATCH /issues/12"],
  );
  assert.ok(writes[0].body.body.includes(`(${RUN_URL})`));
  assert.deepEqual(writes[1].body, { state: "closed", state_reason: "completed" });
});

test("a deploy that goes through with no issue open writes nothing", async () => {
  const { line, writes } = await report({ jobResult: "success", deployOutcome: "success" });
  assert.equal(line, "The deploy went through");
  assert.deepEqual(writes, []);
});

test("a run that waits for CI on main leaves the issue open and asks GitHub nothing", async () => {
  const { line, calls } = await report({ jobResult: "success", deployOutcome: "skipped" }, [
    OPEN_ISSUE,
  ]);
  assert.match(line, /didn't run/);
  assert.deepEqual(calls, []);
});

test("only the report job writes issues, after every production deploy, and never beta's", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const [deployJob, reportJob] = workflow.split(/\n {2}report:\n/);
  assert.match(deployJob, /\n {2}issues: read\n/);
  assert.doesNotMatch(deployJob, /issues: write/);
  assert.match(
    reportJob,
    /if: always\(\) && github\.ref_name != 'beta' && needs\.deploy\.result != 'skipped'\n/,
  );
  assert.match(reportJob, /permissions:\n {6}issues: write\n/);
  assert.match(deployJob, /deploy-outcome: \$\{\{ steps\.deploy\.outcome \}\}/);
  assert.match(reportJob, /DEPLOY_OUTCOME: \$\{\{ needs\.deploy\.outputs\.deploy-outcome \}\}/);
  assert.match(reportJob, /JOB_RESULT: \$\{\{ needs\.deploy\.result \}\}/);
  assert.doesNotMatch(reportJob, /secrets\./);
});
