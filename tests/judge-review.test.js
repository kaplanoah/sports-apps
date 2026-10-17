import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  coversEveryLine,
  findUnreadParts,
  formatFindOutputs,
  gatherCandidates,
  judgeReview,
  keepCandidates,
  keepCheck,
  listAreaRecords,
  listDueStages,
  listReads,
  listUnchecked,
  readAnswer,
  readRecords,
  recordFindTry,
  settleSummary,
} from "../worker/judge-review.mjs";
import { listStageKinds, writeReview } from "../worker/plan-review.mjs";
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
  assert.equal(readAnswer(undefined, ["candidates"]), null);
  assert.equal(readAnswer("not json", ["candidates"]), null);
  assert.equal(readAnswer('{"candidates": "many"}', ["candidates"]), null);
  assert.equal(readAnswer('{"duplicates": []}', ["duplicates", "added"]), null);
  assert.deepEqual(readAnswer('{"candidates": [], "unjudged": "x"}', ["candidates"]), {
    candidates: [],
    unjudged: [],
  });
  assert.deepEqual(readAnswer('{"findings": [{"verdict": "confirmed"}]}', ["findings"]), {
    findings: [{ verdict: "confirmed" }],
    unjudged: [],
  });
});

test("the records read back are every job's the review needs, and nothing else in the folder", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  for (const name of [
    "find-first-1-bugs.json",
    "candidates-first-1.json",
    "check-first-1.json",
    "across-first.json",
    "post-first.json",
    "plan.json",
    "checked-first.json",
  ])
    writeFileSync(join(folder, name), "{}");
  assert.deepEqual([...readRecords(folder).keys()].sort(), [
    "across-first.json",
    "candidates-first-1.json",
    "check-first-1.json",
    "find-first-1-bugs.json",
    "post-first.json",
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
 */
function planFirstReview(paths) {
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
  });
  return folder;
}

test("a reviewer's tries are kept, and only the parts no try read stay unread", () => {
  const folder = planFirstReview(["shared/page/a.js", "shared/page/b.js"]);
  const execution = join(folder, "execution.json");
  const runOn = (/** @type {string} */ part) =>
    writeFileSync(execution, JSON.stringify(runReading([{ file_path: resolve(folder, part) }])));
  const reviewer = { stage: "first", area: 1, kind: "rules" };
  runOn("first/shared/page/a.js.diff");
  const candidate = { path: "shared/page/a.js", line: 1, claim: "a copy of b.js's rule" };
  const answer = JSON.stringify({ candidates: [candidate], unjudged: [] });
  assert.deepEqual(
    recordFindTry(folder, reviewer, { EXECUTION_FILE: execution, STRUCTURED_OUTPUT: answer }),
    { unread: ["first/shared/page/b.js.diff"], isAnswered: true },
  );
  runOn("first/shared/page/b.js.diff");
  assert.deepEqual(
    recordFindTry(folder, reviewer, { EXECUTION_FILE: execution, STRUCTURED_OUTPUT: answer }),
    { unread: [], isAnswered: true },
  );
  const record = JSON.parse(readFileSync(join(folder, "find-first-1-rules.json"), "utf8"));
  assert.equal(record.tries.length, 2);
  assert.deepEqual(record.tries[0].answer.items, [candidate]);
});

test("a reviewer whose last try read everything but gave no answer hasn't finished", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  const execution = join(folder, "execution.json");
  writeFileSync(
    execution,
    JSON.stringify(runReading([{ file_path: resolve(folder, "first/shared/page/a.js.diff") }])),
  );
  assert.deepEqual(
    recordFindTry(folder, { stage: "first", area: 1, kind: "bugs" }, { EXECUTION_FILE: execution }),
    { unread: [], isAnswered: false },
  );
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
  assert.deepEqual(
    recordFindTry(
      folder,
      { stage: "first", area: 1, kind: "bugs" },
      { EXECUTION_FILE: join(folder, "none.json") },
    ).unread,
    ["first/shared/page/a.js.diff"],
  );
});

