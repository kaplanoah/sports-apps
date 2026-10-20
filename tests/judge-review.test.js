import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ACROSS_RECORD,
  CANDIDATES_RECORD,
  POST_RECORD,
  coversEveryLine,
  findUnreadParts,
  formatFindOutputs,
  gatherCandidates,
  judgeReview,
  keepAcross,
  keepCandidates,
  listReads,
  listUnchecked,
  nameFindRecord,
  readAnswer,
  readRecords,
  recordFindTry,
  settleSummary,
} from "../worker/judge-review.mjs";
import { writeReview } from "../worker/plan-review.mjs";
import { SUMMARY_MARKER, readReviewedHead } from "../worker/review-state.mjs";

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

test("an answer is none when it gave none or gave something else", () => {
  assert.equal(readAnswer(undefined, "candidates"), null);
  assert.equal(readAnswer("not json", "candidates"), null);
  assert.equal(readAnswer('{"candidates": "many"}', "candidates"), null);
  assert.equal(readAnswer('{"candidates": []}', "findings"), null);
  assert.deepEqual(readAnswer('{"candidates": [], "unjudged": "x"}', "candidates"), {
    items: [],
    unjudged: [],
  });
  assert.deepEqual(readAnswer('{"findings": [{"verdict": "confirmed"}]}', "findings"), {
    items: [{ verdict: "confirmed" }],
    unjudged: [],
  });
});

test("the records read back are every job's the review needs, and nothing else in the folder", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  for (const name of [
    nameFindRecord(1),
    nameFindRecord(12),
    CANDIDATES_RECORD,
    ACROSS_RECORD,
    POST_RECORD,
    "plan.json",
    "find-notes.json",
    "post.json.bak",
  ])
    writeFileSync(join(folder, name), "{}");
  assert.deepEqual([...readRecords(folder).keys()].sort(), [
    "across.json",
    "candidates.json",
    "find-1.json",
    "find-12.json",
    "post.json",
  ]);
});

/** @param {string[]} paths */
const diffOf = (paths) =>
  [
    ...paths.flatMap((path) => [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,0 +1 @@",
      "+x",
    ]),
    "",
  ].join("\n");

/**
 * A folder holding a first review's plan of these files, which share one area.
 * @param {string[]} paths
 * @param {{ path: string, text: string }[]} [rules]
 */
function planFirstReview(paths, rules = []) {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeReview(folder, {
    choice: { stage: "first" },
    since: null,
    pushed: null,
    readDiff: () => ({
      numstat: paths.map((path) => `1\t0\t${path}\n`).join(""),
      diff: diffOf(paths),
    }),
    repoFiles: [],
    listStale: () => [],
    rules,
  });
  return folder;
}

test("a reviewer's tries are kept, and only the parts no try read stay unread", () => {
  const folder = planFirstReview(["shared/page/a.js", "shared/page/b.js"]);
  const execution = join(folder, "execution.json");
  const runOn = (/** @type {string} */ part) =>
    writeFileSync(execution, JSON.stringify(runReading([{ file_path: resolve(folder, part) }])));
  runOn("first/shared/page/a.js.diff");
  const candidate = { path: "shared/page/a.js", line: 1, claim: "a copy of b.js's rule" };
  const answer = JSON.stringify({ candidates: [candidate], unjudged: [] });
  assert.deepEqual(
    recordFindTry(folder, 1, { EXECUTION_FILE: execution, STRUCTURED_OUTPUT: answer }),
    { unread: ["first/shared/page/b.js.diff"], isAnswered: true },
  );
  runOn("first/shared/page/b.js.diff");
  assert.deepEqual(
    recordFindTry(folder, 1, { EXECUTION_FILE: execution, STRUCTURED_OUTPUT: answer }),
    { unread: [], isAnswered: true },
  );
  const record = JSON.parse(readFileSync(join(folder, nameFindRecord(1)), "utf8"));
  assert.equal(record.area, 1);
  assert.equal(record.tries.length, 2);
  assert.deepEqual(record.tries[0].answer.items, [candidate]);
});

test("a reviewer that read its diffs but not its area's rule file leaves the rule file unread", () => {
  const rule = { path: ".claude/rules/page.md", text: '---\npaths:\n  - "shared/page/**"\n---\n' };
  const folder = planFirstReview(["shared/page/a.js"], [rule]);
  const execution = join(folder, "execution.json");
  const answer = JSON.stringify({ candidates: [], unjudged: [] });
  const readOnly = (/** @type {string[]} */ parts) => {
    const reads = parts.map((part) => ({ file_path: resolve(folder, part) }));
    writeFileSync(execution, JSON.stringify(runReading(reads)));
    return recordFindTry(folder, 1, { EXECUTION_FILE: execution, STRUCTURED_OUTPUT: answer });
  };
  assert.deepEqual(readOnly(["first/shared/page/a.js.diff"]), {
    unread: ["rules/page.md"],
    isAnswered: true,
  });
  assert.deepEqual(readOnly(["rules/page.md"]), { unread: [], isAnswered: true });
});

