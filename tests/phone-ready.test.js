import test from "node:test";
import assert from "node:assert/strict";
import { describeBeta, nameReadyMarker, tellPhoneReady } from "../worker/phone-ready.mjs";
import { createTimelineAnswer } from "./timeline.js";

const REPOSITORY = "owner/sports-apps";
const HEAD = "b".repeat(40);
const EARLIER_HEAD = "c".repeat(40);
const BOT = { login: "github-actions[bot]" };
const ACTIONS_APP = { id: 15368 };
const REVIEW_APP = { id: 900 };

const passedRuns = () => [
  { id: 1, name: "check", conclusion: "success", app: ACTIONS_APP },
  { id: 2, name: "trusted-review", conclusion: "success", app: REVIEW_APP },
];
const heldStatuses = () => [{ context: "phone", state: "pending" }];
const REQUIRED_CHECKS = [
  { context: "check", integration_id: ACTIONS_APP.id },
  { context: "phone", integration_id: ACTIONS_APP.id },
  { context: "trusted-review", integration_id: REVIEW_APP.id },
];

/**
 * A red pull request whose phone test is all that's left, with what a test changes of it.
 * @param {object} [changes]
 */
const createPull = (changes = {}) => ({
  number: 7,
  repository: REPOSITORY,
  head: HEAD,
  draft: false,
  labels: [],
  checkRuns: passedRuns(),
  statuses: heldStatuses(),
  threads: [{ isResolved: true }],
  comments: [],
  timeline: [],
  ...changes,
});

/**
 * GitHub's API with these open pull requests into main, each with its checks, threads, timeline,
 * and comments, recording each request and the comments posted, edited, and deleted. Each head
 * was pushed before any label.
 * @param {ReturnType<typeof createPull>[]} pulls
 * @param {{ context: string, integration_id?: number }[]} [required] the checks main's rules require
 */
