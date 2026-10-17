import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FINAL_KIND,
  KINDS,
  PART_BYTES,
  PART_LINES,
  chooseStage,
  describeChange,
  explainUnread,
  findPushedRange,
  findTestedFile,
  listAreas,
  listChangedSince,
  listJobs,
  listStaleNames,
  nameCodeArea,
  planReview,
  readChangedFiles,
  splitDiffByFile,
  listPushedFiles,
  listStageKinds,
  splitEvenly,
  WHOLE_CHANGE,
  splitIntoParts,
  wrapLongLine,
  writeReview,
  writeStage,
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

const REPO = [
  "apps/mlb/page/js/season-games.js",
  "apps/mlb/page/js/snapshot.js",
  "apps/mlb/worker/src/snapshot.js",
  "apps/mlb/worker/src/season-updater.js",
  "shared/page/sheet.js",
  "worker/plan-review.mjs",
];

test("each file of code belongs to the area of what it's about", () => {
  assert.equal(nameCodeArea("apps/mlb/page/js/app.js"), "mlb page");
  assert.equal(nameCodeArea("apps/wnba/worker/src/store.js"), "wnba Worker");
  assert.equal(nameCodeArea("shared/page/sheet.css"), "shared page");
  assert.equal(nameCodeArea("shared/worker/push.js"), "shared Worker");
  assert.equal(nameCodeArea("AGENTS.md"), "docs");
  assert.equal(nameCodeArea(".github/workflows/ci.yml"), "tooling");
  assert.equal(nameCodeArea("worker/deploy.mjs"), "tooling");
});

test("a test goes with the file of its name, in its own app, the one the change changes first", () => {
  assert.equal(
    findTestedFile("apps/mlb/tests/season-games.test.js", [], REPO),
    "apps/mlb/page/js/season-games.js",
  );
  assert.equal(
    findTestedFile("apps/mlb/tests/season-updater.test.js", [], REPO),
    "apps/mlb/worker/src/season-updater.js",
  );
  assert.equal(
    findTestedFile(
      "apps/mlb/tests/snapshot.test.js",
      ["apps/mlb/worker/src/snapshot.js", "apps/mlb/tests/snapshot.test.js"],
      REPO,
    ),
    "apps/mlb/worker/src/snapshot.js",
  );
  assert.equal(findTestedFile("tests/plan-review.test.js", [], REPO), "worker/plan-review.mjs");
  assert.equal(findTestedFile("tests/browser/sheet-stack.spec.mjs", [], REPO), null);
  assert.equal(findTestedFile("apps/wnba/tests/season-games.test.js", [], REPO), null);
});

test("areas keep each test beside its code, and a test of no file joins its app's page", () => {
  const areas = listAreas(
    [
      { path: "apps/mlb/page/js/season-games.js", lines: 300 },
      { path: "apps/mlb/tests/season-games.test.js", lines: 100 },
      { path: "apps/mlb/tests/browser/games-list.spec.mjs", lines: 200 },
      { path: "apps/mlb/worker/src/season-updater.js", lines: 200 },
      { path: "apps/mlb/tests/season-updater.test.js", lines: 50 },
    ],
    REPO,
  );
  assert.deepEqual(
    areas.map(({ name, files }) => ({ name, files })),
    [
      {
        name: "mlb Worker",
        files: ["apps/mlb/worker/src/season-updater.js", "apps/mlb/tests/season-updater.test.js"],
      },
      {
        name: "mlb page",
        files: [
          "apps/mlb/page/js/season-games.js",
          "apps/mlb/tests/season-games.test.js",
          "apps/mlb/tests/browser/games-list.spec.mjs",
        ],
      },
    ],
  );
});

test("small areas are read together, and a big one in parts in path order", () => {
  const areas = listAreas(
    [
      { path: "AGENTS.md", lines: 10 },
      { path: "worker/deploy.mjs", lines: 20 },
      { path: "shared/page/a.js", lines: 1500 },
      { path: "shared/page/b.js", lines: 1500 },
    ],
    [],
  );
  assert.deepEqual(
    areas.map(({ area, name, files }) => ({ area, name, files })),
    [
      { area: 1, name: "shared page, part 1", files: ["shared/page/a.js"] },
      { area: 2, name: "shared page, part 2", files: ["shared/page/b.js"] },
      { area: 3, name: "small changes", files: ["AGENTS.md", "worker/deploy.mjs"] },
    ],
  );
});

