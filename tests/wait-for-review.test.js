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
const POLL = 4.5 * MINUTE;
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
 * A CI run on the head, made when it says, whose status is its latest try's.
 * @param {number} createdAt
 * @param {{ id?: number, status?: string }} [run]
 */
const ciRun = (createdAt, { id = 1, status = "in_progress" } = {}) => ({
  id,
  status,
  created_at: writeTime(createdAt),
});

/**
 * A job of a CI run's try.
 * @param {string} name
 * @param {string} status
 * @param {string | null} [conclusion]
 * @param {number} [attempt] the try it's listed in
 */
const job = (name, status, conclusion = null, attempt = 1) => ({
  name,
  status,
  conclusion,
  run_attempt: attempt,
});
const CHECKS = job("checks", "completed", "success");
const QUEUED = [CHECKS, job("review", "queued")];
const PASSED = [CHECKS, job("review", "completed", "success")];

/**
 * A page of a listing, with the Link header GitHub sends on every page but its last.
 * @param {any[]} items
 * @param {URL} url
 */
function answerPage(items, url) {
  const number = Number(url.searchParams.get("page"));
  const size = Number(url.searchParams.get("per_page"));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  /** @param {number} to @param {string} rel */
  const linkTo = (to, rel) =>
    `<https://api.github.com/repositories/1${url.pathname.replace(/^\/repos\/o\/r/, "")}?per_page=${size}&page=${to}>; rel="${rel}"`;
  const link = [linkTo(number + 1, "next"), linkTo(pageCount, "last")].join(", ");
  return {
    body: items.slice((number - 1) * size, number * size),
    headers: number < pageCount ? { link } : {},
  };
}

/**
 * A fetch that answers as GitHub does, and keeps each request. The pull request answers each of
 * its answers in turn, the last for every ask after it, and the head's CI runs and their jobs
 * answer for the time on the clock.
 * @param {object} answers
 * @param {{ sha: string, draft?: boolean }[]} [answers.pulls]
 * @param {number[]} [answers.readyAt] each time the pull request was marked ready for review
 * @param {number} [answers.earlierEvents] how many events came before the first of those
 * @param {(time: number) => any[]} [answers.runsAt] the head's CI runs, newest first
 * @param {(time: number, runId: number) => any[]} [answers.jobsAt] a run's jobs, in every try
 * @param {any[]} [answers.reviewComments]
 * @param {any[]} [answers.issueComments]
 * @param {{ status: number, headers: Record<string, string> }} [answers.refusal] what every ask
 *   answers instead
 * @param {() => number} [answers.now]
 */
function fakeGitHub({
  pulls = [{ sha: HEAD }],
  readyAt = [],
  earlierEvents = 1,
  runsAt = () => [ciRun(0)],
  jobsAt = () => PASSED,
  reviewComments = [],
  issueComments = [],
  refusal,
  now = () => 0,
}) {
  /** @type {{ url: string, headers: Record<string, string> }[]} */
  const requests = [];
  let pullAsks = 0;
  const events = [
    ...Array.from({ length: earlierEvents }, () => ({
      event: "labeled",
      created_at: writeTime(0),
    })),
    ...readyAt.flatMap((time) => [
      { event: "ready_for_review", created_at: writeTime(time) },
      { event: "review_requested", created_at: writeTime(time) },
    ]),
  ];
  /**
   * A run's jobs as filter=latest lists them: only its latest try's.
   * @param {any[]} jobs
   */
  const keepLatestTry = (jobs) => {
    const latest = Math.max(...jobs.map(({ run_attempt: attempt }) => attempt));
    return jobs.filter(({ run_attempt: attempt }) => attempt === latest);
  };
  /**
   * @param {URL} url
   * @returns {{ body: any, headers?: Record<string, string> }}
   */
  const answer = (url) => {
    const { pathname } = url;
    if (pathname.endsWith("/pulls/7")) {
      const { sha, draft = false } = pulls[Math.min(pullAsks++, pulls.length - 1)];
      return { body: { head: { sha }, draft } };
    }
    if (pathname.endsWith("/actions/workflows/ci.yml/runs")) {
      const runs = runsAt(now()).slice(0, Number(url.searchParams.get("per_page")));
      return { body: { workflow_runs: runs } };
    }
    const runJobs = pathname.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if (runJobs) {
      const jobs = jobsAt(now(), Number(runJobs[1]));
      const listed = url.searchParams.get("filter") === "latest" ? keepLatestTry(jobs) : jobs;
      const { body, headers } = answerPage(listed, url);
      return { body: { total_count: listed.length, jobs: body }, headers };
    }
    if (pathname.endsWith("/issues/7/events")) return answerPage(events, url);
    if (pathname.endsWith("/pulls/7/comments")) return answerPage(reviewComments, url);
    if (pathname.endsWith("/issues/7/comments")) return answerPage(issueComments, url);
    return { body: {} };
  };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url: url.pathname + url.search, headers: /** @type {any} */ (init?.headers) });
    if (refusal) return new Response("{}", refusal);
    const { body, headers } = answer(url);
    return new Response(JSON.stringify(body), { headers });
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
 * The requests whose path holds this.
 * @param {{ url: string }[]} requests
 * @param {string} path
 */