test("a reviewer of an area the plan doesn't have stops rather than reading as done", () => {
  const folder = planFirstReview(["shared/page/a.js"]);
  assert.throws(
    () =>
      recordFindTry(
        folder,
        { stage: "first", area: 2, kind: "bugs" },
        { EXECUTION_FILE: join(folder, "none.json") },
      ),
    /The plan's first stage has no area 2/,
  );
  assert.throws(
    () =>
      recordFindTry(
        folder,
        { stage: "final", area: 1, kind: "all" },
        { EXECUTION_FILE: join(folder, "none.json") },
      ),
    /The plan's final stage has no area 1/,
  );
});

test("an area's candidates are every reviewer's, over every try, each with an id of its own", () => {
  const triesOf = (/** @type {object[][]} */ lists) => ({
    tries: lists.map((items) => ({ reads: [], answer: { items, unjudged: [] } })),
  });
  assert.deepEqual(
    gatherCandidates([
      { kind: "bugs", ...triesOf([[{ claim: "one" }], [{ claim: "two" }]]) },
      { kind: "rules", tries: [{ reads: [], answer: null }] },
      { kind: "tests", ...triesOf([[{ claim: "three" }]]) },
    ]),
    [
      { id: "bugs-1", claim: "one" },
      { id: "bugs-2", claim: "two" },
      { id: "tests-1", claim: "three" },
    ],
  );
});

test("an area's records are its own reviewers', never another area's whose number starts the same", () => {
  const records = new Map([
    ["find-first-1-bugs.json", { area: 1 }],
    ["find-first-10-bugs.json", { area: 10 }],
    ["find-push-1-bugs.json", { area: 1, stage: "push" }],
    ["check-first-1.json", { items: [] }],
  ]);
  assert.deepEqual(listAreaRecords(records, "first", 1), [{ area: 1 }]);
  assert.deepEqual(listAreaRecords(records, "first", 10), [{ area: 10 }]);
});

test("a candidate no finding of its checker names is unchecked", () => {
  assert.deepEqual(
    listUnchecked(
      [{ id: "bugs-1" }, { id: "bugs-2" }, { id: "tests-1" }],
      [{ ids: ["bugs-1", "tests-1"] }, { ids: [] }],
    ),
    ["bugs-2"],
  );
});

test("a checker's job counts the cases it left unchecked as the judge does, from the record it keeps", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(
    join(folder, "candidates-first-2.json"),
    JSON.stringify([{ id: "bugs-1" }, { id: "rules-1" }]),
  );
  const answer = { findings: [{ ids: ["bugs-1"], verdict: "rejected" }], unjudged: [] };
  const unchecked = keepCheck(folder, { stage: "first", area: 2 }, JSON.stringify(answer));
  assert.deepEqual(unchecked, ["rules-1"]);
  const kept = readRecords(folder);
  assert.deepEqual(
    listUnchecked(kept.get("candidates-first-2.json"), kept.get("check-first-2.json").items),
    unchecked,
  );
  assert.throws(() => keepCheck(folder, { stage: "first", area: 2 }, ""), /gave no answer/);
});

test("a checker's answer keeps only its findings that are objects, so no later step trips on one", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(join(folder, "candidates-first-1.json"), JSON.stringify([{ id: "bugs-1" }]));
  const finding = { ids: ["bugs-1"], verdict: "rejected" };
  const answer = { findings: [null, "a string", finding], unjudged: [] };
  assert.deepEqual(keepCheck(folder, { stage: "first", area: 1 }, JSON.stringify(answer)), []);
  assert.deepEqual(readRecords(folder).get("check-first-1.json").items, [finding]);
});

test("an area's candidates are kept for its check and counted, so one with none skips its checker", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  const reviewer = (/** @type {string} */ kind, /** @type {object[]} */ items) =>
    JSON.stringify({ kind, tries: [{ reads: [], answer: { items, unjudged: [] } }] });
  for (const { kind } of listStageKinds("first")) {
    writeFileSync(join(folder, `find-first-1-${kind}.json`), reviewer(kind, []));
    const items = kind === "bugs" ? [{ claim: "one" }] : [];
    writeFileSync(join(folder, `find-first-2-${kind}.json`), reviewer(kind, items));
  }
  assert.equal(keepCandidates(folder, { stage: "first", area: 1 }), 0);
  assert.equal(readFileSync(join(folder, "candidates-first-1.json"), "utf8"), "[]");
  assert.equal(keepCandidates(folder, { stage: "first", area: 2 }), 1);
});