test("a change of any size takes at most twelve areas, each bigger to hold it", () => {
  const files = Array.from({ length: 300 }, (_, index) => ({
    path: `shared/page/file-${String(index).padStart(3, "0")}.js`,
    lines: ((index * 7919) % 400) + 20,
  }));
  const areas = listAreas(files, []);
  assert.ok(areas.length <= 12);
  assert.equal(areas.flatMap((area) => area.files).length, 300);
});

test("a plan reads every file but the unread ones, and names why each goes unread", () => {
  const plan = planReview(
    "4\t1\tshared/page/sheet.js\n900\t0\tapps/mlb/tests/fixtures/x.json\n1\t0\ticon.svg\n3\t0\tapps/mlb/page/js/sortable.min.js\n",
    REPO,
  );
  assert.deepEqual(plan.areas, [
    { area: 1, name: "shared page", files: ["shared/page/sheet.js"], lines: 5 },
  ]);
  assert.deepEqual(plan.unread, [
    { path: "apps/mlb/tests/fixtures/x.json", why: "a test's recorded data" },
    { path: "icon.svg", why: "a drawing or a minified library, written by a tool" },
    {
      path: "apps/mlb/page/js/sortable.min.js",
      why: "a drawing or a minified library, written by a tool",
    },
  ]);
});

test("each area has a reviewer for each kind of problem, two for bugs, and one checker", () => {
  const { reviewers, checkers } = listJobs([{ area: 1, name: "mlb page", lines: 40 }], KINDS);
  assert.deepEqual(
    reviewers.map((reviewer) => reviewer.kind),
    ["bugs", "bugs-from-end", "rules", "tests"],
  );
  assert.ok(reviewers.every((reviewer) => reviewer.focus.includes("REVIEW.md")));
  assert.deepEqual(checkers, [{ area: 1, name: "mlb page", lines: 40 }]);
  assert.deepEqual(
    listJobs([{ area: 1, name: "mlb page", lines: 40 }], [FINAL_KIND]).reviewers.map(
      (reviewer) => reviewer.kind,
    ),
    ["all"],
  );
});

test("a change reads the same wherever a merge of the base moved it, but not once a block moves within it", () => {
  const before = diffFile("a.js", [2]);
  const shifted = before.replace("@@ -1,0 +1,2 @@", "@@ -41,0 +41,2 @@");
  assert.equal(describeChange(before), describeChange(shifted));
  assert.notEqual(describeChange(before), describeChange(diffFile("a.js", [3])));
  const guarded = (/** @type {string[]} */ context) =>
    ["diff --git a/a.js b/a.js", "--- a/a.js", "+++ b/a.js", "@@ -1,2 +1,3 @@", ...context].join(
      "\n",
    );
  assert.notEqual(
    describeChange(guarded([" check();", "+if (!ok) return;", " work();"])),
    describeChange(guarded([" work();", "+if (!ok) return;", " check();"])),
  );
});

test("a binary file a push replaced reads as changed, and one it left alone doesn't", () => {
  const logo = (/** @type {string} */ blob) =>
    [
      "diff --git a/shared/page/networks/abc.png b/shared/page/networks/abc.png",
      `index 0000000..${blob} 100644`,
      "Binary files /dev/null and b/shared/page/networks/abc.png differ",
      "",
    ].join("\n");
  assert.deepEqual(listChangedSince(logo("1111111"), logo("2222222")), [
    "shared/page/networks/abc.png",
  ]);
  assert.deepEqual(listChangedSince(logo("1111111"), logo("1111111")), []);
});

test("the files a push changed are those whose change differs, never those a merge only moved", () => {
  const earlier = diffFile("a.js", [2]) + diffFile("b.js", [1]) + diffFile("gone.js", [1]);
  const now =
    diffFile("a.js", [2]).replace("@@ -1,0", "@@ -9,0") +
    diffFile("b.js", [1, 1]) +
    diffFile("new.js", [1]);
  assert.deepEqual(listChangedSince(earlier, now), ["b.js", "gone.js", "new.js"]);
  assert.deepEqual(listChangedSince(earlier, earlier), []);
});

test("the first review reads the whole change, a later one what changed, and a merge alone nothing", () => {
  const listChanged = () => ["a.js"];
  assert.deepEqual(chooseStage({ reviewedHead: null, isOnBranch: false, listChanged }), {
    stage: "first",
  });
  const head = "a".repeat(40);
  assert.deepEqual(chooseStage({ reviewedHead: head, isOnBranch: false, listChanged }), {
    stage: "first",
  });
  assert.deepEqual(chooseStage({ reviewedHead: head, isOnBranch: true, listChanged }), {
    stage: "push",
    files: ["a.js"],
  });
  assert.deepEqual(chooseStage({ reviewedHead: head, isOnBranch: true, listChanged: () => [] }), {
    stage: "none",
  });
});

