import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
const POLL = 3 * MINUTE;
const HOUR = 60 * MINUTE;

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

/** @param {number} time */
const writeTime = (time) => new Date(time).toISOString();

/**
 * A review check run, which started when it says.
 * @param {string} status
 * @param {string | null} [conclusion]
 * @param {{ id?: number, startedAt?: number }} [run]
 */
const reviewRun = (status, conclusion = null, { id = 2, startedAt = 0 } = {}) => ({
  id,
  status,
  conclusion,
  started_at: writeTime(startedAt),
});
const QUEUED = [reviewRun("queued")];
const PASSED = [reviewRun("completed", "success")];

/**
 * The head's CI run, whose current try started when it says.
 * @param {number} startedAt
 */
const ciRun = (startedAt) => ({ id: 1, run_started_at: writeTime(startedAt) });

/**
 * A fetch that answers as GitHub does, and keeps each request. The pull request answers each of
 * its answers in turn, the last for every ask after it, and the review's check runs and the head's
 * CI runs answer for the time on the clock.
 * @param {object} answers
 * @param {{ sha: string, draft?: boolean }[]} [answers.pulls]
 * @param {number[]} [answers.readyAt] each time the pull request was marked ready for review
 * @param {(time: number) => any[]} [answers.runsAt] the review's check runs
 * @param {(time: number) => any[]} [answers.ciRunsAt] the head's CI runs, newest first
 * @param {any[]} [answers.reviewComments]
 * @param {any[]} [answers.issueComments]
 * @param {{ status: number, headers: Record<string, string> }} [answers.refusal] what every ask
 *   answers instead
 * @param {() => number} [answers.now]
 */
