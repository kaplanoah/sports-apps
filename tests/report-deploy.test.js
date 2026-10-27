import test from "node:test";
import assert from "node:assert/strict";
import { readRepoFile } from "./repo-files.js";
import { DEPLOY_ISSUE_TITLE, reportDeploy } from "../worker/report-deploy.mjs";

const REPOSITORY = "owner/sports-apps";
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const COMMIT = "a".repeat(40);
const OPEN_ISSUE = { number: 12, title: DEPLOY_ISSUE_TITLE };
const STARTED_DEPLOY = { name: "deploy", steps: [{ name: "Set up job" }] };

/**
 * Reports a run to GitHub with `openIssues` open and `jobs` in the run, and gives what it said
 * and each call it made.
 * @param {{ jobResult: string, checkedCommit: string }} run
 * @param {any[]} [openIssues]
 * @param {any[]} [jobs]
 */
async function report(run, openIssues = [], jobs = []) {
  const calls = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init = {}) => {
    const path = String(url).replace(API, "");
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith("/actions/runs/1/jobs?")) return Response.json({ jobs });
    if (method === "GET") return Response.json(path.startsWith("/issues?") ? openIssues : []);
    return Response.json({ number: 7 });
  };
  const line = await reportDeploy({
    repository: REPOSITORY,
    runUrl: RUN_URL,
    runId: "1",
    commit: COMMIT,
    ...run,
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return { line, writes: calls.filter((call) => call.method !== "GET"), calls };
}

test("a failed deploy opens one issue naming its commit and run", async () => {
  const { line, writes } = await report({ jobResult: "failure", checkedCommit: "" });
  assert.equal(line, "The deploy failed, so #7 is open");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/issues");
  assert.equal(writes[0].body.title, "The production deploy is failing");
  assert.match(writes[0].body.body, /main at aaaaaaa /);
  assert.ok(writes[0].body.body.includes(`(${RUN_URL})`));
});

test("a deploy stopped by its time limit, which GitHub calls cancelled, opens the issue", async () => {
  const { line, writes } = await report(
    { jobResult: "cancelled", checkedCommit: "" },
    [],
    [STARTED_DEPLOY],
  );
  assert.equal(line, "The deploy failed, so #7 is open");
  assert.equal(writes[0].body.title, DEPLOY_ISSUE_TITLE);
});

test("a waiting deploy a newer run supersedes, cancelled before it started, leaves the issue as it is", async () => {
  const { line, writes } = await report(
    { jobResult: "cancelled", checkedCommit: "" },
    [OPEN_ISSUE],
    [
      { name: "deploy", steps: [] },
      { name: "report", steps: [{ name: "Set up job" }] },
    ],
  );
  assert.match(line, /cancelled before it started/);
  assert.deepEqual(writes, []);
});

test("a deploy that fails again leaves its open issue as it is", async () => {
  const { line, writes } = await report({ jobResult: "failure", checkedCommit: "" }, [OPEN_ISSUE]);
  assert.equal(line, "The deploy failed again; #12 is open");
  assert.deepEqual(writes, []);
});

test("a deploy that goes through closes the open issue with a link to its run", async () => {
  const { line, writes } = await report({ jobResult: "success", checkedCommit: COMMIT }, [
    { number: 3, title: DEPLOY_ISSUE_TITLE, pull_request: {} },
    OPEN_ISSUE,
  ]);
  assert.equal(line, "The deploy went through, so #12 is closed");
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/12/comments", "PATCH /issues/12"],
  );
  assert.match(writes[0].body.body, /checked at aaaaaaa,/);
  assert.ok(writes[0].body.body.includes(`(${RUN_URL})`));
  assert.deepEqual(writes[1].body, { state: "closed", state_reason: "completed" });
});

test("a deploy that goes through with no issue open writes nothing", async () => {
  const { line, writes } = await report({ jobResult: "success", checkedCommit: COMMIT });
  assert.equal(line, "The deploy went through");
  assert.deepEqual(writes, []);
});

test("a run that checks nothing, waiting for CI on main or superseded, leaves the issue open and asks GitHub nothing", async () => {
  const { line, calls } = await report({ jobResult: "success", checkedCommit: "" }, [OPEN_ISSUE]);
  assert.match(line, /checked nothing/);
  assert.deepEqual(calls, []);
});

test("a run that checked production and then failed closes the issue rather than opening one", async () => {
  const { writes } = await report({ jobResult: "failure", checkedCommit: COMMIT }, [OPEN_ISSUE]);
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/12/comments", "PATCH /issues/12"],
  );
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
  assert.match(
    reportJob,
    /permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: write\n/,
  );
  assert.match(reportJob, /RUN_ID: \$\{\{ github\.run_id \}\}/);
  // The production receipts read only successful runs, so the report's failure can't fail one.
  assert.match(reportJob, /\n {4}continue-on-error: true\n/);
  assert.doesNotMatch(reportJob, /concurrency:/);
  assert.match(deployJob, /checked-commit: \$\{\{ steps\.deploy\.outputs\.checked-commit \}\}/);
  assert.match(reportJob, /CHECKED_COMMIT: \$\{\{ needs\.deploy\.outputs\.checked-commit \}\}/);
  assert.match(reportJob, /JOB_RESULT: \$\{\{ needs\.deploy\.result \}\}/);
  assert.doesNotMatch(reportJob, /secrets\./);
});