test("the stale names are what the change removed that the repo still names, and nothing it kept", () => {
  const diff = [
    "-export function serveSnapshot(request) {",
    "+export function loadSnapshot(request) {",
    "-export const KEPT_NAME = 1;",
    "+export const KEPT_NAME = 2;",
    "-export const STILL_DEFINED = 1;",
    "-function localHelper() {",
  ].join("\n");
  /** @type {Record<string, string[]>} */
  const repo = {
    "STILL_DEFINED:false": ["shared/page/other.js:3:export const STILL_DEFINED = 1;"],
    "KEPT_NAME:true": ["AGENTS.md:1:KEPT_NAME"],
    "STILL_DEFINED:true": ["AGENTS.md:2:STILL_DEFINED"],
    "localHelper:true": ["AGENTS.md:3:localHelper"],
    "serveSnapshot:true": ["AGENTS.md:351:  It serves the live snapshot (`serveSnapshot`)"],
    "old-records.js:true": ["AGENTS.md:197:  (`worker/src/old-records.js`),"],
  };
  const grep = (/** @type {string} */ pattern, /** @type {boolean} */ isWord) => {
    const name = isWord ? pattern : (pattern.match(/\)(\w+)\\b$/)?.[1] ?? "");
    return repo[`${name}:${isWord}`] ?? [];
  };
  assert.deepEqual(listStaleNames(diff, grep, ["apps/mlb/worker/src/old-records.js"]), [
    {
      name: "serveSnapshot",
      hits: ["AGENTS.md:351:  It serves the live snapshot (`serveSnapshot`)"],
    },
    { name: "old-records.js", hits: ["AGENTS.md:197:  (`worker/src/old-records.js`),"] },
  ]);
});

test("a changed file the diff has no part for stops the review rather than counting as read", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  assert.throws(
    () =>
      writeStage(folder, "first", {
        numstat: "1\t0\tmissing.js\n",
        diff: diffFile("other.js", [1]),
        repoFiles: [],
      }),
    /The diff has no part for missing\.js/,
  );
});

test("a stage is written as each file's parts under the stage's folder, with its areas", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  const { areas, unread } = writeStage(folder, "first", {
    numstat: "1200\t0\tshared/page/sheet.js\n2\t0\tshared/page/tabs.js\n-\t-\ticon.png\n",
    diff: diffFile("shared/page/sheet.js", [600, 600]) + diffFile("shared/page/tabs.js", [2]),
    repoFiles: [],
  });
  assert.deepEqual(areas[0].partsByFile, {
    "shared/page/sheet.js": [
      "first/shared/page/sheet.js.part-1.diff",
      "first/shared/page/sheet.js.part-2.diff",
    ],
    "shared/page/tabs.js": ["first/shared/page/tabs.js.diff"],
  });
  assert.deepEqual(unread, [{ path: "icon.png", why: "a binary file" }]);
  assert.match(readFileSync(join(folder, "first/shared/page/tabs.js.diff"), "utf8"), /^diff --git/);
});

test("a review of a push reads what it changed, and keeps the whole change for the last read", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  /** @type {string[][]} */
  const ranges = [];
  const readDiff = (/** @type {string[]} */ range, /** @type {string[]} */ files = []) => {
    ranges.push([...range, ...files]);
    return files.length
      ? { numstat: "3\t0\tshared/page/sheet.js\n", diff: diffFile("shared/page/sheet.js", [3]) }
      : {
          numstat: "3\t0\tshared/page/sheet.js\n1\t0\tworker/deploy.mjs\n",
          diff: diffFile("shared/page/sheet.js", [3]) + diffFile("worker/deploy.mjs", [1]),
        };
  };
  const since = "b".repeat(40);
  const plan = writeReview(folder, {
    choice: { stage: "push", files: ["shared/page/sheet.js"] },
    since,
    pushed: { range: ["merged-tree", "HEAD"], hasBase: false },
    readDiff,
    repoFiles: [],
    stale: [],
  });
  assert.deepEqual(ranges, [
    ["merged-tree", "HEAD", "shared/page/sheet.js"],
    ["HEAD^1", "HEAD"],
  ]);
  assert.equal(plan.stage, "push");
  assert.equal(plan.since, since);
  assert.deepEqual(
    plan.areas.map((area) => area.files),
    [["shared/page/sheet.js"]],
  );
  assert.deepEqual(
    plan.final.map((area) => area.files),
    [["shared/page/sheet.js", "worker/deploy.mjs"]],
  );
  assert.match(readFileSync(join(folder, "push.md"), "utf8"), /hold only what the pushes since/);
  assert.match(readFileSync(join(folder, "final.md"), "utf8"), /## Area 1: small changes/);
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")), plan);
  assert.match(readFileSync(join(folder, "stale-names.md"), "utf8"), /Nothing the change removed/);
});

