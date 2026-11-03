import test from "node:test";
import assert from "node:assert/strict";
import { BETA_LABEL } from "../worker/beta-claim.mjs";
import {
  commentDeploy,
  maskDetail,
  nameDeployMarker,
  renderDeployComment,
} from "../worker/comment-deploy.mjs";
import { ACTIONS_LOGIN } from "../worker/github-api.mjs";
import { readRepoFile } from "./repo-files.js";
import { createTimelineAnswer } from "./timeline.js";

/** @typedef {import("../worker/worker-results.mjs").WorkerResult} WorkerResult */

const REPOSITORY = "owner/sports-apps";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const RUN_URL = "https://github.com/owner/sports-apps/actions/runs/1";
const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const STARTED_DEPLOY = { name: "deploy", steps: [{ name: "Set up job" }] };

/** @type {WorkerResult[]} */
const CHECKED = [
  { worker: "mlb", version: "2.40.1", result: "checked" },
  { worker: "wnba", version: "1.20.0", result: "unchanged" },
];

/** @param {number} minute */
const at = (minute) => `2026-10-20T12:${String(minute).padStart(2, "0")}:00Z`;

/**
 * A pull request open on GitHub, with `labels` and its head at `headSha`.
 * @param {number} number
 * @param {string[]} labels
 * @param {string} headSha
 */
const createOpenPull = (number, labels, headSha) => ({
  number,
  head: { sha: headSha, ref: `feature-${number}` },
  labels: labels.map((name) => ({ name })),
});

/**
 * A fake GitHub that answers from this state and records each request.
 * @param {{ merged?: object[], open?: ReturnType<typeof createOpenPull>[], comments?: object[], jobs?: object[] }} [state]
 */
