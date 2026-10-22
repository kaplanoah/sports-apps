import test from "node:test";
import assert from "node:assert/strict";
import { formatRework, readMergedPrs, summarizeRework } from "../worker/rework.mjs";

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
