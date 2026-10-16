import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PART_BYTES,
  PART_LINES,
  explainUnread,
  packShares,
  planReview,
  readChangedFiles,
  splitDiffByFile,
  splitIntoParts,
  wrapLongLine,
  writeReview,
} from "../worker/plan-review.mjs";

/**
 * A diff of one file, with so many hunks of so many added lines each.
 * @param {string} path
 * @param {number[]} hunkSizes
 */
const diffFile = (path, hunkSizes) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunkSizes.flatMap((size, index) => [
      `@@ -${index * 10 + 1},0 +${index * 10 + 1},${size} @@`,
      ...Array.from({ length: size }, (_, line) => `+line ${line}`),
    ]),
  ].join("\n") + "\n";

/** @param {string} text */
const countLines = (text) => text.replace(/\n$/, "").split("\n").length;

test("each changed file's lines are what it added and removed, and a binary file's are unknown", () => {
  assert.deepEqual(readChangedFiles("3\t2\tshared/page/sheet.js\n-\t-\tapps/mlb/page/icon.png\n"), [
    { path: "shared/page/sheet.js", lines: 5 },
    { path: "apps/mlb/page/icon.png", lines: null },
  ]);
});

test("recorded data, the lockfile, and binary files go unread, but a fixture's recording script is read", () => {
  assert.equal(
    explainUnread({ path: "apps/mlb/tests/fixtures/2026-10-09-season.json", lines: 9 }),
    "a test's recorded data",
  );
  assert.equal(
    explainUnread({ path: "apps/wnba/tests/fixtures/news-2026-10-05/ix.xml", lines: 9 }),
    "a test's recorded data",
  );
  assert.equal(
    explainUnread({ path: "package-lock.json", lines: 9 }),
    "the lockfile, which npm writes",
  );
  assert.equal(
    explainUnread({ path: "shared/page/networks/abc.png", lines: null }),
    "a binary file",
  );
  assert.equal(explainUnread({ path: "apps/mlb/tests/fixtures/record.js", lines: 9 }), null);
  assert.equal(explainUnread({ path: "shared/page/sheet.js", lines: 9 }), null);
});

test("an icon's drawing and a minified library go unread, as a tool wrote them", () => {
  const plan = planReview("1\t0\tapps/mlb/page/icon.svg\n1\t0\tapps/mlb/page/js/sortable.min.js\n");
  assert.deepEqual(
    plan.unread.map((file) => file.why),
    Array(2).fill("a drawing or a minified library, written by a tool"),
  );
  assert.deepEqual(plan.shares, []);
});

test("a line longer than Read returns whole goes on in lines that each fit, with nothing lost", () => {
  const long = '+const key = "' + "x".repeat(4500) + '";';
  const lines = wrapLongLine(long);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.ok(line.length <= 2000);
  assert.equal(lines[0], long.slice(0, 2000));
  for (const line of lines.slice(1)) assert.ok(line.startsWith("+(cont.) "));
  assert.equal(
    lines[0] +
      lines
        .slice(1)
        .map((line) => line.slice("+(cont.) ".length))
        .join(""),
    long,
  );
  assert.deepEqual(wrapLongLine("+short"), ["+short"]);
  const diff = diffFile("worker/a.mjs", [1]).replace("+line 0", long);
  const [part] = splitIntoParts(diff);
  assert.ok(part.split("\n").every((line) => line.length <= 2000));
});

test("shares keep a folder's files together in path order, up to a share's lines", () => {
  const shares = packShares([
    { path: "shared/page/sheet.js", lines: 300 },
    { path: "apps/wnba/page/js/app.js", lines: 500 },
    { path: "apps/mlb/page/js/app.js", lines: 400 },
    { path: "apps/mlb/page/js/games-view.js", lines: 300 },
  ]);
  assert.deepEqual(shares, [
    {
      share: 1,
      files: ["apps/mlb/page/js/app.js", "apps/mlb/page/js/games-view.js"],
      lines: 700,
    },
    { share: 2, files: ["apps/wnba/page/js/app.js", "shared/page/sheet.js"], lines: 800 },
  ]);
});

test("a file bigger than a share is a share of its own", () => {
  const shares = packShares([
    { path: "a.js", lines: 10 },
    { path: "b.js", lines: 2000 },
    { path: "c.js", lines: 10 },
  ]);
  assert.deepEqual(
    shares.map((share) => share.files),
    [["a.js"], ["b.js"], ["c.js"]],
  );
});