const listAsks = (requests, path) => requests.filter(({ url }) => url.includes(path));

test("it asks every few minutes until the review finishes, then lists every finding it posted on the head in full, from every page", async () => {
  const others = Array.from({ length: 100 }, () => ({ user: { login: "someone" }, body: "ok" }));
  const { requests, clock, options } = fakeWait({
    jobsAt: (time) => (time < 2 * POLL ? QUEUED : PASSED),
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
  assert.deepEqual(
    requests.slice(0, 4).map(({ url }) => url),
    [
      "/repos/o/r/pulls/7",
      "/repos/o/r/issues/7/events?per_page=100&page=1",
      `/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${HEAD}&per_page=1`,
      "/repos/o/r/actions/runs/1/jobs?filter=latest&per_page=100&page=1",
    ],
  );
  assert.ok(requests.some(({ url }) => url.includes("/pulls/7/comments?per_page=100&page=2")));
  assert.ok(requests.every(({ headers }) => !("authorization" in headers)));
});

test("a re-run of jobs the review doesn't need, after it passed, still says passed, from the review the run's latest try keeps", async () => {
  const review = { ...job("review", "completed", "success"), started_at: writeTime(10 * MINUTE) };
  const { clock, options } = fakeWait({
    runsAt: () => [{ ...ciRun(0), run_attempt: 2, run_started_at: writeTime(30 * MINUTE) }],
    jobsAt: () => [
      job("browser (1)", "completed", "failure"),
      job("check", "completed", "failure"),
      review,
      job("browser (1)", "in_progress", null, 2),
      job("check", "queued", null, 2),
      { ...review, run_attempt: 2 },
    ],
  });
  assert.equal((await reportReview(options)).code, EXIT_CODES.passed);
  assert.deepEqual(clock.waits, []);
});

test("a re-run of the review waits for the new try's, never judging the earlier try's", async () => {
  const earlierTry = [CHECKS, job("review", "completed", "failure")];
  const { clock, options } = fakeWait({
    jobsAt: (time) => [
      ...earlierTry,
      job("checks", "completed", "success", 2),
      time < 2 * POLL
        ? job("review", "in_progress", null, 2)
        : job("review", "completed", "success", 2),
    ],
  });
  assert.equal((await reportReview(options)).code, EXIT_CODES.passed);
  assert.equal(clock.now(), 2 * POLL);
});

test("a draft's run, whose review passed without reviewing, never counts: alone it waits, then says CI hasn't started, and a run made since the PR was marked ready counts once its review finishes", async () => {
  const start = HOUR;
  const readyAt = [start - 40 * MINUTE, start - MINUTE];
  const draftsRun = ciRun(start - 20 * MINUTE, { id: 1, status: "completed" });
  const alone = fakeWait({ readyAt, runsAt: () => [draftsRun] }, start);
  assert.deepEqual(await reportReview(alone.options), {
    code: EXIT_CODES.unstarted,
    lines: ["CI hasn't started on aaaaaaa: check the PR for a merge conflict."],
  });
  assert.equal(alone.clock.now() - start, POLL);
  assert.equal(listAsks(alone.requests, "/jobs").length, 0, "a draft's run's jobs aren't read");
  const readied = fakeWait(
    {
      readyAt,
      runsAt: (time) =>
        time < start + POLL ? [draftsRun] : [ciRun(start + 2 * MINUTE, { id: 2 }), draftsRun],
      jobsAt: (time, runId) => {
        if (runId === 1) return PASSED;
        return time < start + 2 * POLL ? QUEUED : [CHECKS, job("review", "completed", "failure")];
      },
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
    listAsks(readied.requests, "/actions/workflows/ci.yml/runs").length,
    2,
    "the head's CI run is asked for only until there is one",
  );
});

test("the events are read only from their last page, where the newest are, however many pages they run to", async () => {
  const start = HOUR;
  const draftsRun = ciRun(start - 20 * MINUTE, { status: "completed" });
  const { requests, options } = fakeWait(
    { readyAt: [start - MINUTE], earlierEvents: 250, runsAt: () => [draftsRun] },
    start,
  );
  assert.equal((await reportReview(options)).code, EXIT_CODES.unstarted);
  assert.deepEqual(
    listAsks(requests, "/issues/7/events").map(({ url }) => url),
    [
      "/repos/o/r/issues/7/events?per_page=100&page=1",
      "/repos/o/r/issues/7/events?per_page=100&page=3",
    ],
    "the first page, for where the listing ends, then its last",
  );
});

test("it stops waiting after about nine minutes, before a session's command times out, saying to run it again", async () => {
  const { requests, clock, options } = fakeWait({ jobsAt: () => QUEUED });
  const { code, lines } = await reportReview(options);
  assert.equal(code, EXIT_CODES.going);
  assert.deepEqual(lines, ["The review of aaaaaaa is still going: run this again to wait for it."]);
  assert.equal(clock.now(), 9 * MINUTE);
  assert.equal(
    requests.length,
    7,
    "the pull request and its events, the head's CI run, its jobs at each of three asks, and the pull request again",
  );
});

test("an hour of waits back to back stays within GitHub's 60 unsigned requests, with events over more than one page, and still reads the finished review's comments", async () => {
  const clock = fakeClock();
  const finishesAt = 57 * MINUTE;
  const { requests, readGitHub } = fakeGitHub({
    readyAt: [0],
    earlierEvents: 250,
    jobsAt: (time) => (time < finishesAt ? QUEUED : PASSED),
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
  assert.ok(listAsks(requests, "/issues/7/events?per_page=100&page=3").length >= 7);
  assert.ok(requests.length <= 60, `${requests.length} requests`);
  assert.match(requests.at(-1)?.url ?? "", /\/issues\/7\/comments/);
});

test("a newer push stops the wait on the head it replaced, even once that head's run is over", async () => {
  for (const jobsAt of [() => QUEUED, () => [CHECKS, job("review", "completed", "cancelled")]]) {
    const { options } = fakeWait({ pulls: [{ sha: HEAD }, { sha: NEWER }], jobsAt });
    assert.deepEqual(await reportReview(options), {
      code: EXIT_CODES.replaced,
      lines: [
        "aaaaaaa was replaced by a newer push bbbbbbb: run this again to wait for its review.",
      ],
    });
  }
});

test("a head CI hasn't started on a few minutes on says to look for a merge conflict, while one CI started on waits for its review, though the run has no review job yet", async () => {
  const unstarted = fakeWait({ runsAt: () => [] });
  assert.deepEqual(await reportReview(unstarted.options), {
    code: EXIT_CODES.unstarted,
    lines: ["CI hasn't started on aaaaaaa: check the PR for a merge conflict."],
  });
  assert.equal(unstarted.clock.now(), POLL);
  const started = fakeWait({ jobsAt: () => [CHECKS] });
  assert.equal((await reportReview(started.options)).code, EXIT_CODES.going);
});

test("a draft, at first or once the wait is under way, says it isn't reviewed until it's ready", async () => {
  for (const pulls of [[{ sha: HEAD, draft: true }], [{ sha: HEAD }, { sha: HEAD, draft: true }]]) {
    const { options } = fakeWait({ pulls, jobsAt: () => QUEUED });
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
