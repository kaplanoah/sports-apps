import test from "node:test";
import assert from "node:assert/strict";
import { findLabeling, readPushTime, readTimeline } from "../worker/labeling.mjs";

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

test("a pull request's timeline is read page by page, with the token, until a short page", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) =>
      createEvent(
        "labeled",
        "bug",
        "owner",
        `2026-10-07T10:00:${String(index % 60).padStart(2, "0")}Z`,
      ),
    ),
    [createEvent("labeled", "phone-ok", "owner", "2026-10-07T12:00:00Z")],
  ];
  /** @type {{ url: string, authorization: string }[]} */
  const requests = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const headers = /** @type {Record<string, string>} */ (init?.headers);
    requests.push({ url: String(url), authorization: headers.authorization });
    return Response.json(pages[requests.length - 1]);
  };

  const events = await readTimeline({
    repository: "owner/repo",
    pullNumber: "408",
    fetchImpl,
    env: { GH_TOKEN: "token" },
  });

  assert.equal(events.length, 101);
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "https://api.github.com/repos/owner/repo/issues/408/timeline?per_page=100&page=1",
      "https://api.github.com/repos/owner/repo/issues/408/timeline?per_page=100&page=2",
    ],
  );
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer token"));
});

test("a timeline GitHub won't give fails the gate's read", async () => {
  /** @type {typeof fetch} */
  const fetchImpl = async () => new Response("", { status: 403 });
  await assert.rejects(
    readTimeline({
      repository: "owner/repo",
      pullNumber: "408",
      fetchImpl,
      env: { GH_TOKEN: "token" },
    }),
    /GitHub answered 403 for GET \/issues\/408\/timeline/,
  );
});