function createGitHubFake({ merged = [], open = [], comments = [], jobs = [] } = {}) {
  /** @type {{ method: string, path: string, body?: any }[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const path = String(url).replace(API, "");
    const method = init?.method ?? "GET";
    requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url) === "https://api.github.com/graphql")
      return Response.json(
        createTimelineAnswer([
          {
            event: "labeled",
            created_at: at(1),
            label: { name: BETA_LABEL },
            actor: { login: "owner" },
          },
        ]),
      );
    if (method !== "GET") return Response.json({ id: 1 });
    if (path.startsWith(`/commits/${COMMIT}/pulls?`)) return Response.json(merged);
    if (path.startsWith("/pulls?state=open")) return Response.json(open);
    if (path.includes("/check-suites")) {
      const pull = open.find(({ head }) => path.includes(head.sha));
      const app = { slug: "github-actions" };
      return Response.json({
        check_suites: [{ created_at: at(0), head_branch: pull?.head.ref, app }],
      });
    }
    if (path.startsWith("/actions/runs/1/jobs?")) return Response.json({ jobs });
    if (/^\/issues\/\d+\/comments\?/.test(path)) return Response.json(comments);
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  return { fetchImpl, requests };
}

/**
 * Comments on the run's pull request from a fake GitHub, and gives what it said and wrote.
 * @param {{ channel?: string, jobResult?: string, results?: WorkerResult[] | string }} run
 * @param {Parameters<typeof createGitHubFake>[0]} [state]
 */
async function comment(
  { channel = "production", jobResult = "success", results = CHECKED },
  state,
) {
  const { fetchImpl, requests } = createGitHubFake(state);
  const line = await commentDeploy({
    repository: REPOSITORY,
    channel,
    runUrl: RUN_URL,
    runId: "1",
    commit: COMMIT,
    jobResult,
    workerResults: typeof results === "string" ? results : JSON.stringify(results),
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  return { line, requests, writes: requests.filter(isWrite) };
}

/** @param {{ method: string, path: string }} request */
function isWrite({ method, path }) {
  return method !== "GET" && path !== "https://api.github.com/graphql";
}

const MERGED = [
  { number: 40, merged_at: null, merge_commit_sha: COMMIT },
  { number: 41, merged_at: at(2), merge_commit_sha: OTHER_COMMIT },
  { number: 42, merged_at: at(3), merge_commit_sha: COMMIT },
];

test("production comments on the pull request whose squash merge the run deployed", async () => {
  const { line, writes } = await comment({}, { merged: MERGED });
  assert.equal(line, "The deploy's comment on #42 was posted");
  assert.deepEqual(
    writes.map(({ method, path }) => `${method} ${path}`),
    ["POST /issues/42/comments"],
  );
  assert.ok(writes[0].body.body.endsWith(nameDeployMarker("production", COMMIT)));
});

test("production posts nothing when no pull request was merged as the commit", async () => {
  const { line, writes } = await comment({}, { merged: MERGED.slice(0, 2) });
  assert.equal(line, "No pull request matches aaaaaaa on production");
  assert.deepEqual(writes, []);
});

test("beta comments on the pull request holding beta when the run deployed its head", async () => {
  const { line, writes, requests } = await comment(
    { channel: "beta" },
    {
      open: [createOpenPull(7, ["bug"], OTHER_COMMIT), createOpenPull(8, [BETA_LABEL], COMMIT)],
    },
  );
  assert.equal(line, "The deploy's comment on #8 was posted");
  assert.equal(writes[0].path, "/issues/8/comments");
  assert.ok(writes[0].body.body.endsWith(nameDeployMarker("beta", COMMIT)));
  assert.ok(!requests.some(({ path }) => path.includes(`/commits/${COMMIT}/pulls`)));
});

test("beta posts nothing when the holder's head isn't the commit the run deployed", async () => {
  const { line, writes } = await comment(
    { channel: "beta" },
    { open: [createOpenPull(8, [BETA_LABEL], OTHER_COMMIT)] },
  );
  assert.equal(line, "No pull request matches aaaaaaa on beta");
  assert.deepEqual(writes, []);
});

test("a run that checked nothing asks GitHub nothing, on either channel", async () => {
  /** @type {WorkerResult[]} */
  const unchanged = [{ worker: "mlb", version: "2.40.1", result: "unchanged" }];
  for (const channel of ["production", "beta"])
    for (const results of [unchanged, [], "", "not json"]) {
      const { line, requests } = await comment({ channel, results }, { merged: MERGED });
      assert.match(line, /checked nothing/);
      assert.deepEqual(requests, []);
    }
});

test("a run cancelled before its deploy started posts nothing", async () => {
  const { line, writes } = await comment(
    { jobResult: "cancelled", results: [] },
    { merged: MERGED, jobs: [{ name: "deploy", steps: [] }] },
  );
  assert.match(line, /checked nothing/);
  assert.deepEqual(writes, []);
});

test("a run cancelled after its deploy started, as by its time limit, says it failed", async () => {
  const { writes } = await comment(
    { jobResult: "cancelled", results: [] },
    { merged: MERGED, jobs: [STARTED_DEPLOY] },
  );
  assert.match(writes[0].body.body, /^The production deploy of aaaaaaa failed\./);
});

test("a run that went through names each Worker's version and result", () => {
  const body = renderDeployComment({
    channel: "production",
    commit: COMMIT,
    runUrl: RUN_URL,
    isFailed: false,
    results: [...CHECKED, { worker: "accounts", version: null, result: "checked" }],
  });
  assert.equal(
    body,
    [
      `The production deploy of aaaaaaa went through, as [the run's log](${RUN_URL}) says.`,
      "",
      "| Worker | Version | Result |",
      "| --- | --- | --- |",
      "| mlb | 2.40.1 | worker check: ok |",
      "| wnba | 1.20.0 | Not deployed or checked by this run |",
      "| accounts | unknown | worker check: ok |",
      "",
      nameDeployMarker("production", COMMIT),
    ].join("\n"),
  );
});

test("a failed check says what failed and whether the earlier version is back", () => {
  const body = renderDeployComment({
    channel: "beta",
    commit: COMMIT,
    runUrl: RUN_URL,
    isFailed: true,
    results: [
      { worker: "mlb", version: "2.40.1", result: "failed", detail: "the page didn't draw" },
      {
        worker: "wnba",
        version: "1.20.0",
        result: "failed",
        detail: "the Worker didn't answer, so the earlier version is live again",
      },
    ],
  });
  assert.match(
    body,
    /^The beta deploy of aaaaaaa failed\. Read \[the run's log\]\(.+\) as the deploy-log skill says\./,
  );
  assert.match(body, /\n\| mlb \| 2\.40\.1 \| failed: the page didn't draw \|\n/);
  assert.match(body, /\| wnba \| 1\.20\.0 \| failed: .*the earlier version is live again \|/);
});

test("a run that stopped before it reported its Workers says so", () => {
  const body = renderDeployComment({
    channel: "production",
    commit: COMMIT,
    runUrl: RUN_URL,
    isFailed: true,
    results: [],
  });
  assert.match(body, /\n\nThe run stopped before it reported each Worker\.\n\n/);
  assert.doesNotMatch(body, /\| Worker \|/);
});

test("a re-run keeps or edits its channel's one comment for the commit, never posting another", async () => {
  const body = renderDeployComment({
    channel: "production",
    commit: COMMIT,
    runUrl: RUN_URL,
    isFailed: false,
    results: CHECKED,
  });
  const marker = nameDeployMarker("production", COMMIT);
  const others = [
    { id: 3, body: `${marker} quoted`, user: { login: "someone" } },
    { id: 4, body: nameDeployMarker("beta", COMMIT), user: { login: ACTIONS_LOGIN } },
  ];
  const kept = await comment(
    {},
    { merged: MERGED, comments: [...others, { id: 5, body, user: { login: ACTIONS_LOGIN } }] },
  );
  assert.equal(kept.line, "The deploy's comment on #42 was kept");
  assert.deepEqual(kept.writes, []);

  const stale = `The production deploy failed.\n\n${marker}`;
  const edited = await comment(
    {},
    {
      merged: MERGED,
      comments: [...others, { id: 5, body: stale, user: { login: ACTIONS_LOGIN } }],
    },
  );
  assert.equal(edited.line, "The deploy's comment on #42 was edited");
  assert.deepEqual(
    edited.writes.map(({ method, path }) => `${method} ${path}`),
    ["PATCH /issues/comments/5"],
  );
  assert.equal(edited.writes[0].body.body, body);
});

test("a failure's detail never carries an address, key, subdomain, or account ID", async () => {
  const detail = `GET https://mlb.example-subdomain.workers.dev/k3y/health answered 500 from wnba.example-subdomain.workers.dev for account ${"7".repeat(32)} | retry`;
  assert.equal(
    maskDetail(detail),
    "GET <address> answered 500 from <address> for account <id> \\| retry",
  );
  const { writes } = await comment(
    {
      jobResult: "failure",
      results: [{ worker: "mlb", version: "2.40.1", result: "failed", detail }],
    },
    { merged: MERGED },
  );
  const body = writes[0].body.body.replace(nameDeployMarker("production", COMMIT), "");
  assert.doesNotMatch(body, /workers\.dev|k3y|example-subdomain|[0-9a-f]{32}/);
});

test("the comment job, apart from the one holding Cloudflare's token, runs main's script on both channels", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const [beforeComment, commentJob] = workflow.split(/\n {2}comment:\n/);
  const [deployJob] = beforeComment.split(/\n {2}report:\n/);
  assert.doesNotMatch(deployJob, /pull-requests: write/);
  assert.match(deployJob, /worker-results: \$\{\{ steps\.deploy\.outputs\.worker-results \}\}/);
  assert.match(commentJob, /\n {4}if: always\(\) && needs\.deploy\.result != 'skipped'\n/);
  assert.match(
    commentJob,
    /permissions:\n {6}contents: read\n {6}actions: read\n {6}issues: read\n {6}checks: read\n {6}pull-requests: write\n/,
  );
  assert.match(commentJob, /\n {10}ref: main\n/);
  assert.match(commentJob, /\n {4}continue-on-error: true\n/);
  assert.match(commentJob, /run: node worker\/comment-deploy\.mjs\n/);
  assert.match(commentJob, /WORKER_RESULTS: \$\{\{ needs\.deploy\.outputs\.worker-results \}\}/);
  assert.match(commentJob, /JOB_RESULT: \$\{\{ needs\.deploy\.result \}\}/);
  assert.doesNotMatch(commentJob, /secrets\.|issues: write/);
});