test("a reviewer whose last try read everything but gave no answer hasn't finished", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  const execution = join(folder, "execution.json");
  writeFileSync(
    execution,
    JSON.stringify(runReading([{ file_path: resolve(folder, "first/shared/page/a.js.diff") }])),
  );
  assert.deepEqual(recordFindTry(folder, 1, { EXECUTION_FILE: execution }), {
    unread: [],
    isAnswered: false,
  });
});

test("a reviewer's try hands its job its unread parts and whether it answered", () => {
  assert.equal(
    formatFindOutputs({ unread: ["first/a.js.diff", "first/b.js.diff"], isAnswered: true }),
    "unread=first/a.js.diff first/b.js.diff\nanswered=true",
  );
  assert.equal(formatFindOutputs({ unread: [], isAnswered: false }), "unread=\nanswered=false");
});

test("a try that left no execution file read nothing", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  assert.deepEqual(recordFindTry(folder, 1, { EXECUTION_FILE: join(folder, "none.json") }).unread, [
    "first/shared/page/a.js.diff",
  ]);
});

test("a reviewer of an area the plan doesn't have stops rather than reading as done", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  assert.throws(
    () => recordFindTry(folder, 2, { EXECUTION_FILE: join(folder, "none.json") }),
    /The plan has no area 2/,
  );
});

test("the candidates are every area's reviewer's, over every try, each with an id of its own", () => {
  const triesOf = (/** @type {object[][]} */ lists) => ({
    tries: lists.map((items) => ({ reads: [], answer: { items, unjudged: [] } })),
  });
  assert.deepEqual(
    gatherCandidates([
      { area: 1, ...triesOf([[{ claim: "one" }], [{ claim: "two" }]]) },
      { area: 2, tries: [{ reads: [], answer: null }] },
      { area: 3, ...triesOf([[{ claim: "three" }]]) },
    ]),
    [
      { id: "1.1", claim: "one" },
      { id: "1.2", claim: "two" },
      { id: "3.1", claim: "three" },
    ],
  );
});

test("a candidate no finding of the check across areas names is unchecked", () => {
  assert.deepEqual(
    listUnchecked(
      [{ id: "1.1" }, { id: "1.2" }, { id: "2.1" }],
      [{ ids: ["1.1", "2.1"] }, { ids: [] }],
    ),
    ["1.2"],
  );
});

test("the candidates kept for the check across areas are every planned area's, in area order", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  const plan = JSON.parse(readFileSync(join(folder, "plan.json"), "utf8"));
  writeFileSync(
    join(folder, "plan.json"),
    JSON.stringify({ ...plan, areas: [...plan.areas, { ...plan.areas[0], area: 2 }] }),
  );
  const reviewer = (/** @type {number} */ area, /** @type {object[]} */ items) =>
    JSON.stringify({ area, tries: [{ reads: [], answer: { items, unjudged: [] } }] });
  writeFileSync(join(folder, nameFindRecord(2)), reviewer(2, [{ claim: "two" }]));
  writeFileSync(join(folder, nameFindRecord(1)), reviewer(1, [{ claim: "one" }]));
  writeFileSync(join(folder, nameFindRecord(3)), reviewer(3, [{ claim: "unplanned" }]));
  assert.equal(keepCandidates(folder), 2);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, CANDIDATES_RECORD), "utf8")), [
    { id: "1.1", claim: "one" },
    { id: "2.1", claim: "two" },
  ]);
});

test("the check across areas' job counts the cases it left unchecked as the judge does, from the record it keeps", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(join(folder, CANDIDATES_RECORD), JSON.stringify([{ id: "1.1" }, { id: "2.1" }]));
  const answer = { findings: [{ ids: ["1.1"], verdict: "rejected" }], unjudged: [] };
  const unchecked = keepAcross(folder, JSON.stringify(answer));
  assert.deepEqual(unchecked, ["2.1"]);
  const kept = readRecords(folder);
  assert.deepEqual(
    listUnchecked(kept.get(CANDIDATES_RECORD), kept.get(ACROSS_RECORD).items),
    unchecked,
  );
  assert.throws(() => keepAcross(folder, ""), /The check across areas gave no answer/);
});