test("a push whose merge of the base git can't set apart says its diffs may hold the base's edits", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  writeReview(folder, {
    choice: { stage: "push", files: ["shared/page/sheet.js"] },
    since: "b".repeat(40),
    pushed: { range: ["b".repeat(40), "HEAD^2"], hasBase: true },
    readDiff: () => ({
      numstat: "3\t0\tshared/page/sheet.js\n",
      diff: diffFile("shared/page/sheet.js", [3]),
    }),
    repoFiles: [],
    stale: [],
  });
  assert.match(
    readFileSync(join(folder, "push.md"), "utf8"),
    /the base's own edits apart, those edits too/,
  );
});

test("the first review reads the whole change and keeps nothing for a last read", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  /** @type {string[][]} */
  const ranges = [];
  const plan = writeReview(folder, {
    choice: { stage: "first" },
    since: null,
    pushed: null,
    readDiff: (/** @type {string[]} */ range) => {
      ranges.push(range);
      return {
        numstat: "2\t0\tshared/page/sheet.js\n",
        diff: diffFile("shared/page/sheet.js", [2]),
      };
    },
    repoFiles: [],
    stale: [],
  });
  assert.deepEqual(ranges, [["HEAD^1", "HEAD"]]);
  assert.deepEqual(
    plan.areas.map((area) => area.files),
    [["shared/page/sheet.js"]],
  );
  assert.deepEqual(plan.final, []);
  const index = readFileSync(join(folder, "first.md"), "utf8");
  assert.match(index, /The first review of this pull request/);
  assert.match(
    index,
    /## Area 1: shared page\n\n- shared\/page\/sheet\.js: first\/shared\/page\/sheet\.js\.diff/,
  );
});

test("a push that changes only what a merge brings in reads nothing", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  const plan = writeReview(folder, {
    choice: { stage: "none" },
    since: "b".repeat(40),
    pushed: null,
    readDiff: () => assert.fail("nothing is read"),
    repoFiles: [],
    stale: [],
  });
  assert.deepEqual(plan, { stage: "none", since: null, areas: [], unread: [], final: [] });
});

test("a big area splits into as few parts as it needs, each near an even share, with no part left over", () => {
  const sizes = [1000, 1000, 1000, 200];
  assert.deepEqual(
    splitEvenly(sizes, (size) => size, 2),
    [
      [1000, 1000],
      [1000, 200],
    ],
  );
  assert.deepEqual(
    splitEvenly([3000, 100, 100, 100], (size) => size, 2),
    [[3000], [100, 100, 100]],
  );
  assert.deepEqual(
    splitEvenly([0, 0], (size) => size, 1),
    [[0, 0]],
  );
});

test("a test goes with code outside every app when it's a root test, never an app's of its name", () => {
  const repo = [
    "apps/mlb/worker/src/notifications.js",
    "shared/worker/notifications.js",
    "apps/mlb/page/js/updates.js",
    "shared/page/updates.js",
  ];
  assert.equal(
    findTestedFile("tests/notifications.test.js", [], repo),
    "shared/worker/notifications.js",
  );
  assert.equal(findTestedFile("tests/updates.test.js", [], repo), "shared/page/updates.js");
});

test("more names than areas allow gives each its own area, rather than splitting forever", () => {
  const apps = ["mlb", "wnba", "nba", "nhl", "nfl"];
  const files = apps.flatMap((app) => [
    { path: `apps/${app}/page/js/a.js`, lines: 300 },
    { path: `apps/${app}/worker/src/a.js`, lines: 300 },
  ]);
  const areas = listAreas([...files, { path: "shared/page/a.js", lines: 300 }], []);
  assert.equal(areas.length, 11);
  const many = listAreas(
    [
      ...files,
      { path: "shared/page/a.js", lines: 300 },
      { path: "shared/worker/a.js", lines: 300 },
      { path: "worker/a.mjs", lines: 300 },
    ],
    [],
  );
  assert.equal(many.length, 13);
  assert.ok(many.every((area) => !area.name.includes(", part ")));
});