test("a change of any size takes at most twenty shares, each bigger to hold it", () => {
  const files = Array.from({ length: 300 }, (_, index) => ({
    path: `file-${String(index).padStart(3, "0")}.js`,
    lines: ((index * 7919) % 400) + 20,
  }));
  const shares = packShares(files);
  assert.ok(shares.length <= 20);
  assert.equal(shares.flatMap((share) => share.files).length, 300);
});

test("a plan reads every file but the unread ones, and names why each goes unread", () => {
  const plan = planReview("4\t1\tshared/page/sheet.js\n900\t0\tapps/mlb/tests/fixtures/x.json\n");
  assert.deepEqual(plan.shares, [{ share: 1, files: ["shared/page/sheet.js"], lines: 5 }]);
  assert.deepEqual(plan.unread, [
    { path: "apps/mlb/tests/fixtures/x.json", why: "a test's recorded data" },
  ]);
});

test("a diff splits into each file's, a deleted file's under the path it had", () => {
  const deleted = [
    "diff --git a/old.js b/old.js",
    "deleted file mode 100644",
    "--- a/old.js",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-gone",
    "",
  ].join("\n");
  const byPath = splitDiffByFile(diffFile("new.js", [2]) + deleted);
  assert.deepEqual([...byPath.keys()], ["new.js", "old.js"]);
  assert.equal(byPath.get("old.js"), deleted);
});

test("a path with a space is found under its name, though git ends its header with a tab", () => {
  const spaced = [
    "diff --git a/a b.js b/a b.js",
    "--- a/a b.js\t",
    "+++ b/a b.js\t",
    "@@ -1,0 +1 @@",
    "+x",
    "",
  ].join("\n");
  assert.deepEqual([...splitDiffByFile(spaced).keys()], ["a b.js"]);
});

test("a changed file the diff has no part for stops the review rather than counting as read", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  assert.throws(
    () => writeReview(folder, { numstat: "1\t0\tmissing.js\n", diff: diffFile("other.js", [1]) }),
    /The diff has no part for missing\.js/,
  );
});

test("a file's diff is one part while it fits, and splits between hunks once it doesn't", () => {
  assert.equal(splitIntoParts(diffFile("a.js", [10, 10])).length, 1);
  const parts = splitIntoParts(diffFile("a.js", [600, 600]));
  assert.equal(parts.length, 2);
  assert.match(parts[1], /^@@ /);
  for (const part of parts) assert.ok(countLines(part) <= PART_LINES);
});

test("a diff of long lines splits by size too, so one Read returns each part whole", () => {
  const prose = "+" + "a long line of documentation ".repeat(4);
  const diff = [
    "diff --git a/AGENTS.md b/AGENTS.md",
    "--- a/AGENTS.md",
    "+++ b/AGENTS.md",
    "@@ -1,0 +1,900 @@",
    ...Array.from({ length: 900 }, () => prose),
    "",
  ].join("\n");
  const parts = splitIntoParts(diff);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(Buffer.byteLength(part) <= PART_BYTES);
  assert.equal(parts.join(""), diff);
});

test("a hunk longer than a part is cut into parts, with no line lost", () => {
  const diff = diffFile("a.js", [2500]);
  const parts = splitIntoParts(diff);
  assert.equal(parts.length, 3);
  for (const part of parts) assert.ok(countLines(part) <= PART_LINES);
  assert.equal(parts.join(""), diff);
});

test("the review is written as each file's parts, the plan, and the index", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  const { shares, unread } = writeReview(folder, {
    numstat: "1200\t0\tshared/page/sheet.js\n2\t0\tshared/page/tabs.js\n-\t-\ticon.png\n",
    diff: diffFile("shared/page/sheet.js", [600, 600]) + diffFile("shared/page/tabs.js", [2]),
  });
  assert.deepEqual(shares[0].partsByFile, {
    "shared/page/sheet.js": [
      "diffs/shared/page/sheet.js.part-1.diff",
      "diffs/shared/page/sheet.js.part-2.diff",
    ],
  });
  assert.deepEqual(shares[1].partsByFile, {
    "shared/page/tabs.js": ["diffs/shared/page/tabs.js.diff"],
  });
  assert.deepEqual(unread, [{ path: "icon.png", why: "a binary file" }]);
  assert.match(readFileSync(join(folder, "diffs/shared/page/tabs.js.diff"), "utf8"), /^diff --git/);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")).shares, shares);
  const index = readFileSync(join(folder, "files.md"), "utf8");
  assert.match(
    index,
    /## Share 2\n\n- shared\/page\/tabs\.js: diffs\/shared\/page\/tabs\.js\.diff/,
  );
  assert.match(index, /## Not read\n\n- icon\.png: a binary file/);
});
