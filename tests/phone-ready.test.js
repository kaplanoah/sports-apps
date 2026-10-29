import test from "node:test";
import assert from "node:assert/strict";
import { describeBeta, nameReadyMarker, tellPhoneReady } from "../worker/phone-ready.mjs";

const REPOSITORY = "owner/sports-apps";
const HEAD = "b".repeat(40);
const EARLIER_HEAD = "c".repeat(40);
const BOT = { login: "github-actions[bot]" };

const passedRuns = () => [
  { id: 1, name: "check", status: "completed", conclusion: "success" },
  { id: 2, name: "trusted-review", status: "completed", conclusion: "success" },
];
const heldStatuses = () => [{ context: "phone", state: "pending" }];

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
  ...changes,
});

/**
 * GitHub's API with these open pull requests into main, each with its checks, threads, and
 * comments, recording the comments posted and deleted.
 * @param {ReturnType<typeof createPull>[]} pulls
 */
function createFakeGitHub(pulls) {
  const posted = [];
  const deleted = [];
  /** @param {number} number */
  const findPull = (number) => pulls.find((pull) => pull.number === number);
  /** @param {string} head */
  const findByHead = (head) => pulls.find((pull) => pull.head === head);
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(String(url));
    const method = init?.method ?? "GET";
    if (pathname === "/graphql") {
      const { variables } = JSON.parse(String(init?.body));
      const threads = findPull(variables.number).threads.map((thread) => ({
        ...thread,
        first: { nodes: [] },
        comments: { totalCount: 0, nodes: [] },
      }));
      return Response.json({
        data: {
          repository: {
            pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads } },
          },
        },
      });
    }
    const path = pathname.replace(`/repos/${REPOSITORY}`, "");
    if (path === "/pulls")
      return Response.json(
        pulls.map((pull) => ({
          number: pull.number,
          draft: pull.draft,
          labels: pull.labels.map((name) => ({ name })),
          head: { sha: pull.head, repo: { full_name: pull.repository } },
        })),
      );
    if (path === "/rules/branches/main")
      return Response.json([
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: "check" },
              { context: "phone" },
              { context: "trusted-review" },
            ],
          },
        },
      ]);
    const checkRunsHead = path.match(/^\/commits\/(\w+)\/check-runs$/)?.[1];
    if (checkRunsHead)
      return Response.json({ check_runs: findByHead(checkRunsHead)?.checkRuns ?? [] });
    const statusHead = path.match(/^\/commits\/(\w+)\/status$/)?.[1];
    if (statusHead) return Response.json({ statuses: findByHead(statusHead)?.statuses ?? [] });
    const deletedId = path.match(/^\/issues\/comments\/(\d+)$/)?.[1];
    if (deletedId && method === "DELETE") {
      deleted.push(Number(deletedId));
      return new Response(null, { status: 204 });
    }
    const commentsNumber = Number(path.match(/^\/issues\/(\d+)\/comments$/)?.[1]);
    if (commentsNumber && method === "POST") {
      posted.push({ number: commentsNumber, body: JSON.parse(String(init?.body)).body });
      return Response.json({});
    }
    if (commentsNumber) return Response.json(findPull(commentsNumber).comments);
    throw new Error(`Unexpected request: ${method} ${path}`);
  };
  return { fetchImpl, posted, deleted };
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
  assert.match(body, /It isn't on beta yet, and beta is free\./);
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
        { id: 2, name: "trusted-review", status: "in_progress", conclusion: null },
      ],
    }),
  ]);
  const unreviewed = createFakeGitHub([createPull({ checkRuns: [passedRuns()[0]] })]);

  assert.deepEqual(await tell(reviewing), []);
  assert.deepEqual(await tell(running), []);
  assert.deepEqual(await tell(unreviewed), []);
});

test("no comment while a review thread is open", async () => {
  const github = createFakeGitHub([
    createPull({ threads: [{ isResolved: true }, { isResolved: false }] }),
  ]);

  assert.deepEqual(await tell(github), []);
});

test("no comment while another required check failed", async () => {
  const github = createFakeGitHub([
    createPull({
      checkRuns: [
        { id: 1, name: "check", status: "completed", conclusion: "failure" },
        passedRuns()[1],
      ],
    }),
  ]);

  assert.deepEqual(await tell(github), []);
});

test("a required check reported as a status counts once it succeeds", async () => {
  const statusOf = (state) =>
    createFakeGitHub([
      createPull({
        checkRuns: [passedRuns()[0]],
        statuses: [...heldStatuses(), { context: "trusted-review", state }],
      }),
    ]);

  assert.deepEqual(await tell(statusOf("success")), [7]);
  assert.deepEqual(await tell(statusOf("pending")), []);
});

test("each check's newest run decides it", async () => {
  const failedSince = createFakeGitHub([
    createPull({
      checkRuns: [
        ...passedRuns(),
        { id: 3, name: "check", status: "completed", conclusion: "failure" },
      ],
    }),
  ]);
  const passedSince = createFakeGitHub([
    createPull({
      checkRuns: [
        { id: 3, name: "check", status: "completed", conclusion: "success" },
        { id: 1, name: "check", status: "completed", conclusion: "failure" },
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
    createPull({ number: 1, comments: [{ id: 11, user: BOT, body: nameReadyMarker(HEAD) }] }),
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
    "It waits for beta, which #5 holds, so try it once it's on beta.",
  );
  assert.equal(
    describeBeta(7, ["beta"], 5),
    "It waits for beta, which #5 holds, so try it once it's on beta.",
  );
  assert.equal(describeBeta(7, [], 5), "It isn't on beta yet, and #5 holds beta.");
  assert.equal(describeBeta(7, [], null), "It isn't on beta yet, and beta is free.");
});
