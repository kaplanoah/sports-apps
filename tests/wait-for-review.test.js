import test from "node:test";
import assert from "node:assert/strict";
import { createGitHub } from "../worker/github-api.mjs";
import { writeFindingMark } from "../worker/review-state.mjs";
import { describeReview, listFindingComments, readRepository } from "../worker/wait-for-review.mjs";

const HEAD = "a".repeat(40);
const EARLIER = "e".repeat(40);
const KEY = "0".repeat(16);
const BOT = { login: "github-actions[bot]" };
const MINUTE = 60 * 1000;

const mark = (/** @type {string} */ head) => writeFindingMark(KEY, head);

const INLINE = {
  user: BOT,
  path: "shared/page/sheet.js",
  line: null,
  original_line: 12,
  body: `**Important** The sheet's title moves.\n\nIt shows on a reload.\n\n${mark(HEAD)}`,
};
const CHECKLIST = {
  user: BOT,
  path: "apps/mlb/page/js/app.js",
  line: null,
  original_line: null,
  body: `Nits and Pre-existing findings:\n\n- [ ] \`apps/mlb/page/js/app.js:3\`: **Nit** one ${mark(HEAD)}\n- [ ] \`shared/page/tape.js\`: **Pre-existing** two ${mark(HEAD)}`,
};
const OFF_DIFF = {
  user: BOT,
  body: `Findings on files this pull request doesn't change:\n\n- \`a.js:3\`: **Unsure** three\n\n${mark(HEAD)}`,
};

/**
 * A fetch that answers as GitHub does for a pull request whose review's check run reads as each
 * answer in turn, the last for every ask after it, and keeps each request.
 * @param {object} answers
 * @param {any[]} answers.runs the check runs each ask answers
 * @param {any[]} answers.reviewComments
 * @param {any[]} answers.issueComments
 */
function fakeGitHub({ runs, reviewComments, issueComments }) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const requests = [];
  let asks = 0;
  /** @param {any[]} items @param {URL} url */
  const page = (items, url) => {
    const number = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("per_page"));
    return items.slice((number - 1) * size, number * size);
  };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.pathname + url.search, headers: /** @type {any} */ (init?.headers) });
    /** @type {unknown} */
    let answer = {};
    if (url.pathname.endsWith("/pulls/7")) answer = { head: { sha: HEAD } };
    else if (url.pathname.includes("/check-runs")) {
      answer = { check_runs: runs[Math.min(asks, runs.length - 1)] };
      asks += 1;
    } else if (url.pathname.endsWith("/pulls/7/comments")) answer = page(reviewComments, url);
    else if (url.pathname.endsWith("/issues/7/comments")) answer = page(issueComments, url);
    return new Response(JSON.stringify(answer));
  };
  return { requests, readGitHub: createGitHub({ repository: "o/r", fetchImpl, env: {} }) };
}

/** A clock that a wait moves on, and the waits it was asked for. */
function fakeClock() {
  let time = 0;
  /** @type {number[]} */
  const waits = [];
  return {
    waits,
    now: () => time,
    wait: async (/** @type {number} */ ms) => {
      waits.push(ms);
      time += ms;
    },
  };
}

test("it waits about a minute between asks until the review finishes, then lists every finding it posted on the head, from every page", async () => {
  const others = Array.from({ length: 100 }, () => ({ user: { login: "someone" }, body: "ok" }));
  const { requests, readGitHub } = fakeGitHub({
    runs: [
      [],
      [{ id: 1, status: "in_progress", conclusion: null }],
      [
        { id: 1, status: "completed", conclusion: "failure" },
        { id: 2, status: "completed", conclusion: "success" },
      ],
    ],
    reviewComments: [
      ...others,
      INLINE,
      CHECKLIST,
      { ...INLINE, in_reply_to_id: 4, body: `a reply ${mark(HEAD)}` },
      { ...INLINE, body: `**Nit** an earlier head's\n\n${mark(EARLIER)}` },
      { ...INLINE, user: { login: "someone" } },
    ],
    issueComments: [OFF_DIFF, { user: BOT, body: "<!-- claude-review-summary -->" }],
  });
  const clock = fakeClock();
  const lines = await describeReview({ readGitHub, pullNumber: "7", ...clock });
  assert.deepEqual(clock.waits, [MINUTE, MINUTE]);
  assert.deepEqual(lines, [
    "The review of aaaaaaa passed, and posted 4 findings on it.",
    "- shared/page/sheet.js:12: **Important** The sheet's title moves.",
    "- apps/mlb/page/js/app.js: Nits and Pre-existing findings:",
    "  - [ ] `apps/mlb/page/js/app.js:3`: **Nit** one",
    "  - [ ] `shared/page/tape.js`: **Pre-existing** two",
    "- the pull request: Findings on files this pull request doesn't change:",
    "  - `a.js:3`: **Unsure** three",
  ]);
  assert.ok(requests.some(({ url }) => url.includes("/pulls/7/comments?per_page=100&page=2")));
  assert.ok(requests[1].url.startsWith(`/repos/o/r/commits/${HEAD}/check-runs?check_name=review`));
  assert.ok(requests.every(({ headers }) => !("authorization" in headers)));
});

test("it stops waiting after about nine minutes, before a session's command times out, saying to run it again", async () => {
  const { requests, readGitHub } = fakeGitHub({
    runs: [[{ id: 1, status: "queued", conclusion: null }]],
    reviewComments: [],
    issueComments: [],
  });
  const clock = fakeClock();
  const lines = await describeReview({ readGitHub, pullNumber: "7", ...clock });
  assert.deepEqual(lines, ["The review of aaaaaaa is still going: run this again to wait for it."]);
  assert.equal(clock.now(), 9 * MINUTE);
  assert.equal(requests.length, 11, "the head, and ten asks of the review's check run");
});

test("a review that didn't pass says so, and one that posted nothing says that", async () => {
  const { readGitHub } = fakeGitHub({
    runs: [[{ id: 3, status: "completed", conclusion: "failure" }]],
    reviewComments: [{ ...INLINE, body: `**Nit** an earlier head's\n\n${mark(EARLIER)}` }],
    issueComments: [],
  });
  assert.deepEqual(await describeReview({ readGitHub, pullNumber: "7", ...fakeClock() }), [
    "The review of aaaaaaa didn't pass (failure): read its summary, and posted 0 findings on it.",
  ]);
});

test("the comments of findings are the review's own on the head, never a reply, each counted by its findings", () => {
  assert.deepEqual(
    listFindingComments([INLINE, CHECKLIST, { ...CHECKLIST, in_reply_to_id: 1 }], HEAD).map(
      ({ spot, count }) => [spot, count],
    ),
    [
      ["shared/page/sheet.js:12", 1],
      ["apps/mlb/page/js/app.js", 2],
    ],
  );
});

test("the repository is read from the clone's origin, on GitHub or through a cloud session's proxy", () => {
  assert.equal(
    readRepository("https://github.com/kaplanoah/sports-apps\n"),
    "kaplanoah/sports-apps",
  );
  assert.equal(readRepository("git@github.com:kaplanoah/sports-apps.git"), "kaplanoah/sports-apps");
  assert.equal(
    readRepository("http://local_proxy@127.0.0.1:41000/git/kaplanoah/sports-apps"),
    "kaplanoah/sports-apps",
  );
  assert.throws(() => readRepository(""), /names no repository/);
});