test("the check across areas' answer keeps only its findings that are objects, and what it couldn't judge that names a file and why", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(join(folder, CANDIDATES_RECORD), JSON.stringify([{ id: "1.1" }]));
  const finding = { ids: ["1.1"], verdict: "rejected" };
  const added = { ids: [], verdict: "confirmed" };
  const unjudged = { file: "a.js", why: "too big" };
  const answer = {
    findings: [null, "a string", finding, added],
    unjudged: [null, "a string", { why: "names no file" }, { file: "b.js" }, unjudged],
  };
  assert.deepEqual(keepAcross(folder, JSON.stringify(answer)), []);
  assert.deepEqual(readRecords(folder).get(ACROSS_RECORD), {
    items: [finding, added],
    unjudged: [unjudged],
  });
});

const HEAD = "c".repeat(40);
const EARLIER = "e".repeat(40);

/** @type {import('../worker/plan-review.mjs').PlannedArea[]} */
const AREAS = [
  {
    area: 1,
    name: "mlb page",
    files: ["a.js"],
    partsByFile: { "a.js": ["first/a.js.diff"] },
    rules: [],
  },
  {
    area: 2,
    name: "shared page",
    files: ["b.js", "c.js"],
    partsByFile: {
      "b.js": ["first/b.js.part-1.diff", "first/b.js.part-2.diff"],
      "c.js": ["first/c.js.diff"],
    },
    rules: ["rules/page-look.md"],
  },
];

const PLAN = {
  stage: "first",
  since: null,
  areas: AREAS,
  unread: [{ path: "package-lock.json", why: "the lockfile, which npm writes" }],
};

/**
 * A reviewer's record of an area that finished, with these changes.
 * @param {number} area
 * @param {Record<string, any>} [changes]
 */
const finishReviewer = (area, changes = {}) => ({
  area,
  tries: [{ reads: [], answer: { items: [], unjudged: [] } }],
  unread: [],
  isAnswered: true,
  ...changes,
});

/**
 * Every record the review's jobs keep once each finished, with these changes.
 * @param {typeof AREAS} areas
 * @param {Record<string, any>} [changes] by record name, undefined to leave one out
 */
function finishReview(areas, changes = {}) {
  /** @type {Record<string, any>} */
  const records = {
    [CANDIDATES_RECORD]: [],
    [ACROSS_RECORD]: { items: [], unjudged: [] },
    [POST_RECORD]: { weights: [], repeated: 0 },
  };
  for (const { area } of areas) records[nameFindRecord(area)] = finishReviewer(area);
  const merged = { ...records, ...changes };
  return new Map(Object.entries(merged).filter(([, record]) => record !== undefined));
}

