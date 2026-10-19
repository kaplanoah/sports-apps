import test from "node:test";
import assert from "node:assert/strict";
import { createGitHub } from "../worker/github-api.mjs";
import { writeFindingMark } from "../worker/review-state.mjs";
import {
  EXIT_CODES,
  describeLimit,
  listFindingComments,
  readRepository,
  reportReview,
} from "../worker/wait-for-review.mjs";

const HEAD = "a".repeat(40);
const NEWER = "b".repeat(40);
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
  body: `Nits and Pre-existing findings:\n\n- [ ] \`apps/mlb/page/js/app.js:3\`: **Nit** one\n  \`\`\`js\n  a();\n  \`\`\`\n  ${mark(HEAD)}\n- [ ] \`shared/page/tape.js\`: **Pre-existing** two\n  ${mark(HEAD)}`,
};
const OFF_DIFF = {
  user: BOT,
  body: `Findings on files this pull request doesn't change:\n\n- \`a.js:3\`: **Unsure** three\n\n${mark(HEAD)}`,
};

const QUEUED = [{ id: 1, status: "queued", conclusion: null }];
const PASSED = [{ id: 2, status: "completed", conclusion: "success" }];

/**
 * A fetch that answers as GitHub does, each of the pull request's and its review's check run's
 * answers in turn, the last for every ask after it, and keeps each request.
 * @param {object} answers
 * @param {{ sha: string, draft?: boolean }[]} [answers.pulls]
 * @param {any[][]} [answers.runs] the review's check runs each ask answers
 * @param {number} [answers.checks] how many check runs of any job the head has
 * @param {any[]} [answers.reviewComments]
 * @param {any[]} [answers.issueComments]
 * @param {{ status: number, headers: Record<string, string> }} [answers.refusal] what every ask
 *   answers instead
 */
function fakeGitHub({
  pulls = [{ sha: HEAD }],
  runs = [PASSED],
  checks = 1,
  reviewComments = [],
  issueComments = [],
  refusal,
}) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const requests = [];
  const asks = { pulls: 0, runs: 0 };
  /** @param {any[]} list @param {"pulls" | "runs"} kind */
  const nextOf = (list, kind) => list[Math.min(asks[kind]++, list.length - 1)];
  /** @param {any[]} items @param {URL} url */
  const page = (items, url) => {
    const number = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("per_page"));
    return items.slice((number - 1) * size, number * size);
  };
  /** @param {URL} url */
  const answer = (url) => {
    if (url.pathname.endsWith("/pulls/7")) {
      const { sha, draft = false } = nextOf(pulls, "pulls");
      return { head: { sha }, draft };
    }
    if (url.pathname.includes("/check-runs"))
      return url.searchParams.has("check_name")
        ? { check_runs: nextOf(runs, "runs") }
        : { total_count: checks, check_runs: [] };
    if (url.pathname.endsWith("/pulls/7/comments")) return page(reviewComments, url);
    if (url.pathname.endsWith("/issues/7/comments")) return page(issueComments, url);
    return {};
  };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.pathname + url.search, headers: /** @type {any} */ (init?.headers) });
    if (refusal) return new Response("{}", refusal);
    return new Response(JSON.stringify(answer(url)));
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

