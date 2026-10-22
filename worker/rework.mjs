// Estimates follow-up fixes by file overlap in main's squash-merged history. Shared files can
// change for unrelated reasons, so a match identifies a candidate, never proof of a regression.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** @typedef {{ date: string, subject: string, number: number, files: string[] }} MergedPr */

/**
 * Merged PRs from a NUL-delimited git log, oldest first in main's first-parent order.
 * @param {string} log
 * @returns {MergedPr[]}
 */
export function readMergedPrs(log) {
  return log
    .split("\x1e")
    .slice(1)
    .flatMap((record) => {
      const [date, subject, ...paths] = record.split("\0");
      const number = Number(subject?.match(/\(#(\d+)\)$/)?.[1]);
      if (!number || !Number.isFinite(Date.parse(date))) return [];
      const files = paths
        .map((path, index) => (index === 0 ? path.replace(/^\n/, "") : path))
        .filter(Boolean);
      return [{ date, subject, number, files }];
    });
}

/**
 * Every earlier PR whose files a fix overlaps within the preceding fourteen days.
 * @param {MergedPr} fix
 * @param {MergedPr[]} earlier
 */
function listOverlaps(fix, earlier) {
  const fixedAt = Date.parse(fix.date);
  return earlier.flatMap((pr) => {
    const age = fixedAt - Date.parse(pr.date);
    if (age < 0 || age > WINDOW_MS) return [];
    const files = [...new Set(fix.files)].filter((file) => pr.files.includes(file));
    return files.length ? [{ number: pr.number, files }] : [];
  });
}

/**
 * Counts each matching fix once, even when it overlaps several earlier PRs.
 * Months use merge timestamps in UTC so the estimate is independent of the machine's zone.
 * @param {MergedPr[]} prs
 */
export function summarizeRework(prs) {
  const fixes = [];
  const months = new Map();
  const earlier = [];
  for (const pr of prs) {
    const month = new Date(pr.date).toISOString().slice(0, 7);
    const count = months.get(month) ?? { month, merged: 0, followUps: 0 };
    count.merged += 1;
    const overlaps = /^fix(?:\([^()]+\))?!?: /.test(pr.subject) ? listOverlaps(pr, earlier) : [];
    if (overlaps.length) {
      fixes.push({ ...pr, overlaps });
      count.followUps += 1;
    }
    months.set(month, count);
    earlier.push(pr);
  }
  return {
    fixes,
    months: [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((count) => ({
        ...count,
        share: count.followUps / count.merged,
      })),
  };
}

/** @param {ReturnType<typeof summarizeRework>} summary */
export function formatRework(summary) {
  const lines = [
    "File-overlap estimate: fixes touching another PR's files within 14 days.",
    "Overlap is not causal proof. Months use UTC merge dates.",
    "",
    "Month | Follow-up fixes | Merged PRs | Share",
    "--- | ---: | ---: | ---:",
    ...summary.months.map(
      ({ month, followUps, merged, share }) =>
        `${month} | ${followUps} | ${merged} | ${(share * 100).toFixed(1)}%`,
    ),
    "",
    ...summary.fixes.flatMap(({ subject, overlaps }) => [
      subject,
      ...overlaps.map(({ number, files }) => `  Earlier #${number}: ${files.join(", ")}`),
    ]),
  ];
  if (!summary.fixes.length) lines.push("No matching follow-up fixes.");
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const log = execFileSync(
    "git",
    [
      "log",
      "--first-parent",
      "--reverse",
      "--format=%x1e%cI%x00%s",
      "--name-only",
      "--no-renames",
      "--diff-merges=first-parent",
      "-z",
      "origin/main",
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  console.log(formatRework(summarizeRework(readMergedPrs(log))));
}