test("areas split into fewer parts once their parts would pass twelve", () => {
  const folders = [
    "apps/mlb/page/js",
    "apps/mlb/worker/src",
    "apps/wnba/page/js",
    "apps/wnba/worker/src",
    "shared/page",
    "shared/worker",
    "worker",
  ];
  const files = folders.flatMap((folder) =>
    Array.from({ length: 3 }, (_, index) => ({ path: `${folder}/file-${index}.js`, lines: 700 })),
  );
  const areas = listAreas(files, []);
  assert.equal(areas.length, 7);
  assert.ok(areas.every((area) => !area.name.includes(", part ")));
  assert.equal(areas.flatMap((area) => area.files).length, 21);
});

test("equal items still make no more groups than asked for", () => {
  assert.equal(splitEvenly([15, 15, 15, 15], (size) => size, 3).length, 3);
});

test("a line whose own text starts like a file header still counts as part of the change", () => {
  const withComment = (/** @type {string} */ line) =>
    ["diff --git a/q.sql b/q.sql", "--- a/q.sql", "+++ b/q.sql", "@@ -1 +1 @@", line].join("\n");
  assert.notEqual(
    describeChange(withComment("--- a comment")),
    describeChange(withComment("--- another")),
  );
  assert.notEqual(
    describeChange(withComment("+++ added")),
    describeChange(withComment("+++ other")),
  );
});

test("the files a push changed compare the reviewed head's change from its own base with the whole change now", () => {
  /** @type {string[][]} */
  const ranges = [];
  const files = listPushedFiles({
    reviewedHead: "r".repeat(40),
    findMergeBase: (one, other) => `base-of-${one}-and-${other.slice(0, 1)}`,
    readDiff: (range) => {
      ranges.push(range);
      return { diff: range[1] === "HEAD" ? diffFile("a.js", [3]) : diffFile("a.js", [2]) };
    },
  });
  assert.deepEqual(files, ["a.js"]);
  assert.deepEqual(ranges, [["base-of-HEAD^1-and-r", "r".repeat(40)], WHOLE_CHANGE]);
});

test("the first review and a push's have every kind of reviewer, and a review that reads nothing none", () => {
  assert.equal(listStageKinds("first"), KINDS);
  assert.equal(listStageKinds("push"), KINDS);
  assert.deepEqual(listStageKinds("final"), [FINAL_KIND]);
  assert.deepEqual(listStageKinds("none"), []);
});

test("each kind of reviewer names REVIEW.md's items by the number and title REVIEW.md gives them", () => {
  const guide = readFileSync(new URL("../REVIEW.md", import.meta.url), "utf8");
  const titles = new Map(
    [...guide.matchAll(/^(\d+)\. \*\*(.+?)\.?\*\*/gm)].map(([, number, title]) => [number, title]),
  );
  const cited = KINDS.flatMap(({ focus }) => [...focus.matchAll(/(\d+) \(([^)]+)\)/g)]);
  assert.ok(cited.length >= 11);
  for (const [, number, title] of cited) assert.equal(titles.get(number), title, number);
});

test("the stale names are written for the rules reviewer, each with where the repo still names it", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  writeReview(folder, {
    choice: { stage: "none" },
    since: null,
    pushed: null,
    readDiff: () => assert.fail("nothing is read"),
    repoFiles: [],
    stale: [{ name: "serveSnapshot", hits: ["AGENTS.md:351: the live snapshot"] }],
  });
  assert.match(
    readFileSync(join(folder, "stale-names.md"), "utf8"),
    /## serveSnapshot\n\n- AGENTS\.md:351: the live snapshot/,
  );
});

test("a stage's index names each file left unread and why", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  writeReview(folder, {
    choice: { stage: "first" },
    since: null,
    pushed: null,
    readDiff: () => ({
      numstat: "2\t0\tshared/page/sheet.js\n-\t-\ticon.png\n",
      diff: diffFile("shared/page/sheet.js", [2]),
    }),
    repoFiles: [],
    stale: [],
  });
  assert.match(
    readFileSync(join(folder, "first.md"), "utf8"),
    /## Not read\n\n- icon\.png: a binary file/,
  );
});

test("a push's range starts from the reviewed head merged onto the base, or from the head where that merge conflicts", () => {
  /** @type {string[][]} */
  const calls = [];
  const merged = findPushedRange("r".repeat(40), (args) => {
    calls.push(args);
    return "t".repeat(40) + "\nmore output\n";
  });
  assert.deepEqual(merged, { range: ["t".repeat(40), "HEAD"], hasBase: false });
  assert.deepEqual(calls, [["merge-tree", "--write-tree", "HEAD^1", "r".repeat(40)]]);
  assert.deepEqual(
    findPushedRange("r".repeat(40), () => null),
    { range: ["r".repeat(40), "HEAD^2"], hasBase: true },
  );
});
