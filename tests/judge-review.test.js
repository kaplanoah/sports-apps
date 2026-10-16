import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  SUMMARY_MARKER,
  coversEveryLine,
  findUnreadParts,
  judgeReview,
  listPostedWeights,
  listReads,
  postSummary,
  readAnswer,
  recordShareTry,
} from "../worker/judge-review.mjs";
import { writeReview } from "../worker/plan-review.mjs";

/**
 * The SDK's messages for a run that read each file as given, its Read numbered by its place.
 * @param {{ file_path: string, offset?: number, limit?: number, isError?: boolean }[]} reads
 */
const runReading = (reads) =>
  reads.flatMap(({ isError, ...input }, index) => [
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: `read-${index}`, name: "Read", input }] },
    },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: `read-${index}`, is_error: isError }],
      },
    },
  ]);

test("each Read is the lines it returned, and a Read that failed returned none", () => {
  const reads = listReads([
    ...runReading([
      { file_path: "/w/a.diff" },
      { file_path: "/w/b.diff", offset: 1001, limit: 500 },
      { file_path: "/w/c.diff", isError: true },
    ]),
    { type: "assistant", message: { content: [{ type: "tool_use", id: "g", name: "Grep" }] } },
  ]);
  assert.deepEqual(
    [...reads],
    [
      ["/w/a.diff", [[1, 2000]]],
      ["/w/b.diff", [[1001, 1500]]],
    ],
  );
});

test("reads cover a file only when no line between them goes unread", () => {
  assert.ok(coversEveryLine([[1, 2000]], 1000));
  assert.ok(
    coversEveryLine(
      [
        [401, 900],
        [1, 400],
      ],
      900,
    ),
  );
  assert.ok(!coversEveryLine([[1, 400]], 900));
  assert.ok(
    !coversEveryLine(
      [
        [1, 400],
        [402, 900],
      ],
      900,
    ),
  );
  assert.ok(!coversEveryLine([], 1));
});

test("a part read in pieces over two tries is read, and one never opened isn't", () => {
  const folder = "/w";
  const firstTry = [...listReads(runReading([{ file_path: "/w/diffs/a.js.diff", limit: 3 }]))];
  const secondTry = [
    ...listReads(runReading([{ file_path: "/w/diffs/a.js.diff", offset: 4, limit: 10 }])),
  ];
  const readPart = () => "1\n2\n3\n4\n5\n";
  assert.deepEqual(
    findUnreadParts(
      ["diffs/a.js.diff", "diffs/b.js.diff"],
      [firstTry, secondTry],
      readPart,
      folder,
    ),
    ["diffs/b.js.diff"],
  );
  assert.deepEqual(findUnreadParts(["diffs/a.js.diff"], [firstTry], readPart, folder), [
    "diffs/a.js.diff",
  ]);
});

test("a reviewer's answer is empty when it gave none or gave something else", () => {
  const empty = { notes: [], unjudged: [] };
  assert.deepEqual(readAnswer(undefined), empty);
  assert.deepEqual(readAnswer("not json"), empty);
  assert.deepEqual(readAnswer('{"notes": "many"}'), empty);
  assert.deepEqual(readAnswer('{"notes": ["see the WNBA copy"]}'), {
    ...empty,
    notes: ["see the WNBA copy"],
  });
});

test("a share's tries are kept, and only the parts no try read stay unread", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeReview(folder, {
    numstat: "1\t0\ta.js\n1\t0\tb.js\n",
    diff: [
      ...["a.js", "b.js"].flatMap((path) => [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,0 +1 @@",
        "+x",
      ]),
      "",
    ].join("\n"),
  });
  const execution = join(folder, "execution.json");
  const runOn = (/** @type {string} */ part) =>
    writeFileSync(execution, JSON.stringify(runReading([{ file_path: resolve(folder, part) }])));
  runOn("diffs/a.js.diff");
  assert.deepEqual(
    recordShareTry(folder, 1, {
      EXECUTION_FILE: execution,
      STRUCTURED_OUTPUT: '{"notes":["a.js reads the store the other app writes"]}',
    }),
    ["diffs/b.js.diff"],
  );
  runOn("diffs/b.js.diff");
  assert.deepEqual(recordShareTry(folder, 1, { EXECUTION_FILE: execution }), []);
  const record = JSON.parse(readFileSync(join(folder, "share-1.json"), "utf8"));
  assert.equal(record.tries.length, 2);
  assert.deepEqual(record.tries[0].answer.notes, ["a.js reads the store the other app writes"]);
});

test("a try that left no execution file read nothing", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeReview(folder, {
    numstat: "1\t0\ta.js\n",
    diff: "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,0 +1 @@\n+x\n",
  });
  assert.deepEqual(recordShareTry(folder, 1, { EXECUTION_FILE: join(folder, "none.json") }), [
    "diffs/a.js.diff",
  ]);
});

const PLAN = {
  shares: [
    { share: 1, files: ["a.js"], partsByFile: { "a.js": ["diffs/a.js.diff"] } },
    {
      share: 2,
      files: ["b.js", "c.js"],
      partsByFile: {
        "b.js": ["diffs/b.js.part-1.diff", "diffs/b.js.part-2.diff"],
        "c.js": ["diffs/c.js.diff"],
      },
    },
  ],
  unread: [{ path: "package-lock.json", why: "the lockfile, which npm writes" }],
};

/** @param {object} answer */
const recordOf = (answer, unread = /** @type {string[]} */ ([])) => ({
  tries: [{ reads: [], answer: { notes: [], unjudged: [], ...answer } }],
  unread,
});