function fakeGitHub({
  pulls = [{ sha: HEAD }],
  readyAt = [],
  runsAt = () => PASSED,
  ciRunsAt = () => [ciRun(0)],
  reviewComments = [],
  issueComments = [],
  refusal,
  now = () => 0,
}) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const requests = [];
  let pullAsks = 0;
  const events = [
    { event: "labeled", created_at: writeTime(0) },
    ...readyAt.flatMap((time) => [
      { event: "ready_for_review", created_at: writeTime(time) },
      { event: "review_requested", created_at: writeTime(time) },
    ]),
  ];
  /** @param {any[]} items @param {URL} url */
  const page = (items, url) => {
    const number = Number(url.searchParams.get("page"));
    const size = Number(url.searchParams.get("per_page"));
    return items.slice((number - 1) * size, number * size);
  };
  /** @param {URL} url */
  const answer = (url) => {
    if (url.pathname.endsWith("/pulls/7")) {
      const { sha, draft = false } = pulls[Math.min(pullAsks++, pulls.length - 1)];
      return { head: { sha }, draft };
    }
    if (url.pathname.endsWith("/check-runs")) return { check_runs: runsAt(now()) };
    if (url.pathname.endsWith("/actions/workflows/ci.yml/runs"))
      return { workflow_runs: ciRunsAt(now()).slice(0, Number(url.searchParams.get("per_page"))) };
    if (url.pathname.endsWith("/issues/7/events")) return page(events, url);
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

/**
 * A clock that a wait moves on, from the time it starts at, and the waits it was asked for.
 * @param {number} [start]
 */
function fakeClock(start = 0) {
  let time = start;
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

/**
 * The fake GitHub and clock for a wait, the GitHub answering for the clock's time.
 * @param {Parameters<typeof fakeGitHub>[0]} answers
 * @param {number} [start] when the wait starts
 */
function fakeWait(answers, start = 0) {
  const clock = fakeClock(start);
  const github = fakeGitHub({ ...answers, now: clock.now });
  return {
    ...github,
    clock,
    options: { readGitHub: github.readGitHub, pullNumber: "7", ...clock },
  };
}

/**
 * How many of the requests asked for the head's CI runs.
 * @param {{ url: string }[]} requests
 */
const countCiRunAsks = (requests) =>
  requests.filter(({ url }) => url.includes("/actions/workflows/ci.yml/runs")).length;

test("it asks every few minutes until the review finishes, then lists every finding it posted on the head in full, from every page", async () => {
  const others = Array.from({ length: 100 }, () => ({ user: { login: "someone" }, body: "ok" }));
  const { requests, clock, options } = fakeWait({
    runsAt: (time) => (time < 2 * POLL ? QUEUED : PASSED),
    reviewComments: [
      ...others,
      INLINE,
      CHECKLIST,
      { ...INLINE, in_reply_to_id: 4, body: `a reply\n\n${mark(HEAD)}` },
      { ...INLINE, body: `**Nit** an earlier head's\n\n${mark(EARLIER)}` },
      { ...INLINE, user: { login: "someone" } },
    ],
    issueComments: [OFF_DIFF, { user: BOT, body: "<!-- claude-review-summary -->" }],
  });
  const { code, lines } = await reportReview(options);
  assert.equal(code, EXIT_CODES.passed);
  assert.deepEqual(clock.waits, [POLL, POLL]);
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
  assert.ok(requests[2].url.startsWith(`/repos/o/r/commits/${HEAD}/check-runs?check_name=review`));
  assert.ok(requests.every(({ headers }) => !("authorization" in headers)));
});

test("a draft's run, whose review passed without reviewing, never counts: alone it ends as CI not started, and a run since the PR was marked ready counts once its review finishes", async () => {
  const start = HOUR;
  const readyAt = [start - 40 * MINUTE, start - MINUTE];
  const draftsReview = reviewRun("completed", "success", { id: 1, startedAt: start - 15 * MINUTE });
  const draftsRun = ciRun(start - 20 * MINUTE);
  const alone = fakeWait(
    { readyAt, runsAt: () => [draftsReview], ciRunsAt: () => [draftsRun] },
    start,
  );
  assert.deepEqual(await reportReview(alone.options), {
    code: EXIT_CODES.unstarted,
    lines: ["CI hasn't started on aaaaaaa: check the PR for a merge conflict."],
  });
  assert.equal(alone.clock.now() - start, POLL);
  const readied = fakeWait(
    {
      readyAt,
      runsAt: (time) =>
        time < start + 2 * POLL
          ? [draftsReview]
          : [reviewRun("completed", "failure", { startedAt: start + 5 * MINUTE }), draftsReview],
      ciRunsAt: () => [ciRun(start - 30 * 1000), draftsRun],
    },
    start,
  );
  assert.deepEqual(await reportReview(readied.options), {
    code: EXIT_CODES.failed,
    lines: [
      "The review of aaaaaaa didn't pass (failure): read its summary, and posted 0 findings on it.",
    ],
  });
  assert.equal(readied.clock.now() - start, 2 * POLL);
  assert.equal(
    countCiRunAsks(readied.requests),
    3,
    "each review judged once, and whether CI started since the PR was marked ready asked once",
  );
});

test("a re-run's earlier failed review, in the same CI run, doesn't count, and the wait goes on to the new try's", async () => {
  const start = HOUR;
  const earlierTry = reviewRun("completed", "failure", { id: 1, startedAt: start - 20 * MINUTE });
  const { clock, requests, options } = fakeWait(
    {
      runsAt: (time) =>
        time < start + 3 * POLL
          ? [earlierTry]
          : [reviewRun("completed", "success", { startedAt: start + 8 * MINUTE }), earlierTry],
      ciRunsAt: () => [ciRun(start - 2 * MINUTE)],
    },
    start,
  );
  assert.equal((await reportReview(options)).code, EXIT_CODES.passed);
  assert.equal(clock.now() - start, 3 * POLL);
  assert.equal(countCiRunAsks(requests), 3, "judged once each, and whether CI started once");
});

test("it stops waiting after about nine minutes, before a session's command times out, saying to run it again", async () => {
  const { requests, clock, options } = fakeWait({ runsAt: () => QUEUED });
  const { code, lines } = await reportReview(options);
  assert.equal(code, EXIT_CODES.going);
  assert.deepEqual(lines, ["The review of aaaaaaa is still going: run this again to wait for it."]);
  assert.equal(clock.now(), 9 * MINUTE);
  assert.equal(
    requests.length,
    7,
    "the pull request and its events, four asks, and the pull request again",
  );
});

test("an hour of waits back to back stays within GitHub's 60 unsigned requests, and still reads the finished review's comments", async () => {
  const clock = fakeClock();
  const finishesAt = 57 * MINUTE;
  const { requests, readGitHub } = fakeGitHub({
    runsAt: (time) =>
      time < finishesAt ? [] : [reviewRun("completed", "success", { startedAt: finishesAt })],
    reviewComments: [INLINE],
    issueComments: [OFF_DIFF],
    now: clock.now,
  });
  let code = /** @type {number} */ (EXIT_CODES.going);
  let waits = 0;
  while (code === EXIT_CODES.going) {
    ({ code } = await reportReview({ readGitHub, pullNumber: "7", ...clock }));
    waits += 1;
  }
  assert.equal(code, EXIT_CODES.passed);
  assert.ok(waits >= 7, `${waits} waits`);
  assert.ok(clock.now() >= finishesAt && clock.now() < 60 * MINUTE + POLL);
  assert.ok(requests.length <= 60, `${requests.length} requests`);
  assert.match(requests.at(-1)?.url ?? "", /\/issues\/7\/comments/);
});

test("a newer push stops the wait on the head it replaced, even once that head's run is over", async () => {
  for (const runsAt of [() => QUEUED, () => [reviewRun("completed", "cancelled")]]) {
    const { options } = fakeWait({ pulls: [{ sha: HEAD }, { sha: NEWER }], runsAt });
    assert.deepEqual(await reportReview(options), {
      code: EXIT_CODES.replaced,
      lines: [
        "aaaaaaa was replaced by a newer push bbbbbbb: run this again to wait for its review.",
      ],
    });
  }
});

test("a head CI hasn't started on a few minutes on says to look for a merge conflict, while one CI started on waits for its review", async () => {
  const unstarted = fakeWait({ runsAt: () => [], ciRunsAt: () => [] });
  assert.deepEqual(await reportReview(unstarted.options), {
    code: EXIT_CODES.unstarted,
    lines: ["CI hasn't started on aaaaaaa: check the PR for a merge conflict."],
  });
  assert.equal(unstarted.clock.now(), POLL);
  const started = fakeWait({ runsAt: () => [] });
  assert.equal((await reportReview(started.options)).code, EXIT_CODES.going);
  assert.equal(countCiRunAsks(started.requests), 1, "whether CI started is asked once");
});

test("a draft, at first or once the wait is under way, says it isn't reviewed until it's ready", async () => {
  for (const pulls of [[{ sha: HEAD, draft: true }], [{ sha: HEAD }, { sha: HEAD, draft: true }]]) {
    const { options } = fakeWait({ pulls, runsAt: () => QUEUED });
    assert.deepEqual(await reportReview(options), {
      code: EXIT_CODES.draft,
      lines: ["#7 is a draft, and a draft isn't reviewed until it's marked ready."],
    });
  }
});

test("a used-up limit says which and when it lets requests through, a secondary one says when it names, without a stack trace, and any other refusal stops it", async () => {
  const resetsAt = Date.UTC(2026, 9, 19, 12, 30) / 1000;
  const now = () => (resetsAt - 22.5 * 60) * 1000;
  const limits = { "x-ratelimit-reset": String(resetsAt), "x-ratelimit-limit": "60" };
  // A wait GitHub names counts from when it answered, the machine's own time.
  for (const [refusal, clockNow, said] of /** @type {[any, () => number, string][]} */ ([
    [
      { status: 403, headers: { ...limits, "x-ratelimit-remaining": "0" } },
      now,
      "GitHub's limit of 60 requests an hour is used up: run this again in 23 minutes, once it lets requests through.",
    ],
    [
      { status: 429, headers: { ...limits, "x-ratelimit-remaining": "5" } },
      now,
      "GitHub is holding back requests: run this again in a minute.",
    ],
    [
      { status: 403, headers: { ...limits, "x-ratelimit-remaining": "5", "retry-after": "120" } },
      Date.now,
      "GitHub is holding back requests: run this again in 2 minutes, once it lets requests through.",
    ],
  ])) {
    const { readGitHub } = fakeGitHub({ refusal });
    assert.deepEqual(
      await reportReview({ readGitHub, pullNumber: "7", wait: async () => {}, now: clockNow }),
      { code: EXIT_CODES.limited, lines: [said] },
    );
  }
  for (const refusal of [
    { status: 403, headers: { "x-ratelimit-remaining": "40" } },
    { status: 502, headers: {} },
  ]) {
    const { readGitHub } = fakeGitHub({ refusal });
    await assert.rejects(
      reportReview({ readGitHub, pullNumber: "7", ...fakeClock() }),
      new RegExp(`GitHub answered ${refusal.status}`),
    );
  }
  assert.equal(
    describeLimit({ limit: null, resetsAt: null }, 0),
    "GitHub is holding back requests: run this again in a minute.",
  );
});

test("each way the wait ends exits with the code its top comment names", () => {
  assert.deepEqual(EXIT_CODES, {
    passed: 0,
    failed: 1,
    going: 2,
    replaced: 3,
    unstarted: 4,
    draft: 5,
    limited: 6,
    usage: 7,
  });
  const script = fileURLToPath(new URL("../worker/wait-for-review.mjs", import.meta.url));
  for (const args of [[], ["seven"]])
    assert.equal(spawnSync(process.execPath, [script, ...args]).status, EXIT_CODES.usage);
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