test("an area a reviewer left no record for stops rather than counting its cases as none", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(
    join(folder, "find-first-1-bugs.json"),
    JSON.stringify({ kind: "bugs", tries: [{ reads: [], answer: { items: [], unjudged: [] } }] }),
  );
  assert.throws(
    () => keepCandidates(folder, { stage: "first", area: 1 }),
    /No reviewer's record named find-first-1-bugs-from-end\.json, find-first-1-rules\.json/,
  );
  assert.ok(!existsSync(join(folder, "candidates-first-1.json")));
});

test("the last read's area has only its one reviewer's record to gather", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  const answer = { items: [{ claim: "one" }], unjudged: [] };
  writeFileSync(
    join(folder, "find-final-1-all.json"),
    JSON.stringify({ kind: "all", tries: [{ reads: [], answer }] }),
  );
  assert.equal(keepCandidates(folder, { stage: "final", area: 1 }), 1);
  assert.deepEqual(
    JSON.parse(readFileSync(join(folder, "candidates-final-1.json"), "utf8")).map(
      (/** @type {{ claim: string }} */ candidate) => candidate.claim,
    ),
    ["one"],
  );
});

test("an area with no candidates keeps an empty check with no checker, which the judge counts as done", () => {
  const folder = mkdtempSync(join(tmpdir(), "judge-review-"));
  writeFileSync(join(folder, "candidates-first-1.json"), "[]");
  assert.deepEqual(keepCheck(folder, { stage: "first", area: 1 }, undefined), []);
  assert.deepEqual(readRecords(folder).get("check-first-1.json"), { items: [], unjudged: [] });
});

const HEAD = "c".repeat(40);
const EARLIER = "e".repeat(40);

/** @type {import('../worker/plan-review.mjs').PlannedArea[]} */
const AREAS = [
  {
    area: 1,
    name: "mlb page",
    files: ["a.js"],
    lines: 4,
    partsByFile: { "a.js": ["first/a.js.diff"] },
  },
  {
    area: 2,
    name: "shared page",
    files: ["b.js", "c.js"],
    lines: 2400,
    partsByFile: {
      "b.js": ["first/b.js.part-1.diff", "first/b.js.part-2.diff"],
      "c.js": ["first/c.js.diff"],
    },
  },
];

const PLAN = {
  stage: "first",
  since: null,
  areas: AREAS,
  unread: [{ path: "package-lock.json", why: "the lockfile, which npm writes" }],
  final: [],
  finalUnread: [],
};

/**
 * Every record a stage's jobs keep once each finished, with these changes.
 * @param {string} stage
 * @param {typeof AREAS} areas
 * @param {Record<string, any>} [changes] by record name, undefined to leave one out
 */
function finishStage(stage, areas, changes = {}) {
  const kinds = listStageKinds(stage).map(({ kind }) => kind);
  /** @type {Record<string, any>} */
  const records = {
    [`post-${stage}.json`]: { weights: [], unjudged: [] },
  };
  if (areas.length > 1)
    records[`across-${stage}.json`] = { duplicates: [], added: [], unjudged: [] };
  for (const { area } of areas) {
    records[`check-${stage}-${area}.json`] = { items: [], unjudged: [] };
    for (const kind of kinds)
      records[`find-${stage}-${area}-${kind}.json`] = {
        stage,
        area,
        kind,
        tries: [{ reads: [], answer: { items: [], unjudged: [] } }],
        unread: [],
        isAnswered: true,
      };
  }
  const merged = { ...records, ...changes };
  return new Map(Object.entries(merged).filter(([, record]) => record !== undefined));
}

test("a stage of more than one area isn't finished until the check across them is", () => {
  const records = finishStage("first", AREAS, { "across-first.json": undefined });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(body, /- the check across areas\n/);
});