test("it waits about a minute between asks until the review finishes, then lists every finding it posted on the head in full, from every page", async () => {
  const others = Array.from({ length: 100 }, () => ({ user: { login: "someone" }, body: "ok" }));
  const { requests, readGitHub } = fakeGitHub({
    runs: [[], QUEUED, [{ id: 1, status: "completed", conclusion: "failure" }, ...PASSED]],
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
  const { code, lines } = await reportReview({ readGitHub, pullNumber: "7", ...clock });
  assert.equal(code, EXIT_CODES.passed);
  assert.deepEqual(clock.waits, [MINUTE, MINUTE]);
  assert.deepEqual(lines, [
    "The review of aaaaaaa passed, and posted 4 findings on it.",
    "- shared/page/sheet.js:12:",
    "  **Important** The sheet's title moves.",
    "",
    "  It shows on a reload.",
    "- apps/mlb/page/js/app.js:",
    "  Nits and Pre-existing findings:",
    "",
    "  - [ ] `apps/mlb/page/js/app.js:3`: **Nit** one",
    "    ```js",
    "    a();",
    "    ```",
    "  - [ ] `shared/page/tape.js`: **Pre-existing** two",
    "- the pull request:",
    "  Findings on files this pull request doesn't change:",
    "",
    "  - `a.js:3`: **Unsure** three",
  ]);
  assert.ok(requests.some(({ url }) => url.includes("/pulls/7/comments?per_page=100&page=2")));
  assert.ok(requests[1].url.startsWith(`/repos/o/r/commits/${HEAD}/check-runs?check_name=review`));
  assert.ok(requests.every(({ headers }) => !("authorization" in headers)));
});

test("it stops waiting after about nine minutes, before a session's command times out, saying to run it again", async () => {
  const { requests, readGitHub } = fakeGitHub({ runs: [QUEUED] });
  const clock = fakeClock();
  const { code, lines } = await reportReview({ readGitHub, pullNumber: "7", ...clock });
  assert.equal(code, EXIT_CODES.going);
  assert.deepEqual(lines, ["The review of aaaaaaa is still going: run this again to wait for it."]);
  assert.equal(clock.now(), 9 * MINUTE);
  assert.equal(requests.length, 21, "the pull request, then it and the review's run ten times");
});

test("a review that didn't pass says so, and one that posted nothing says that", async () => {
  const { readGitHub } = fakeGitHub({
    runs: [[{ id: 3, status: "completed", conclusion: "failure" }]],
    reviewComments: [{ ...INLINE, body: `**Nit** an earlier head's\n\n${mark(EARLIER)}` }],
  });
  assert.deepEqual(await reportReview({ readGitHub, pullNumber: "7", ...fakeClock() }), {
    code: EXIT_CODES.failed,
    lines: [
      "The review of aaaaaaa didn't pass (failure): read its summary, and posted 0 findings on it.",
    ],
  });
});

test("a newer push stops the wait on the head it replaced, even once that head's run is over", async () => {
  for (const runs of [[QUEUED], [[{ id: 3, status: "completed", conclusion: "cancelled" }]]]) {
    const { readGitHub } = fakeGitHub({ pulls: [{ sha: HEAD }, { sha: NEWER }], runs });
    assert.deepEqual(await reportReview({ readGitHub, pullNumber: "7", ...fakeClock() }), {
      code: EXIT_CODES.replaced,
      lines: [
        "aaaaaaa was replaced by a newer push bbbbbbb: run this again to wait for its review.",
      ],
    });
  }
});

test("a head CI hasn't started on a few minutes on says to look for a merge conflict, while one CI started on waits for its review", async () => {
  const unstarted = fakeGitHub({ runs: [[]], checks: 0 });
  const clock = fakeClock();
  assert.deepEqual(
    await reportReview({ readGitHub: unstarted.readGitHub, pullNumber: "7", ...clock }),
    {
      code: EXIT_CODES.unstarted,
      lines: ["CI hasn't started on aaaaaaa: check the PR for a merge conflict."],
    },
  );
  assert.equal(clock.now(), 3 * MINUTE);
  const started = fakeGitHub({ runs: [[]], checks: 30 });
  const { code } = await reportReview({
    readGitHub: started.readGitHub,
    pullNumber: "7",
    ...fakeClock(),
  });
  assert.equal(code, EXIT_CODES.going);
  assert.equal(
    started.requests.filter(({ url }) => url.includes("check-runs?per_page=1")).length,
    1,
    "whether CI started is asked once",
  );
});

test("a draft, at first or once the wait is under way, says it isn't reviewed until it's ready", async () => {
  for (const pulls of [[{ sha: HEAD, draft: true }], [{ sha: HEAD }, { sha: HEAD, draft: true }]]) {
    const { readGitHub } = fakeGitHub({ pulls, runs: [QUEUED] });
    assert.deepEqual(await reportReview({ readGitHub, pullNumber: "7", ...fakeClock() }), {
      code: EXIT_CODES.draft,
      lines: ["#7 is a draft, and a draft isn't reviewed until it's marked ready."],
    });
  }
});

test("a used-up limit says when it resets, without a stack trace, and any other refusal stops it", async () => {
  const resetsAt = Date.UTC(2026, 9, 19, 12, 30) / 1000;
  for (const status of [403, 429]) {
    const { readGitHub } = fakeGitHub({
      refusal: { status, headers: { "x-ratelimit-reset": String(resetsAt) } },
    });
    const now = () => (resetsAt - 22.5 * 60) * 1000;
    assert.deepEqual(
      await reportReview({ readGitHub, pullNumber: "7", wait: async () => {}, now }),
      {
        code: EXIT_CODES.limited,
        lines: [
          "GitHub's limit of 60 requests an hour for this address is used up: run this again in 23 minutes, once it resets.",
        ],
      },
    );
  }
  const { readGitHub } = fakeGitHub({ refusal: { status: 502, headers: {} } });
  await assert.rejects(
    reportReview({ readGitHub, pullNumber: "7", ...fakeClock() }),
    /GitHub answered 502/,
  );
  assert.equal(
    describeLimit(null, 0),
    "GitHub's limit of 60 requests an hour for this address is used up: run this again within the hour.",
  );
});

test("every way the wait ends exits with a code of its own", () => {
  const codes = Object.values(EXIT_CODES);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(EXIT_CODES.passed, 0);
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
