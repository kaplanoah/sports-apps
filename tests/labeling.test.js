import test from "node:test";
import assert from "node:assert/strict";
import { findLabeling, readPushTime, readTimeline } from "../worker/labeling.mjs";
import { createTimelineAnswer } from "./timeline.js";

/**
 * An issue event of `type` for `label`, by `login`, at `at`.
 * @param {string} type
 * @param {string} label
 * @param {string} login
 * @param {string} at
 */
const createEvent = (type, label, login, at) => ({
  event: type,
  created_at: at,
  label: { name: label },
  actor: { login },
});

const HEAD_PUSHED_AT = Date.parse("2026-10-07T09:00:00Z");

test("a label's adder and when it was added are whoever added it last and then, whatever else was labeled", () => {
  const events = [
    createEvent("labeled", "phone-ok", "owner", "2026-10-07T10:00:00Z"),
    createEvent("unlabeled", "phone-ok", "owner", "2026-10-07T11:00:00Z"),
    createEvent("labeled", "phone-ok", "helper", "2026-10-07T12:00:00Z"),
    createEvent("labeled", "bug", "owner", "2026-10-07T13:00:00Z"),
  ];
  const lastAdded = {
    labeler: "helper",
    addedAt: Date.parse("2026-10-07T12:00:00Z"),
    isAfterLastPush: true,
  };
  assert.deepEqual(findLabeling(events, "phone-ok", HEAD_PUSHED_AT), lastAdded);
  assert.deepEqual(findLabeling(events.toReversed(), "phone-ok", HEAD_PUSHED_AT), lastAdded);
  assert.deepEqual(findLabeling(events.slice(3), "phone-ok", HEAD_PUSHED_AT), {
    labeler: null,
    addedAt: Number.NaN,
    isAfterLastPush: false,
  });
});

test("a head pushed after the phone-ok label leaves it before the last push, whatever its commit's date says", () => {
  const labeled = createEvent("labeled", "phone-ok", "owner", "2026-10-07T10:00:00Z");
  // Committed before the label, so the timeline dates it then, but pushed after it.
  const committedEarlier = { event: "committed", committer: { date: "2026-10-07T09:30:00Z" } };
  assert.deepEqual(
    findLabeling([committedEarlier, labeled], "phone-ok", Date.parse("2026-10-07T11:00:00Z")),
    { labeler: "owner", addedAt: Date.parse("2026-10-07T10:00:00Z"), isAfterLastPush: false },
  );
  const forcePush = {
    event: "head_ref_force_pushed",
    created_at: "2026-10-07T11:00:00Z",
    actor: { login: "owner" },
  };
  assert.equal(
    findLabeling([labeled, forcePush], "phone-ok", HEAD_PUSHED_AT).isAfterLastPush,
    false,
    "a force push back to a commit GitHub saw before the label",
  );
  const labeledAgain = createEvent("labeled", "phone-ok", "owner", "2026-10-07T12:00:00Z");
  assert.equal(
    findLabeling([labeled, forcePush, labeledAgain], "phone-ok", HEAD_PUSHED_AT).isAfterLastPush,
    true,
  );
  assert.equal(
    findLabeling([labeled], "phone-ok", Number.NaN).isAfterLastPush,
    false,
    "a head GitHub can't date may be the last push",
  );
});

test("a head's push time is its earliest check suite's", async () => {
  /** @type {string[]} */
  const urls = [];
  /** @param {{ created_at: string }[]} suites */
  const createFetch = (suites) => async (/** @type {string} */ url) => {
    urls.push(url);
    return Response.json({ total_count: suites.length, check_suites: suites });
  };
  const sha = "a".repeat(40);
  const options = { repository: "owner/repo", sha, env: { GH_TOKEN: "token" } };
  assert.equal(
    await readPushTime({
      ...options,
      fetchImpl: createFetch([
        { created_at: "2026-10-07T11:00:00Z" },
        { created_at: "2026-10-07T09:00:00Z" },
      ]),
    }),
    HEAD_PUSHED_AT,
  );
  assert.deepEqual(urls, [
    `https://api.github.com/repos/owner/repo/commits/${sha}/check-suites?per_page=100`,
  ]);
  assert.ok(Number.isNaN(await readPushTime({ ...options, fetchImpl: createFetch([]) })));
});