test("a review that read and checked everything passes, and moves the reviewed head on", () => {
  const records = finishStage("first", AREAS, {
    "check-first-2.json": {
      items: [{ verdict: "confirmed" }, { verdict: "rejected" }, { verdict: "rejected" }],
      unjudged: [{ file: "c.js", why: "only an iPhone shows it" }],
    },
    "post-first.json": { weights: ["Important", "Nit", "Important"], unjudged: [] },
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(isComplete);
  assert.ok(body.startsWith(SUMMARY_MARKER));
  assert.equal(readReviewedHead(body), HEAD);
  assert.match(
    body,
    /Claude reviewed c{40}: it read the whole change in 2 areas, 4 reviewers an area, and posted 3 findings \(2 Important, 1 Nit\)\./,
  );
  assert.match(body, /the checkers turned down 2 of 3 candidates/);
  assert.match(body, /Read in full: 3 of 3 changed files to read\./);
  assert.match(body, /- `package-lock.json`: the lockfile, which npm writes/);
  assert.match(body, /- `c.js`: only an iPhone shows it/);
  assert.doesNotMatch(body, /fails/);
});

test("a file a reviewer didn't read in full fails the review, keeping the earlier reviewed head", () => {
  const records = finishStage("first", AREAS, {
    "find-first-2-tests.json": {
      stage: "first",
      area: 2,
      kind: "tests",
      tries: [],
      unread: ["first/b.js.part-2.diff"],
      isAnswered: true,
    },
    "find-first-2-rules.json": {
      stage: "first",
      area: 2,
      kind: "rules",
      tries: [],
      unread: ["first/b.js.part-2.diff"],
      isAnswered: true,
    },
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

test("a reviewer that gave no answer, or a checker that left a case unchecked, fails the review", () => {
  const records = finishStage("first", AREAS, {
    "find-first-1-tests.json": {
      stage: "first",
      area: 1,
      kind: "tests",
      tries: [{ reads: [], answer: null }],
      unread: [],
      isAnswered: false,
    },
    "candidates-first-2.json": [{ id: "bugs-1" }, { id: "rules-1" }],
    "check-first-2.json": { items: [{ ids: ["bugs-1"], verdict: "rejected" }], unjudged: [] },
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(
    body,
    /- the tests reviewer of mlb page\n- the checker of shared page, which left 1 case unchecked/,
  );
  assert.match(body, /Read in full: 3 of 3/);
});

test("what a reviewer, a checker, or the check across areas couldn't judge is named under its own stage", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: AREAS };
  const unjudged = (/** @type {string} */ file) => ({ file, why: "only an iPhone shows it" });
  const records = new Map([
    ...finishStage("push", [AREAS[0]], {
      "find-push-1-rules.json": {
        stage: "push",
        area: 1,
        kind: "rules",
        tries: [{ reads: [], answer: { items: [], unjudged: [unjudged("push-reviewer.js")] } }],
        unread: [],
        isAnswered: true,
      },
      "post-push.json": { weights: [], repeated: 0, unjudged: [unjudged("across.js")] },
    }),
    ...finishStage("final", AREAS),
  ]);
  const { body } = judgeReview({ sha: HEAD, plan, records });
  const [push, final] = body.split("Then it read the whole change once more");
  assert.match(push, /- `push-reviewer\.js`: only an iPhone shows it\n- `across\.js`/);
  assert.doesNotMatch(final, /push-reviewer\.js/);
});

test("a reviewer, a checker, or the posting step that never finished fails the review, each named", () => {
  const records = finishStage("first", AREAS, {
    "find-first-1-bugs.json": undefined,
    "check-first-2.json": undefined,
    "post-first.json": undefined,
  });
  const { isComplete, body } = judgeReview({ sha: HEAD, plan: PLAN, records });
  assert.ok(!isComplete);
  assert.match(
    body,
    /- the bugs reviewer of mlb page\n- the checker of shared page\n- the step that posts the findings/,
  );
  assert.match(body, /- `a.js`/);
  assert.equal(readReviewedHead(body), null);
});

test("the last read of the whole change names the files it left unread too, each once", () => {
  const lockfile = { path: "package-lock.json", why: "the lockfile, which npm writes" };
  const fixture = { path: "apps/mlb/tests/fixtures/day.json", why: "a test's recorded data" };
  const plan = {
    ...PLAN,
    stage: "push",
    since: EARLIER,
    areas: [AREAS[0]],
    unread: [lockfile],
    final: AREAS,
    finalUnread: [lockfile, fixture],
  };
  const records = new Map([...finishStage("push", [AREAS[0]]), ...finishStage("final", AREAS)]);
  const { body } = judgeReview({ sha: HEAD, plan, records });
  assert.match(
    body,
    /Left unread, as nothing to review:\n- `package-lock\.json`: the lockfile, which npm writes\n- `apps\/mlb\/tests\/fixtures\/day\.json`: a test's recorded data$/,
  );
  const posted = finishStage("push", [AREAS[0]], {
    "post-push.json": { weights: ["Nit"], unjudged: [] },
  });
  const pushOnly = judgeReview({ sha: HEAD, plan, records: posted });
  assert.doesNotMatch(pushOnly.body, /fixtures/);
});

test("a review of a push whose whole change has nothing left to read is due no last read", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: [] };
  const pushed = finishStage("push", [AREAS[0]]);
  assert.deepEqual(
    listDueStages(plan, pushed).map((due) => due.stage),
    ["push"],
  );
  assert.ok(judgeReview({ sha: HEAD, plan, records: pushed }).isComplete);
});

test("a review of a push that finished and posted nothing is due the last read of the whole change", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: AREAS };
  const pushed = finishStage("push", [AREAS[0]]);
  assert.deepEqual(
    listDueStages(plan, pushed).map((due) => due.stage),
    ["push", "final"],
  );
  const unfinished = judgeReview({ sha: HEAD, plan, records: pushed });
  assert.ok(!unfinished.isComplete);
  assert.match(unfinished.body, /- the last reviewer of mlb page/);
  const records = new Map([
    ...pushed,
    ...finishStage("final", AREAS, { "post-final.json": { weights: ["Nit"], unjudged: [] } }),
  ]);
  const { isComplete, body } = judgeReview({ sha: HEAD, plan, records });
  assert.ok(isComplete);
  assert.match(
    body,
    /it read what the pushes since eeeeeee changed, in 1 area, and posted no findings/,
  );
  assert.match(
    body,
    /Then it read the whole change once more, 1 reviewer an area, to find what the earlier reads missed: 1 finding \(1 Nit\)\./,
  );
});

test("findings found again that were already on the pull request don't count as posted", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: AREAS };
  const records = finishStage("push", [AREAS[0]], {
    "post-push.json": { weights: [], repeated: 2, unjudged: [] },
  });
  assert.deepEqual(
    listDueStages(plan, records).map((due) => due.stage),
    ["push", "final"],
  );
  assert.match(
    judgeReview({ sha: HEAD, plan, records }).body,
    /posted no findings, and found 2 findings already on it\./,
  );
});

test("a review of a push whose checker didn't finish isn't due the last read, though it posted nothing", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: AREAS };
  const records = finishStage("push", [AREAS[0]]);
  records.delete(`check-push-${AREAS[0].area}.json`);
  assert.deepEqual(
    listDueStages(plan, records).map((due) => due.stage),
    ["push"],
  );
});

test("a review of a push that posted findings isn't due the last read", () => {
  const plan = { ...PLAN, stage: "push", since: EARLIER, areas: [AREAS[0]], final: AREAS };
  const records = finishStage("push", [AREAS[0]], {
    "post-push.json": { weights: ["Important"], unjudged: [] },
  });
  assert.deepEqual(
    listDueStages(plan, records).map((due) => due.stage),
    ["push"],
  );
  assert.ok(judgeReview({ sha: HEAD, plan, records }).isComplete);
});

test("a push that changes only what a merge brings in passes and moves the reviewed head on", () => {
  const { isComplete, body } = judgeReview({
    sha: HEAD,
    plan: { stage: "none", since: EARLIER, areas: [], unread: [], final: [], finalUnread: [] },
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
      plan: { stage: "reviewed", since: null, areas: [], unread: [], final: [], finalUnread: [] },
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
