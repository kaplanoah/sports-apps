import test from "node:test";
import assert from "node:assert/strict";
import {
  formatRework,
  readMergedHistory,
  readMergedPrs,
  summarizeRework,
} from "../worker/rework.mjs";

/** @param {{ date: string, subject: string, files: string[] }[]} commits */
const createLog = (commits) =>
  commits
    .map(({ date, subject, files }) => `\x1e${date}\0${subject}\0\n${files.join("\0")}\0`)
    .join("");

const LOG = createLog([
  { date: "2026-01-01T12:00:00Z", subject: "feat: A (#1)", files: ["shared/a.js"] },
  { date: "2026-01-11T12:00:00Z", subject: "fix: A (#2)", files: ["shared/a.js"] },
  { date: "2026-01-12T12:00:00Z", subject: "feat: A again (#3)", files: ["shared/a.js"] },
  { date: "2026-02-01T12:00:00Z", subject: "fix: Too late (#4)", files: ["shared/a.js"] },
]);

test("a fix overlapping ten days earlier counts, but twenty days and a non-fix do not", () => {
  const { fixes, months } = summarizeRework(readMergedPrs(LOG));
  assert.deepEqual(
    fixes.map(({ number, overlaps }) => ({ number, overlaps })),
    [{ number: 2, overlaps: [{ number: 1, files: ["shared/a.js"] }] }],
  );
  assert.deepEqual(months, [
    { month: "2026-01", merged: 3, followUps: 1, share: 1 / 3 },
    { month: "2026-02", merged: 1, followUps: 0, share: 0 },
  ]);
});

test("fourteen days is inclusive; later, future, and unrelated files do not match", () => {
  const log = createLog([
    { date: "2026-01-01T12:00:00Z", subject: "feat: A (#1)", files: ["a"] },
    { date: "2026-02-01T12:00:00Z", subject: "feat: Future (#2)", files: ["a"] },
    { date: "2026-01-15T12:00:00Z", subject: "fix!: A (#3)", files: ["a"] },
    { date: "2026-01-15T12:00:01Z", subject: "fix: Other (#4)", files: ["b"] },
  ]);
  assert.deepEqual(
    summarizeRework(readMergedPrs(log)).fixes.map(({ number, overlaps }) => ({ number, overlaps })),
    [{ number: 3, overlaps: [{ number: 1, files: ["a"] }] }],
  );
  const later = readMergedPrs(
    createLog([
      { date: "2026-01-01T12:00:00Z", subject: "feat: A (#1)", files: ["a"] },
      { date: "2026-01-15T12:00:01Z", subject: "fix: A (#2)", files: ["a"] },
    ]),
  );
  assert.equal(summarizeRework(later).fixes.length, 0);
});

test("one scoped fix can name multiple earlier PRs and files, but counts once", () => {
  const prs = readMergedPrs(
    createLog([
      { date: "2026-01-30T12:00:00Z", subject: "feat: Both (#1)", files: ["a", "b"] },
      { date: "2026-01-31T12:00:00Z", subject: "feat: One (#2)", files: ["a"] },
      { date: "2026-01-31T23:30:00-05:00", subject: "fix(mlb)!: Both (#3)", files: ["a", "b"] },
    ]),
  );
  const summary = summarizeRework(prs);
  assert.deepEqual(summary.fixes[0].overlaps, [
    { number: 1, files: ["a", "b"] },
    { number: 2, files: ["a"] },
  ]);
  assert.deepEqual(summary.months, [
    { month: "2026-01", merged: 2, followUps: 0, share: 0 },
    { month: "2026-02", merged: 1, followUps: 1, share: 1 },
  ]);
  assert.match(formatRework(summary), /Earlier #1: a, b/);
  assert.match(formatRework(summary), /2026-02 \| 1 \| 1 \| 100\.0%/);
  assert.match(formatRework(summary), /not causal proof/);
  assert.match(formatRework(summary), /within 14 days/);
});

test("a follow-up fix uses the release title parser's types and scope spelling", () => {
  /** @type {[string, boolean][]} */
  const cases = [
    ["fix: Plain (#2)", true],
    ["fix!: Breaking (#2)", true],
    ["fix(mlb)!: Scoped (#2)", true],
    ["fix(league-1)!: Scoped (#2)", true],
    ["fix(Some Scope): Invalid (#2)", false],
    ["fix(MLB)!: Invalid (#2)", false],
    ["fix(league_one)!: Invalid (#2)", false],
    ["fix:  Extra space (#2)", false],
    ["feat: Another feature (#2)", false],
  ];
  for (const [subject, isFix] of cases) {
    const prs = readMergedPrs(
      createLog([
        { date: "2026-01-01T12:00:00Z", subject: "feat: Original (#1)", files: ["a"] },
        { date: "2026-01-02T12:00:00Z", subject, files: ["a"] },
      ]),
    );
    assert.equal(summarizeRework(prs).fixes.length, isFix ? 1 : 0, String(subject));
  }
});

test("main's log keeps first-parent order, merge changes, rename endpoints, and NUL-delimited names", () => {
  const calls = [];
  const prs = readMergedHistory((args) => {
    calls.push(args);
    return LOG;
  });
  assert.deepEqual(calls, [
    [
      "log",
      "--first-parent",
      "--reverse",
      "--format=\x1e%cI%x00%s",
      "--name-only",
      "--no-renames",
      "--diff-merges=first-parent",
      "-z",
      "origin/main",
    ],
  ]);
  assert.deepEqual(
    prs.map(({ number }) => number),
    [1, 2, 3, 4],
  );
});

test("a missing main reference fails rather than reporting an empty history", () => {
  assert.throws(
    () =>
      readMergedHistory(() => {
        throw new Error("origin/main missing");
      }),
    /origin\/main missing/,
  );
});

test("direct commits and malformed records do not count as merged PRs", () => {
  const log = createLog([
    { date: "2026-01-01T12:00:00Z", subject: "fix: Direct commit", files: ["a"] },
    { date: "bad", subject: "fix: Invalid date (#1)", files: ["a"] },
    { date: "2026-01-02T12:00:00Z", subject: "feat: File names (#2)", files: ["a b", "c\nd"] },
  ]);
  assert.deepEqual(readMergedPrs("\x1ebad"), []);
  assert.deepEqual(readMergedPrs(log), [
    {
      date: "2026-01-02T12:00:00Z",
      subject: "feat: File names (#2)",
      number: 2,
      files: ["a b", "c\nd"],
    },
  ]);
  assert.match(formatRework(summarizeRework([])), /No matching follow-up fixes/);
});