function createFakeGitHub(pulls, required = REQUIRED_CHECKS) {
  const requests = [];
  const posted = [];
  const edited = [];
  const deleted = [];
  /** @param {number} number */
  const findPull = (number) => pulls.find((pull) => pull.number === number);
  /** @param {string} head */
  const findByHead = (head) => pulls.find((pull) => pull.head === head);
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(String(url));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${pathname}`);
    if (pathname === "/graphql") {
      const { query, variables } = JSON.parse(String(init?.body));
      if (query.includes("timelineItems"))
        return Response.json(createTimelineAnswer(findPull(variables.number).timeline));
      const { threads } = findPull(variables.number);
      const index = Number(variables.after ?? 0);
      const pageInfo = { hasNextPage: index + 1 < threads.length, endCursor: String(index + 1) };
      const page = { pageInfo, nodes: threads.slice(index, index + 1) };
      return Response.json({ data: { repository: { pullRequest: { reviewThreads: page } } } });
    }
    const path = pathname.replace(`/repos/${REPOSITORY}`, "");
    if (path === "/pulls")
      return Response.json(
        pulls.map((pull) => ({
          number: pull.number,
          draft: pull.draft,
          labels: pull.labels.map((name) => ({ name })),
          head: {
            sha: pull.head,
            ref: `branch-${pull.number}`,
            repo: { full_name: pull.repository },
          },
        })),
      );
    if (path === "/rules/branches/main")
      return Response.json([
        { type: "required_status_checks", parameters: { required_status_checks: required } },
      ]);
    const checkRunsHead = path.match(/^\/commits\/(\w+)\/check-runs$/)?.[1];
    if (checkRunsHead)
      return Response.json({ check_runs: findByHead(checkRunsHead)?.checkRuns ?? [] });
    const statusHead = path.match(/^\/commits\/(\w+)\/status$/)?.[1];
    if (statusHead) return Response.json({ statuses: findByHead(statusHead)?.statuses ?? [] });
    const suitesHead = path.match(/^\/commits\/(\w+)\/check-suites$/)?.[1];
    if (suitesHead) {
      const branch = `branch-${findByHead(suitesHead)?.number}`;
      const suite = {
        created_at: "2026-10-20T11:00:00Z",
        head_branch: branch,
        app: { slug: "github-actions" },
      };
      return Response.json({ check_suites: [suite] });
    }
    const commentId = Number(path.match(/^\/issues\/comments\/(\d+)$/)?.[1]);
    if (commentId && method === "DELETE") {
      deleted.push(commentId);
      return new Response(null, { status: 204 });
    }
    if (commentId && method === "PATCH") {
      edited.push({ id: commentId, body: JSON.parse(String(init?.body)).body });
      return Response.json({});
    }
    const commentsNumber = Number(path.match(/^\/issues\/(\d+)\/comments$/)?.[1]);
    if (commentsNumber && method === "POST") {
      posted.push({ number: commentsNumber, body: JSON.parse(String(init?.body)).body });
      return Response.json({});
    }
    if (commentsNumber) return Response.json(findPull(commentsNumber).comments);
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  return { fetchImpl, requests, posted, edited, deleted };
}

/**
 * @param {ReturnType<typeof createFakeGitHub>} github
 * @param {number | null} [holder]
 */
const tell = (github, holder = null) =>
  tellPhoneReady({
    repository: REPOSITORY,
    fetchImpl: github.fetchImpl,
    env: { GH_TOKEN: "token" },
    readHolder: async () => holder,
  });

/**
 * The comment a pull request waiting only on the phone is told, as a comment already posted.
 * @param {number} id
 * @param {number | null} [holder]
 */
async function createToldComment(id, holder = null) {
  const github = createFakeGitHub([createPull()]);
  await tell(github, holder);
  return { id, user: BOT, body: github.posted[0].body };
}

test("a red pull request waiting only on the phone gets numbered steps for the phone test", async () => {
  const github = createFakeGitHub([createPull()]);

  assert.deepEqual(await tell(github), [7]);

  assert.equal(github.posted.length, 1);
  assert.equal(github.posted[0].number, 7);
  const { body } = github.posted[0];
  assert.match(body, /ready for the phone test at bbbbbbb/);
  assert.match(
    body,
    /1\. Open the beta apps\.\n2\. Try the change\.\n3\. Add the `phone-ok` label\./,
  );
  assert.match(body, /It isn't on beta yet, so ask its session to put it on beta first\./);
  assert.ok(body.includes(nameReadyMarker(HEAD)));
});

test("the comment says whether the pull request holds beta now", async () => {
  const github = createFakeGitHub([createPull({ labels: ["beta"] })]);

  await tell(github, 7);

  assert.match(github.posted[0].body, /It holds beta now, so the beta apps run it\./);
});

test("no comment while a review is pending", async () => {
  const reviewing = createFakeGitHub([createPull({ labels: ["review"] })]);
  const running = createFakeGitHub([
    createPull({
      checkRuns: [
        passedRuns()[0],
        { id: 2, name: "trusted-review", conclusion: null, app: REVIEW_APP },
      ],
    }),
  ]);
  const unreviewed = createFakeGitHub([createPull({ checkRuns: [passedRuns()[0]] })]);

  assert.deepEqual(await tell(reviewing), []);
  assert.deepEqual(await tell(running), []);
  assert.deepEqual(await tell(unreviewed), []);
});

test("no comment while a review thread is open, on any page of threads", async () => {
  const github = createFakeGitHub([
    createPull({ threads: [{ isResolved: true }, { isResolved: true }, { isResolved: false }] }),
  ]);

  assert.deepEqual(await tell(github), []);
  assert.equal(github.requests.filter((request) => request === "POST /graphql").length, 3);
});

test("no comment while another required check failed", async () => {
  const github = createFakeGitHub([
    createPull({
      checkRuns: [
        { id: 1, name: "check", conclusion: "failure", app: ACTIONS_APP },
        passedRuns()[1],
      ],
    }),
  ]);

  assert.deepEqual(await tell(github), []);
});

test("a required check reported as a status counts once it succeeds, when its rule names no App", async () => {
  const anyApp = REQUIRED_CHECKS.map(({ context }) => ({ context }));
  const statusOf = (state, required = anyApp) =>
    createFakeGitHub(
      [
        createPull({
          checkRuns: [passedRuns()[0]],
          statuses: [...heldStatuses(), { context: "trusted-review", state }],
        }),
      ],
      required,
    );

  assert.deepEqual(await tell(statusOf("success")), [7]);
  assert.deepEqual(await tell(statusOf("pending")), []);
  assert.deepEqual(await tell(statusOf("success", REQUIRED_CHECKS)), []);
});

test("a told comment stays as it is while a required check runs again at its head", async () => {
  const github = createFakeGitHub([
    createPull({
      checkRuns: [...passedRuns(), { id: 3, name: "check", conclusion: null, app: ACTIONS_APP }],
      comments: [await createToldComment(11)],
    }),
  ]);

  assert.deepEqual(await tell(github), []);

  assert.deepEqual(github.deleted, []);
  assert.deepEqual(github.edited, []);
  assert.equal(github.posted.length, 0);
});

test("each check's newest run decides it", async () => {
  const failedSince = createFakeGitHub([
    createPull({
      checkRuns: [
        ...passedRuns(),
        { id: 3, name: "check", conclusion: "failure", app: ACTIONS_APP },
      ],
    }),
  ]);
  const passedSince = createFakeGitHub([
    createPull({
      checkRuns: [
        { id: 3, name: "check", conclusion: "success", app: ACTIONS_APP },
        { id: 1, name: "check", conclusion: "failure", app: ACTIONS_APP },
        passedRuns()[1],
      ],
    }),
  ]);

  assert.deepEqual(await tell(failedSince), []);
  assert.deepEqual(await tell(passedSince), [7]);
});

test("no comment on a change that isn't red, a draft, a fork's, or one the owner already labeled phone-ok", async () => {
  const github = createFakeGitHub([
    createPull({
      number: 1,
      head: "1".repeat(40),
      statuses: [{ context: "phone", state: "success" }],
    }),
    createPull({ number: 2, head: "2".repeat(40), draft: true }),
    createPull({ number: 3, head: "3".repeat(40), labels: ["phone-ok"] }),
    createPull({ number: 4, head: "4".repeat(40), repository: "fork/sports-apps" }),
  ]);

  assert.deepEqual(await tell(github), []);
  assert.equal(github.posted.length, 0);
});

test("a head already told isn't told again, and a later head takes down what an earlier one was told", async () => {
  const github = createFakeGitHub([
    createPull({ number: 1, comments: [await createToldComment(11)] }),
    createPull({
      number: 2,
      comments: [{ id: 21, user: BOT, body: nameReadyMarker(EARLIER_HEAD) }],
    }),
    createPull({
      number: 3,
      labels: ["review"],
      comments: [{ id: 31, user: BOT, body: nameReadyMarker(EARLIER_HEAD) }],
    }),
  ]);

  assert.deepEqual(await tell(github), [2]);
  assert.deepEqual(github.deleted, [21, 31]);
  assert.deepEqual(github.edited, []);
});

test("the comment is edited, not posted again, when beta changes hands at the same head", async () => {
  const github = createFakeGitHub([
    createPull({ labels: ["beta"], comments: [await createToldComment(11)] }),
  ]);

  assert.deepEqual(await tell(github, 7), []);

  assert.equal(github.posted.length, 0);
  assert.deepEqual(github.deleted, []);
  assert.deepEqual(
    github.edited.map(({ id }) => id),
    [11],
  );
  assert.match(github.edited[0].body, /It holds beta now/);
});

test("the comment comes down once its head no longer waits only on the phone", async () => {
  const comments = [await createToldComment(11)];
  const asked = createFakeGitHub([createPull({ labels: ["review"], comments })]);
  const reopened = createFakeGitHub([createPull({ threads: [{ isResolved: false }], comments })]);

  await tell(asked);
  await tell(reopened);

  assert.deepEqual(asked.deleted, [11]);
  assert.deepEqual(reopened.deleted, [11]);
});

test("a check named like a required one but posted by another App doesn't count", async () => {
  const lookalikePassed = createFakeGitHub([
    createPull({
      checkRuns: [
        passedRuns()[0],
        { id: 2, name: "trusted-review", conclusion: null, app: REVIEW_APP },
        { id: 3, name: "trusted-review", conclusion: "success", app: ACTIONS_APP },
      ],
    }),
  ]);
  const lookalikeFailed = createFakeGitHub([
    createPull({
      checkRuns: [
        ...passedRuns(),
        { id: 3, name: "trusted-review", conclusion: "failure", app: ACTIONS_APP },
      ],
    }),
  ]);

  assert.deepEqual(await tell(lookalikePassed), []);
  assert.deepEqual(await tell(lookalikeFailed), [7]);
});

test("checks and threads are read only for a pull request the phone status holds", async () => {
  const github = createFakeGitHub([
    createPull({ statuses: [{ context: "phone", state: "success" }] }),
  ]);
  const unread = createFakeGitHub([
    createPull({ number: 1, head: "1".repeat(40), draft: true }),
    createPull({ number: 2, head: "2".repeat(40), labels: ["review"] }),
    createPull({ number: 3, head: "3".repeat(40), labels: ["phone-ok"] }),
  ]);

  await tell(github);
  await tell(unread);

  assert.ok(!unread.requests.some((request) => request.includes("/commits/")));
  assert.ok(github.requests.some((request) => request.endsWith("/status")));
  assert.ok(!github.requests.some((request) => request.includes("/check-runs")));
  assert.ok(!github.requests.includes("POST /graphql"));
});

test("who holds beta is read once a run, and from the labels and timelines when not given", async () => {
  const github = createFakeGitHub([
    createPull({
      labels: ["beta"],
      timeline: [
        {
          event: "labeled",
          created_at: "2026-10-20T12:00:00Z",
          label: { name: "beta" },
          actor: { login: "owner" },
        },
      ],
    }),
    createPull({ number: 8, head: "8".repeat(40) }),
  ]);
  const free = createFakeGitHub([createPull()]);

  await tellPhoneReady({ repository: REPOSITORY, fetchImpl: github.fetchImpl, env: {} });
  await tellPhoneReady({ repository: REPOSITORY, fetchImpl: free.fetchImpl, env: {} });

  assert.match(github.posted[0].body, /It holds beta now/);
  assert.match(github.posted[1].body, /It isn't on beta yet, and #7 holds beta/);
  assert.match(free.posted[0].body, /It isn't on beta yet, so ask/);
  assert.equal(
    github.requests.filter((request) => request === "GET /repos/owner/sports-apps/pulls").length,
    2,
  );
});

test("a marker someone else wrote is neither taken down nor counted as told", async () => {
  const github = createFakeGitHub([
    createPull({
      comments: [
        { id: 11, user: { login: "someone" }, body: nameReadyMarker(HEAD) },
        { id: 12, user: { login: "someone" }, body: nameReadyMarker(EARLIER_HEAD) },
      ],
    }),
  ]);

  assert.deepEqual(await tell(github), [7]);
  assert.deepEqual(github.deleted, []);
});

test("beta's state reads as holding, waiting, or not on beta, with who holds it", () => {
  assert.equal(describeBeta(7, ["beta"], 7), "It holds beta now, so the beta apps run it.");
  assert.equal(
    describeBeta(7, ["beta-wait"], 5),
    "It waits for beta, which #5 holds, so start once it holds beta.",
  );
  assert.equal(
    describeBeta(7, ["beta"], 5),
    "It waits for beta, which #5 holds, so start once it holds beta.",
  );
  assert.equal(
    describeBeta(7, [], 5),
    "It isn't on beta yet, and #5 holds beta, so ask its session to put it on beta first.",
  );
  assert.equal(
    describeBeta(7, [], null),
    "It isn't on beta yet, so ask its session to put it on beta first.",
  );
});