test("a review that read every file passes, counting its findings by weight", () => {
  const { isComplete, body } = judgeReview({
    sha: "abc123",
    plan: PLAN,
    records: new Map([
      [1, recordOf({})],
      [2, recordOf({ unjudged: [{ file: "c.js", why: "only an iPhone shows it" }] })],
    ]),
    across: { notes: [], unjudged: [] },
    weights: ["Important", "Nit", "Important"],
  });
  assert.ok(isComplete);
  assert.ok(body.startsWith(SUMMARY_MARKER));
  assert.match(body, /Claude reviewed abc123 in 2 shares: 3 findings \(2 Important, 1 Nit\)/);
  assert.match(body, /Read in full: 3 of 3 changed files to read\./);
  assert.match(body, /- `package-lock.json`: the lockfile, which npm writes/);
  assert.match(body, /- `c.js`: only an iPhone shows it/);
  assert.doesNotMatch(body, /fails/);
});

test("a file with a part its reviewer never read fails the review and is named", () => {
  const { isComplete, body } = judgeReview({
    sha: "abc123",
    plan: PLAN,
    records: new Map([
      [1, recordOf({})],
      [2, recordOf({}, ["diffs/b.js.part-2.diff"])],
    ]),
    across: { notes: [], unjudged: [] },
    weights: [],
  });
  assert.ok(!isComplete);
  assert.match(body, /Read in full: 2 of 3 changed files/);
  assert.match(body, /a reviewer didn't read every line of them, so the review fails/);
  assert.match(body, /- `b.js`/);
  assert.doesNotMatch(body, /- `c.js`/);
});

test("a share that never finished leaves its files unread and fails the review", () => {
  const { isComplete, body } = judgeReview({
    sha: "abc123",
    plan: PLAN,
    records: new Map([[1, recordOf({})]]),
    across: { notes: [], unjudged: [] },
    weights: [],
  });
  assert.ok(!isComplete);
  assert.match(body, /1 share didn't finish/);
  assert.match(body, /- `b.js`\n- `c.js`/);
});

test("a share that never finished and one read only in part are each named for their own reason", () => {
  const plan = {
    shares: [
      ...PLAN.shares,
      { share: 3, files: ["d.js"], partsByFile: { "d.js": ["diffs/d.js.diff"] } },
    ],
    unread: [],
  };
  const { body } = judgeReview({
    sha: "abc123",
    plan,
    records: new Map([
      [2, recordOf({}, ["diffs/c.js.diff"])],
      [3, recordOf({})],
    ]),
    across: { notes: [], unjudged: [] },
    weights: [],
  });
  assert.match(
    body,
    /1 share didn't finish, so the review fails until a re-run reads them:\*\*\n- `a.js`\n\n/,
  );
  assert.match(
    body,
    /a reviewer didn't read every line of them, so the review fails until a re-run reads them:\*\*\n- `c.js`$/m,
  );
});

test("with more than one share, the review fails until the check across them finishes", () => {
  const records = new Map([
    [1, recordOf({})],
    [2, recordOf({})],
  ]);
  const { isComplete, body } = judgeReview({
    sha: "abc123",
    plan: PLAN,
    records,
    across: null,
    weights: [],
  });
  assert.ok(!isComplete);
  assert.match(body, /The check across shares didn't finish/);
  const oneShare = { shares: [PLAN.shares[0]], unread: [] };
  const single = judgeReview({
    sha: "abc123",
    plan: oneShare,
    records: new Map([[1, recordOf({})]]),
    across: null,
    weights: [],
  });
  assert.ok(single.isComplete);
  assert.match(single.body, /in 1 share: no findings/);
});

test("the findings counted are the review's own comments on the commit, each by its weight", () => {
  const reviewer = "github-actions[bot]";
  const comment = (/** @type {object} */ fields) => ({
    user: { login: reviewer },
    commit_id: "abc123",
    original_commit_id: "abc123",
    body: "**Important** The second try reads stale comments.",
    ...fields,
  });
  const weights = listPostedWeights(
    [
      comment({}),
      comment({ body: "**Unsure:** A part may pass Read's token cap." }),
      comment({ body: "**Nit** The comment overstates it.", commit_id: "def456" }),
      comment({ original_commit_id: "old999" }),
      comment({ user: { login: "kaplanoah" } }),
      comment({ in_reply_to_id: 7 }),
      comment({ body: "A comment with no weight" }),
    ],
    { sha: "abc123", author: reviewer },
  );
  assert.deepEqual(weights, ["Important", "Unsure", "Nit"]);
});

test("a change of only recorded data passes, naming what it left unread", () => {
  const { isComplete, body } = judgeReview({
    sha: "abc123",
    plan: { shares: [], unread: [{ path: "a.json", why: "a test's recorded data" }] },
    records: new Map(),
    across: null,
    weights: [],
  });
  assert.ok(isComplete);
  assert.match(body, /Claude had nothing to read in abc123\.\n\nLeft unread/);
  assert.match(body, /- `a.json`: a test's recorded data/);
});

test("the summary updates the one an earlier review posted, or posts one", async () => {
  /** @type {{ path: string, method?: string, body?: any }[]} */
  const calls = [];
  /** @param {any[]} comments */
  const fakeGitHub =
    (comments) =>
    async (/** @type {string} */ path, request = {}) => {
      calls.push({ path, ...request });
      return request.method ? {} : comments;
    };
  await postSummary(
    fakeGitHub([
      { id: 1, body: "Claude reviewed an older commit" },
      { id: 2, body: `${SUMMARY_MARKER}\nold` },
    ]),
    "7",
    "new",
  );
  assert.deepEqual(calls.at(-1), {
    path: "/issues/comments/2",
    method: "PATCH",
    body: { body: "new" },
  });
  await postSummary(fakeGitHub([]), "7", "new");
  assert.deepEqual(calls.at(-1), {
    path: "/issues/7/comments",
    method: "POST",
    body: { body: "new" },
  });
});
