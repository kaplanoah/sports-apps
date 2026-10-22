import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PART_BYTES,
  PART_LINES,
  chooseStage,
  explainUnread,
  findPushedRange,
  findTestedFile,
  formatJobOutputs,
  grepRepo,
  isReviewedOnBranch,
  listAreas,
  listDeletedFiles,
  listJobs,
  listStaleNames,
  nameCodeArea,
  planReview,
  readChangedFiles,
  splitDiffByFile,
  listPushedFiles,
  readPullHead,
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
  assert.equal(nameCodeArea(".claude/rules/page-look.md"), "docs");
  assert.equal(nameCodeArea(".claude/skills/add-league/SKILL.md"), "docs");
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
      () => [],
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

test("a root test of no file joins the tooling", () => {
  const areas = listAreas(
    [
      { path: "worker/deploy.mjs", lines: 200 },
      { path: "tests/browser/sheet-stack.spec.mjs", lines: 200 },
    ],
    REPO,
  );
  assert.deepEqual(
    areas.map(({ name, files }) => ({ name, files })),
    [{ name: "tooling", files: ["tests/browser/sheet-stack.spec.mjs", "worker/deploy.mjs"] }],
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

test("a big area splits between units, never between a file and its test", () => {
  const areas = listAreas(
    [
      { path: "worker/a.mjs", lines: 1500 },
      { path: "tests/a.test.js", lines: 600 },
      { path: "worker/b.mjs", lines: 1300 },
    ],
    [],
  );
  assert.deepEqual(
    areas.map(({ name, files }) => ({ name, files })),
    [
      { name: "tooling, part 1", files: ["worker/a.mjs", "tests/a.test.js"] },
      { name: "tooling, part 2", files: ["worker/b.mjs"] },
    ],
  );
});

test("a file whose path goes on from a code file's never falls between it and its test", () => {
  const areas = listAreas(
    [
      { path: "worker/a.mjs", lines: 1500 },
      { path: "worker/a.mjs.orig", lines: 300 },
      { path: "tests/a.test.js", lines: 600 },
      { path: "worker/b.mjs", lines: 1300 },
    ],
    [],
  );
  assert.deepEqual(
    areas.map(({ name, files }) => ({ name, files })),
    [
      { name: "tooling, part 1", files: ["worker/a.mjs", "tests/a.test.js"] },
      { name: "tooling, part 2", files: ["worker/a.mjs.orig", "worker/b.mjs"] },
    ],
  );
});

test("a change of any size in one area takes at most twelve parts, each bigger to hold it", () => {
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
  assert.deepEqual(plan.areas, [{ area: 1, name: "shared page", files: ["shared/page/sheet.js"] }]);
  assert.deepEqual(plan.unread, [
    { path: "apps/mlb/tests/fixtures/x.json", why: "a test's recorded data" },
    { path: "icon.svg", why: "a drawing or a minified library, written by a tool" },
    {
      path: "apps/mlb/page/js/sortable.min.js",
      why: "a drawing or a minified library, written by a tool",
    },
  ]);
});

test("each area has one reviewer, so the review has as many reviewers as areas", () => {
  const jobs = listJobs([
    { area: 1, name: "mlb page" },
    { area: 2, name: "docs" },
  ]);
  assert.deepEqual(jobs, {
    areas: [{ name: "mlb page" }, { name: "docs" }],
    areaNumbers: { "mlb page": 1, docs: 2 },
    count: 2,
  });
});

test("each area's matrix holds only the name its job shows", () => {
  const { areas } = listJobs([{ area: 1, name: "mlb page" }]);
  assert.ok(areas.every((area) => Object.keys(area).join() === "name"));
});

test("two areas of one name stop the plan rather than one area's job reviewing the other's", () => {
  const areas = [
    { area: 1, name: "docs" },
    { area: 2, name: "docs" },
  ];
  assert.throws(() => listJobs(areas), /Two areas share a name/);
});

test("the review's matrix is handed to ci.yml under the names its review jobs read", () => {
  assert.equal(
    formatJobOutputs(listJobs([{ area: 1, name: "mlb page" }])),
    ['areas=[{"name":"mlb page"}]', 'area-numbers={"mlb page":1}', "count=1"].join("\n"),
  );
  assert.equal(formatJobOutputs(listJobs([])), "areas=[]\narea-numbers={}\ncount=0");
});

test("the first review reads the whole change, a later one what changed, and a merge alone nothing", () => {
  const listChanged = () => ["a.js"];
  const [reviewed, head] = ["a".repeat(40), "b".repeat(40)];
  assert.deepEqual(chooseStage({ reviewedHead: null, head, isOnBranch: false, listChanged }), {
    stage: "first",
  });
  assert.deepEqual(chooseStage({ reviewedHead: reviewed, head, isOnBranch: false, listChanged }), {
    stage: "first",
  });
  assert.deepEqual(chooseStage({ reviewedHead: reviewed, head, isOnBranch: true, listChanged }), {
    stage: "push",
    files: ["a.js"],
  });
  assert.deepEqual(
    chooseStage({ reviewedHead: reviewed, head, isOnBranch: true, listChanged: () => [] }),
    { stage: "none" },
  );
});

test("the files a change deletes count a renamed file's old path, but not a file git finds only moved under its name", () => {
  /** @type {string[][]} */
  const asked = [];
  const deleted = listDeletedFiles((args) => {
    asked.push(args);
    return [
      "D\tapps/mlb/page/js/updates.js",
      "A\tapps/nba/page/js/updates.js",
      "R087\tshared/page/foo.js\tshared/page/bar.js",
      "R100\tapps/wnba/page/js/moved.js\tshared/page/moved.js",
      "M\tworker/deploy.mjs",
      "",
    ].join("\n");
  });
  assert.deepEqual(deleted, ["apps/mlb/page/js/updates.js", "shared/page/foo.js"]);
  assert.deepEqual(asked, [["diff", "--name-status", "--find-renames", ...WHOLE_CHANGE]]);
});

test("a search of the repo returns every line git matches, whole, or none", () => {
  const lines = Array.from({ length: 20 }, (_, index) => `AGENTS.md:${index + 1}:const NAME`);
  const long = `README.md:1:${"x".repeat(300)} NAME`;
  /** @type {string[][]} */
  const asked = [];
  const hits = grepRepo("NAME", true, (args) => {
    asked.push(args);
    return `${[...lines, long].map((line) => `HEAD:${line}`).join("\n")}\n`;
  });
  assert.deepEqual(hits, [...lines, long]);
  const none = grepRepo("const\\s+NAME", false, (args) => {
    asked.push(args);
    return null;
  });
  assert.deepEqual(none, []);
  assert.deepEqual(asked, [
    ["grep", "-n", "-I", "-wF", "-e", "NAME", "HEAD"],
    ["grep", "-n", "-I", "-E", "-e", "const\\s+NAME", "HEAD"],
  ]);
});

test("the pull request's head is the merge commit's second parent", () => {
  /** @type {string[][]} */
  const asked = [];
  const head = readPullHead((args) => {
    asked.push(args);
    return `${"a".repeat(40)}\n`;
  });
  assert.equal(head, "a".repeat(40));
  assert.deepEqual(asked, [["rev-parse", "HEAD^2"]]);
});

test("the reviewed head is on the branch only where git finds it an ancestor of the head", () => {
  const reviewed = "a".repeat(40);
  const head = "b".repeat(40);
  /** @type {string[][]} */
  const asked = [];
  const isOn = isReviewedOnBranch(reviewed, head, (args) => {
    asked.push(args);
    return "";
  });
  assert.equal(isOn, true);
  assert.deepEqual(asked, [["merge-base", "--is-ancestor", reviewed, head]]);
  assert.equal(
    isReviewedOnBranch(reviewed, head, () => null),
    false,
  );
  assert.equal(
    isReviewedOnBranch(null, head, () => ""),
    false,
  );
});

test("a run on the head the last full read ended on reads nothing and lists no pushed files", () => {
  const head = "a".repeat(40);
  const listChanged = () => assert.fail("a head already read in full has no pushes to list");
  assert.deepEqual(chooseStage({ reviewedHead: head, head, isOnBranch: true, listChanged }), {
    stage: "reviewed",
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
    const name = isWord ? pattern : (pattern.match(/\)(\w+)\(/)?.[1] ?? "");
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

test("a name defined past many matches isn't stale, and a stale one lists its first places", () => {
  const diff = ["-export const STILL_DEFINED = 1;", "-export const GONE = 1;"].join("\n");
  const docs = Array.from({ length: 20 }, (_, index) => `AGENTS.md:${index + 1}:const NAME`);
  /** @type {Record<string, string[]>} */
  const repo = {
    "STILL_DEFINED:false": [...docs, "shared/page/other.js:3:export const STILL_DEFINED = 1;"],
    "STILL_DEFINED:true": docs,
    "GONE:false": docs,
    "GONE:true": docs,
  };
  const grep = (/** @type {string} */ pattern, /** @type {boolean} */ isWord) => {
    const name = isWord ? pattern : (pattern.match(/\)(\w+)\(/)?.[1] ?? "");
    return repo[`${name}:${isWord}`] ?? [];
  };
  assert.deepEqual(listStaleNames(diff, grep, []), [{ name: "GONE", hits: docs.slice(0, 15) }]);
});

test("a deleted file's places that may name it come first, each cut short", () => {
  const longer = "AGENTS.md:1:`apps/mlb/page/js/updates.json` beside `shared/page/updates.js`";
  const others = Array.from(
    { length: 20 },
    (_, index) => `AGENTS.md:${index + 2}:the shared one, \`shared/page/updates.js\``,
  );
  const naming = [
    "README.md:3:`apps/mlb/page/js/updates.js` holds MLB's box",
    "README.md:4:MLB's `page/js/updates.js` shows the box",
    `README.md:5:${"x".repeat(240)} apps/mlb/page/js/updates.js`,
    'apps/mlb/page/index.html:9:<script src="./js/updates.js"></script>',
    "REVIEW.md:2:any `updates.js`",
  ];
  const grep = () => [longer, ...others, ...naming];
  assert.deepEqual(listStaleNames("", grep, ["apps/mlb/page/js/updates.js"]), [
    {
      name: "updates.js",
      hits: [...naming, longer, ...others].slice(0, 15).map((hit) => hit.slice(0, 220)),
    },
  ]);
});

test("a deleted shared file is named by its full path, the pages' #shared/ imports, and shared/ links", () => {
  /** @type {Record<string, string[]>} */
  const repo = {
    "updates.js": [
      "AGENTS.md:1:MLB's `apps/mlb/page/js/updates.js`",
      'apps/mlb/page/js/updates.js:7:import { listNotesToShow } from "#shared/updates.js";',
    ],
    "chrome.css": [
      "apps/wnba/page/chrome.css:1:a page's own",
      'apps/mlb/page/index.html:27:<link rel="stylesheet" href="shared/chrome.css" />',
    ],
    "sheet.js": [
      "AGENTS.md:2:MLB's `apps/mlb/page/js/sheet.js`",
      "AGENTS.md:9:`shared/page/sheet.js` holds the stack",
    ],
    "notifications.js": [
      "AGENTS.md:3:MLB's `apps/mlb/worker/src/notifications.js`",
      "AGENTS.md:5:`shared/worker/notifications.js` caps a night's",
    ],
  };
  const grep = (/** @type {string} */ pattern) => repo[pattern] ?? [];
  const deleted = [
    "shared/page/updates.js",
    "shared/page/chrome.css",
    "shared/page/sheet.js",
    "shared/worker/notifications.js",
  ];
  assert.deepEqual(
    listStaleNames("", grep, deleted).map(({ hits }) => hits[0]),
    Object.values(repo).map((hits) => hits[1]),
  );
});

test("a long line that holds .js: past its start never counts as a removed name's definition", () => {
  const diff = "-export const GONE = 1;";
  const long = `AGENTS.md:7:const GONE ${"x".repeat(240)} see worker/a.js: for more`;
  const grep = (/** @type {string} */ _pattern, /** @type {boolean} */ isWord) =>
    isWord ? ["AGENTS.md:8:GONE"] : [long];
  assert.deepEqual(listStaleNames(diff, grep, []), [{ name: "GONE", hits: ["AGENTS.md:8:GONE"] }]);
});

test("a removed name with a $ still defined elsewhere isn't stale, and one only a longer name starts is", () => {
  const diff = "-export const $gone = 1;\n-export const gone$ = 1;\n-export const $gon = 1;";
  const definitions = [
    "worker/a.js:3:const $gone = 2;",
    "worker/b.js:4:const gone$ = 2;",
    "worker/c.js:5:const $gonex = 3;",
  ];
  const grep = (/** @type {string} */ pattern, /** @type {boolean} */ isWord) =>
    isWord
      ? [`AGENTS.md:8:${pattern}`]
      : definitions.filter((hit) => new RegExp(pattern).test(hit.split(":").slice(2).join(":")));
  assert.deepEqual(listStaleNames(diff, grep, []), [{ name: "$gon", hits: ["AGENTS.md:8:$gon"] }]);
});

test("a changed file the diff has no part for stops the review rather than counting as read", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  assert.throws(
    () =>
      writeStage(folder, "first", {
        numstat: "1\t0\tmissing.js\n",
        diff: diffFile("other.js", [1]),
        repoFiles: [],
        rules: [],
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
    rules: [],
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

test("a review of a push reads only what it changed", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  /** @type {string[][]} */
  const ranges = [];
  const readDiff = (/** @type {string[]} */ range, /** @type {string[]} */ files = []) => {
    ranges.push([...range, ...files]);
    return { numstat: "3\t0\tshared/page/sheet.js\n", diff: diffFile("shared/page/sheet.js", [3]) };
  };
  const since = "b".repeat(40);
  const plan = writeReview(folder, {
    choice: { stage: "push", files: ["shared/page/sheet.js"] },
    since,
    pushed: ["merged-tree", "HEAD"],
    readDiff,
    repoFiles: [],
    listStale: () => [],
    rules: [],
  });
  assert.deepEqual(ranges, [["merged-tree", "HEAD", "shared/page/sheet.js"]]);
  assert.deepEqual(plan, {
    stage: "push",
    since,
    areas: [
      {
        area: 1,
        name: "shared page",
        files: ["shared/page/sheet.js"],
        partsByFile: { "shared/page/sheet.js": ["push/shared/page/sheet.js.diff"] },
        rules: [],
      },
    ],
    unread: [],
  });
  const index = readFileSync(join(folder, "push.md"), "utf8");
  assert.match(index, /hold only what the pushes since/);
  assert.match(
    index,
    /starts from git's conflict markers, so it shows how the conflict was resolved/,
  );
  assert.ok(
    index.includes(
      "`node worker/review-git.mjs show --diff-merges=first-parent HEAD -- <path>` shows a file's whole change.",
    ),
    "a reviewer runs git only through worker/review-git.mjs",
  );
  assert.deepEqual(JSON.parse(readFileSync(join(folder, "plan.json"), "utf8")), plan);
  assert.match(readFileSync(join(folder, "stale-names.md"), "utf8"), /Nothing the change removed/);
});

test("the first review reads the whole change", () => {
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
    listStale: () => [],
    rules: [],
  });
  assert.deepEqual(ranges, [["HEAD^1", "HEAD"]]);
  assert.deepEqual(
    plan.areas.map((area) => area.files),
    [["shared/page/sheet.js"]],
  );
  const index = readFileSync(join(folder, "first.md"), "utf8");
  assert.match(index, /The first review of this pull request/);
  assert.match(
    index,
    /## Area 1: shared page\n\n- shared\/page\/sheet\.js: first\/shared\/page\/sheet\.js\.diff/,
  );
});

test("a review with no reviewers reads nothing, and keeps the head the last full read ended on", () => {
  for (const stage of /** @type {const} */ (["none", "reviewed"])) {
    const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
    const plan = writeReview(folder, {
      choice: { stage },
      since: "b".repeat(40),
      pushed: null,
      readDiff: () => assert.fail("nothing is read"),
      repoFiles: [],
      listStale: () => assert.fail("no reviewer reads the stale names"),
      rules: [{ path: ".claude/rules/page.md", text: '---\npaths:\n  - "shared/**"\n---\n' }],
    });
    assert.ok(!existsSync(join(folder, "rules")), "no rule file is copied");
    assert.deepEqual(plan, { stage, since: "b".repeat(40), areas: [], unread: [] });
    assert.ok(!existsSync(join(folder, "stale-names.md")));
  }
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
    "shared/page/notifications.js",
    "shared/worker/notifications.js",
    "apps/mlb/page/js/updates.js",
    "shared/page/updates.js",
  ];
  const readImports = () => ["../shared/page/html.js", "../shared/worker/notifications.js"];
  assert.equal(
    findTestedFile("tests/notifications.test.js", [], repo, readImports),
    "shared/worker/notifications.js",
  );
  assert.equal(
    findTestedFile(
      "tests/notifications.test.js",
      ["shared/page/notifications.js"],
      repo,
      readImports,
    ),
    "shared/worker/notifications.js",
  );
  assert.equal(
    findTestedFile("tests/notifications.test.js", [], repo, () => []),
    "shared/page/notifications.js",
  );
  assert.equal(findTestedFile("tests/updates.test.js", [], repo), "shared/page/updates.js");
});

test("a root test's imports are read from the test itself", () => {
  const repo = ["shared/page/notifications.js", "shared/worker/notifications.js"];
  assert.equal(
    findTestedFile("tests/notifications.test.js", [], repo),
    "shared/worker/notifications.js",
  );
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

test("the files a push changed are the ones its reviewers read, so a merge that only moved a file's context reads none", () => {
  /** @type {string[][]} */
  const ranges = [];
  const read = (/** @type {string} */ numstat) =>
    listPushedFiles(["t".repeat(40), "HEAD"], (range) => {
      ranges.push(range);
      return { numstat };
    });
  assert.deepEqual(read("2\t1\tshared/page/a.js\n-\t-\tlogo.png\n"), [
    "shared/page/a.js",
    "logo.png",
  ]);
  assert.deepEqual(read(""), []);
  assert.deepEqual(ranges, [
    WHOLE_CHANGE,
    ["t".repeat(40), "HEAD"],
    WHOLE_CHANGE,
    ["t".repeat(40), "HEAD"],
  ]);
});

test("the stale names are written for the reviewers, each with where the repo still names it", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  writeReview(folder, {
    choice: { stage: "first" },
    since: null,
    pushed: null,
    readDiff: () => ({
      numstat: "2\t0\tshared/page/sheet.js\n",
      diff: diffFile("shared/page/sheet.js", [2]),
    }),
    repoFiles: [],
    listStale: () => [{ name: "serveSnapshot", hits: ["AGENTS.md:351: the live snapshot"] }],
    rules: [],
  });
  assert.match(
    readFileSync(join(folder, "stale-names.md"), "utf8"),
    /## serveSnapshot\n\n- AGENTS\.md:351: the live snapshot/,
  );
});

test("each area's index names the rule files whose paths match its files, each copied for its reviewers", () => {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  const pageRule = '---\npaths:\n  - "apps/*/page/**"\n  - "shared/page/**"\n---\n\n# Pages\n';
  const workerRule = '---\npaths:\n  - "shared/worker/**"\n---\n\n# Workers\n';
  const plan = writeReview(folder, {
    choice: { stage: "first" },
    since: null,
    pushed: null,
    readDiff: () => ({
      numstat: "200\t0\tapps/mlb/page/js/app.js\n200\t0\tworker/deploy.mjs\n",
      diff: diffFile("apps/mlb/page/js/app.js", [200]) + diffFile("worker/deploy.mjs", [200]),
    }),
    repoFiles: [],
    listStale: () => [],
    rules: [
      { path: ".claude/rules/page.md", text: pageRule },
      { path: ".claude/rules/worker.md", text: workerRule },
    ],
  });
  assert.deepEqual(
    plan.areas.map(({ name, rules }) => [name, rules]),
    [
      ["mlb page", ["rules/page.md"]],
      ["tooling", []],
    ],
  );
  assert.equal(readFileSync(join(folder, "rules/page.md"), "utf8"), pageRule);
  const index = readFileSync(join(folder, "first.md"), "utf8");
  assert.match(
    index,
    /## Area 1: mlb page\n\n- apps\/mlb\/page\/js\/app\.js: .*\n\nRule files: rules\/page\.md\n/,
  );
  assert.doesNotMatch(index.split("## Area 2")[1], /Rule files/);
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
    listStale: () => [],
    rules: [],
  });
  assert.match(
    readFileSync(join(folder, "first.md"), "utf8"),
    /## Not read\n\n- icon\.png: a binary file/,
  );
});

test("a push's range starts from the reviewed head merged onto the base, conflicts and all, and git failing otherwise fails the plan", () => {
  /** @type {string[][]} */
  const calls = [];
  const merged = findPushedRange("r".repeat(40), (args) => {
    calls.push(args);
    return "t".repeat(40) + "\n";
  });
  assert.deepEqual(merged, ["t".repeat(40), "HEAD"]);
  assert.deepEqual(calls, [["merge-tree", "--write-tree", "HEAD^1", "r".repeat(40)]]);
  const failWith = (/** @type {number} */ status) => () => {
    throw Object.assign(new Error("git failed"), {
      status,
      stdout: `${"c".repeat(40)}\nconflicts\n`,
    });
  };
  assert.deepEqual(findPushedRange("r".repeat(40), failWith(1)), ["c".repeat(40), "HEAD"]);
  assert.throws(() => findPushedRange("r".repeat(40), failWith(128)), /git failed/);
});

/**
 * A pull request in a git repository of its own, reviewed at `reviewedHead`: `moveMain` commits
 * to main, `pushMerge` merges main into the pull request with each conflicted file resolved as
 * given, `pushChange` commits to it, and `listPushed` checks out the pull request merged onto
 * main, as CI does, and chooses the review's stage.
 */
function createPullRequest({ stacked = false } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "plan-review-git-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (/** @type {string[]} */ args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: folder, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  /** @param {Record<string, string>} files */
  const commit = (files, message = "change") => {
    for (const [path, text] of Object.entries(files)) writeFileSync(join(folder, path), text);
    git(["add", "--all"]);
    git(["commit", "--quiet", "--message", message]);
    return git(["rev-parse", "HEAD"]).trim();
  };
  const lines = (/** @type {string} */ name) =>
    Array.from({ length: 10 }, (_, index) => `${name} ${index + 1}`);
  /** @param {string} name @param {Record<number, string>} edits */
  const writeLines = (name, edits) =>
    lines(name)
      .map((line, index) => edits[index + 1] ?? line)
      .join("\n") + "\n";
  git(["init", "--quiet", "--initial-branch", "main"]);
  commit({ "a.js": writeLines("a", {}), "b.js": writeLines("b", {}) });
  git(["checkout", "--quiet", "-b", "pull"]);
  if (stacked) {
    commit({ "b.js": writeLines("b", { 2: "pull b 2" }), "c.js": "earlier pull c\n" });
    git(["branch", "earlier"]);
  }
  const reviewedHead = commit({
    "a.js": writeLines("a", { 2: "pull a 2" }),
    "b.js": writeLines("b", { 2: "pull b 2" }),
  });
  return {
    reviewedHead,
    writeLines,
    /** @param {Record<string, string>} files */
    moveMain(files) {
      git(["checkout", "--quiet", "main"]);
      commit(files);
      git(["checkout", "--quiet", "pull"]);
    },
    squashEarlier() {
      git(["checkout", "--quiet", "main"]);
      git(["merge", "--quiet", "--squash", "earlier"]);
      git(["commit", "--quiet", "--message", "Squash earlier pull"]);
      git(["checkout", "--quiet", "pull"]);
    },
    /** @param {Record<string, string>} resolved */
    pushMerge(resolved) {
      try {
        git(["merge", "--quiet", "--no-edit", "main"]);
      } catch {
        commit(resolved, "Merge main");
      }
    },
    /** @param {Record<string, string>} files */
    pushChange: (files) => commit(files),
    readPush() {
      git(["checkout", "--quiet", "--detach", "main"]);
      git(["merge", "--quiet", "--no-ff", "--no-edit", "pull"]);
      const head = git(["rev-parse", "HEAD^2"]).trim();
      const pushed = findPushedRange(reviewedHead, git);
      /** @param {string[]} range @param {string[]} [files] */
      const readDiff = (range, files = []) => ({
        numstat: git(["diff", "--numstat", "--no-renames", ...range, "--", ...files]),
        diff: git(["diff", "--no-renames", ...range, "--", ...files]),
      });
      const choice = chooseStage({
        reviewedHead,
        head,
        isOnBranch: true,
        listChanged: () => listPushedFiles(pushed, readDiff),
      });
      return { choice, pushed, readDiff };
    },
    listPushed() {
      return this.readPush().choice;
    },
  };
}

test("a head whose only change since the last review is a merge of main plans no areas, even where main changed the same files", () => {
  const pull = createPullRequest();
  pull.moveMain({ "a.js": pull.writeLines("a", { 5: "main a 5" }), "c.js": "main c\n" });
  pull.pushMerge({});
  assert.deepEqual(pull.listPushed(), { stage: "none" });
});

test("a merge of main that conflicts has only how each conflict was resolved read, not what merged on its own", () => {
  const pull = createPullRequest();
  pull.moveMain({
    "a.js": pull.writeLines("a", { 5: "main a 5" }),
    "b.js": pull.writeLines("b", { 2: "main b 2" }),
    "c.js": "main c\n",
  });
  pull.pushMerge({ "b.js": pull.writeLines("b", { 2: "pull and main b 2" }) });
  assert.deepEqual(pull.listPushed(), { stage: "push", files: ["b.js"] });
});

test("a change pushed after a merge of main is read, and nothing the merge brought in", () => {
  const pull = createPullRequest();
  pull.moveMain({ "a.js": pull.writeLines("a", { 5: "main a 5" }) });
  pull.pushMerge({});
  pull.pushChange({ "d.js": "pull d\n" });
  assert.deepEqual(pull.listPushed(), { stage: "push", files: ["d.js"] });
});

test("a stacked pull after its earlier pull is squashed reads no file whose conflict accepts the base's copy", () => {
  const pull = createPullRequest({ stacked: true });
  pull.squashEarlier();
  pull.moveMain({ "b.js": pull.writeLines("b", { 2: "main b 2" }) });
  pull.pushMerge({ "b.js": pull.writeLines("b", { 2: "main b 2" }) });
  pull.pushChange({ "a.js": pull.writeLines("a", { 2: "pushed a 2" }) });
  const { choice, pushed, readDiff } = pull.readPush();
  const rawDiff = readDiff(pushed).diff;
  assert.match(rawDiff, /diff --git a\/b.js b\/b.js/);
  assert.match(rawDiff, /<<<<<<<|>>>>>>>/);
  assert.deepEqual(choice, { stage: "push", files: ["a.js"] });
  const folder = mkdtempSync(join(tmpdir(), "plan-review-"));
  const plan = writeReview(folder, {
    choice,
    since: pull.reviewedHead,
    pushed,
    readDiff,
    repoFiles: [],
    listStale: () => [],
    rules: [],
  });
  assert.deepEqual(
    plan.areas.flatMap(({ files }) => files),
    ["a.js"],
  );
  assert.equal(
    readFileSync(join(folder, "push/a.js.diff"), "utf8"),
    splitDiffByFile(rawDiff).get("a.js"),
  );
  assert.ok(!existsSync(join(folder, "push/b.js.diff")));
  assert.ok(!existsSync(join(folder, "push/c.js.diff")));
  assert.doesNotMatch(readFileSync(join(folder, "push.md"), "utf8"), /b\.js|c\.js/);
});

test("a push that reverts a file to the base's copy leaves it unread", () => {
  const pull = createPullRequest();
  pull.pushChange({ "a.js": pull.writeLines("a", {}) });
  assert.deepEqual(pull.listPushed(), { stage: "none" });
});