test("a reviewer that left its area's rule file unread hasn't finished", () => {
  const records = finishReview(AREAS, {
    [nameFindRecord(2)]: finishReviewer(2, { unread: ["rules/page-look.md"] }),
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(body, /- the reviewer of shared page, which left rules\/page-look\.md unread\n/);
});

test("a review isn't finished until the check across areas is, even of one area", () => {
  for (const areas of [AREAS, [AREAS[0]]]) {
    const records = finishReview(areas, { [ACROSS_RECORD]: undefined });
    const { isComplete, body } = judgeReview({ sha: HEAD, plan: { ...PLAN, areas }, records });
    assert.ok(!isComplete);
    assert.match(body, /- the check across areas\n/);
  }
});

test("a review that read and checked everything passes, and moves the reviewed head on", () => {
  const records = finishReview(AREAS, {
    [ACROSS_RECORD]: {
      items: [{ verdict: "confirmed" }, { verdict: "rejected" }, { verdict: "rejected" }],
      unjudged: [{ file: "c.js", why: "only an iPhone shows it" }],
    },
    [POST_RECORD]: { weights: ["Important", "Nit", "Important"], repeated: 0 },
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(isComplete);
  assert.ok(body.startsWith(SUMMARY_MARKER));
  assert.equal(readReviewedHead(body), HEAD);
  assert.match(
    body,
    /Claude reviewed c{40}: it read the whole change in 2 areas, and posted 3 findings \(2 Important, 1 Nit\)\./,
  );
  assert.match(body, /the check across areas turned down 2 of 3 candidates/);
  assert.match(body, /Read in full: 3 of 3 changed files to read\./);
  assert.match(body, /- `package-lock.json`: the lockfile, which npm writes/);
  assert.match(body, /- `c.js`: only an iPhone shows it/);
  assert.doesNotMatch(body, /fails/);
});

test("a file a reviewer didn't read in full fails the review, keeping the earlier reviewed head", () => {
  const records = finishReview(AREAS, {
    [nameFindRecord(2)]: finishReviewer(2, { tries: [], unread: ["first/b.js.part-2.diff"] }),
  });
  const { isComplete, body } = judgeReview({
    sha: HEAD,
    plan: { ...PLAN, since: EARLIER },
    records,
  });
  assert.ok(!isComplete);
  assert.equal(readReviewedHead(body), EARLIER);
  assert.match(body, /Read in full: 2 of 3 changed files/);
  assert.match(body, /didn't read every line of them or didn't finish, so the review fails/);
  assert.equal(body.match(/- `b\.js`/g)?.length, 1);
  assert.doesNotMatch(body, /- `c.js`/);
});

test("a reviewer that gave no answer, or a check across areas that left a case unchecked, fails the review", () => {
  const records = finishReview(AREAS, {
    [nameFindRecord(1)]: finishReviewer(1, {
      tries: [{ reads: [], answer: null }],
      isAnswered: false,
    }),
    [CANDIDATES_RECORD]: [{ id: "2.1" }, { id: "2.2" }],
    [ACROSS_RECORD]: { items: [{ ids: ["2.1"], verdict: "rejected" }], unjudged: [] },
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(
    body,
    /- the reviewer of mlb page\n- the check across areas, which left 1 case unchecked/,
  );
  assert.match(body, /Read in full: 3 of 3/);
});

test("what a reviewer or the check across areas couldn't judge is named", () => {
  const unjudged = (/** @type {string} */ file) => ({ file, why: "only an iPhone shows it" });
  const records = finishReview(AREAS, {
    [nameFindRecord(1)]: finishReviewer(1, {
      tries: [{ reads: [], answer: { items: [], unjudged: [unjudged("reviewer.js")] } }],
    }),
    [ACROSS_RECORD]: { items: [], unjudged: [unjudged("across.js")] },
  });
  const { body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.match(body, /- `reviewer\.js`: only an iPhone shows it\n- `across\.js`/);
});

test("a reviewer, the check across areas, or the posting step that never finished fails the review, each named", () => {
  const records = finishReview(AREAS, {
    [nameFindRecord(1)]: undefined,
    [ACROSS_RECORD]: undefined,
    [POST_RECORD]: undefined,
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(
    body,
    /- the reviewer of mlb page\n- the check across areas\n- the step that posts the findings/,
  );
  assert.match(body, /- `a.js`/);
  assert.equal(readReviewedHead(body), null);
});

test("a review of a push says what it read since, and findings already on the pull request don't count as posted", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], unread: [] };
  const records = finishReview([AREAS[0]], { [POST_RECORD]: { weights: [], repeated: 2 } });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan, records });
  assert.ok(isComplete);
  assert.match(
    body,
    /it read what the pushes since eeeeeee changed, in 1 area, and posted no findings, and found 2 findings already on it\./,
  );
  assert.doesNotMatch(body, /Left unread/);
});

test("a push that changes only what a merge brings in passes and moves the reviewed head on", () => {
  const { isComplete, body } = judgeReview({
    sha: HEAD,
    plan: { stage: "none", since: EARLIER, areas: [], unread: [] },
    records: new Map(),
  });
  assert.ok(isComplete);
  assert.equal(readReviewedHead(body), HEAD);
  assert.match(
    body,
    /read nothing new in c{40}: the pushes since eeeeeee change only what a merge of the base brings in/,
  );
});

test("a run on a head already read in full passes and leaves that read's summary as it is", () => {
  assert.deepEqual(
    judgeReview({
      sha: HEAD,
      plan: { stage: "reviewed", since: null, areas: [], unread: [] },
      records: new Map(),
    }),
    { isComplete: true, body: null },
  );
});

test("a change of only recorded data passes, naming what it left unread", () => {
  const { isComplete, body } = judgeReview({
    sha: HEAD,
    plan: { ...PLAN, areas: [], unread: [{ path: "a.json", why: "a test's recorded data" }] },
    records: new Map(),
  });
  assert.ok(isComplete);
  assert.match(body, /Claude had nothing to read in c{40}\.\n\nLeft unread/);
  assert.match(body, /- `a.json`: a test's recorded data/);
});

test("the summary updates the one an earlier review posted, or else posts one, and a run with none of its own leaves it", async () => {
  /** @type {{ path: string, method?: string, body?: any }[]} */
  const calls = [];
  const callGitHub = async (/** @type {string} */ path, request = {}) => {
    calls.push({ path, ...request });
    return {};
  };
  await settleSummary(callGitHub, { pullNumber: "7", earlier: { id: 3 }, body: "new" });
  assert.deepEqual(calls.at(-1), {
    path: "/issues/comments/3",
    method: "PATCH",
    body: { body: "new" },
  });
  await settleSummary(callGitHub, { pullNumber: "7", earlier: null, body: "new" });
  assert.deepEqual(calls.at(-1), {
    path: "/issues/7/comments",
    method: "POST",
    body: { body: "new" },
  });
  await settleSummary(callGitHub, { pullNumber: "7", earlier: { id: 3 }, body: null });
  assert.equal(calls.length, 2);
});