test("the GraphQL timeline is paginated with authentication and mapped for both gates", async () => {
  const expected = [
    createEvent("labeled", "beta", "owner", "2026-10-07T10:00:00Z"),
    {
      event: "unlabeled",
      created_at: "2026-10-07T11:00:00Z",
      label: { name: "beta" },
      actor: null,
    },
    {
      event: "head_ref_force_pushed",
      created_at: "2026-10-07T12:00:00Z",
      actor: { login: "owner" },
    },
    {
      event: "commented",
      created_at: "2026-10-07T13:00:00Z",
      body: "beta queue marker",
      actor: null,
    },
  ];
  const pages = [
    createTimelineAnswer(expected.slice(0, 2)),
    createTimelineAnswer(expected.slice(2)),
  ];
  pages[0].data.repository.pullRequest.timelineItems.pageInfo = {
    hasNextPage: true,
    endCursor: "next",
  };
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), "https://api.github.com/graphql");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    return Response.json(pages[requests.length - 1]);
  };
  const events = await readTimeline({
    repository: "owner/repo",
    pullNumber: "408",
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });
  assert.deepEqual(events, expected);
  assert.deepEqual(
    requests.map(({ variables }) => variables),
    [
      { owner: "owner", name: "repo", number: 408, after: null },
      { owner: "owner", name: "repo", number: 408, after: "next" },
    ],
  );
  assert.match(requests[0].query, /first: 100, after: \$after/);
  for (const type of [
    "LABELED_EVENT",
    "UNLABELED_EVENT",
    "HEAD_REF_FORCE_PUSHED_EVENT",
    "ISSUE_COMMENT",
  ])
    assert.ok(requests[0].query.includes(type));
  assert.match(requests[0].query, /created_at: createdAt/);
  assert.match(requests[0].query, /actor: author/);
});

test("unavailable or malformed GraphQL history fails closed", async () => {
  const absent = { data: { repository: { pullRequest: null } } };
  const cursor = createTimelineAnswer([]);
  cursor.data.repository.pullRequest.timelineItems.pageInfo = {
    hasNextPage: true,
    endCursor: null,
  };
  const unknown = createTimelineAnswer([]);
  unknown.data.repository.pullRequest.timelineItems.nodes.push({ __typename: "UnexpectedEvent" });
  for (const [answer, message] of [
    [absent, /didn't return/],
    [{ errors: [{ message: "history denied" }] }, /history denied/],
    [cursor, /didn't advance/],
    [unknown, /unexpected timeline event/],
  ]) {
    await assert.rejects(
      readTimeline({
        repository: "owner/repo",
        pullNumber: "408",
        fetchImpl: async () => Response.json(answer),
        env: {},
      }),
      message,
    );
  }
  await assert.rejects(
    readTimeline({
      repository: "owner/repo",
      pullNumber: "408",
      fetchImpl: async () => new Response("", { status: 403 }),
      env: {},
    }),
    /GitHub answered 403/,
  );
});

test("a repeated GraphQL cursor fails closed rather than looping over the same history", async () => {
  const answer = createTimelineAnswer([]);
  answer.data.repository.pullRequest.timelineItems.pageInfo = {
    hasNextPage: true,
    endCursor: "same",
  };
  let reads = 0;
  await assert.rejects(
    readTimeline({
      repository: "owner/repo",
      pullNumber: "408",
      fetchImpl: async () => {
        assert.ok(++reads <= 2);
        return Response.json(answer);
      },
      env: {},
    }),
    /didn't advance/,
  );
  assert.equal(reads, 2);
});
