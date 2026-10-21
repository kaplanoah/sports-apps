import test from "node:test";
import assert from "node:assert/strict";
import { findTitleProblem, readVersion } from "../worker/release.mjs";

const BASELINE = "3cf716ccf7c056c3e598a7e4ce82c0c591ac210c";
const NEW_APP_FIRST = "d".repeat(40);

const MLB_PAGE_FILE = "apps/mlb/page/js/app.js";
const APPS = ["mlb", "wnba"];

/**
 * main's squash merges since the app's baseline, oldest first, each a subject, which changes
 * baseball's page, or a subject and the files it changed.
 * @param {(string | { subject: string, files: string[] })[]} merges
 * @param {string} [baseline]
 */
const createGit =
  (merges, baseline = BASELINE) =>
  (args) => {
    if (args[0] === "merge-base") return "";
    if (args.includes("--format=%H")) {
      assert.deepEqual(args.slice(-2), ["--", "apps/nhl/"]);
      return `${NEW_APP_FIRST}\n`;
    }
    assert.deepEqual(args, [
      "log",
      "--first-parent",
      "--reverse",
      "--format=\x1e%s",
      "--name-only",
      "--diff-merges=first-parent",
      "--no-renames",
      `${baseline}..HEAD`,
    ]);
    return merges
      .map((merge) =>
        typeof merge === "string" ? { subject: merge, files: [MLB_PAGE_FILE] } : merge,
      )
      .map(({ subject, files }) => `\x1e${subject}\n\n${files.map((file) => `${file}\n`).join("")}`)
      .join("");
  };

test("each app's baseline commit is its version there", () => {
  assert.equal(readVersion("mlb", createGit([])), "2.32.2");
  assert.equal(readVersion("wnba", createGit([])), "1.14.1");
});

test("each merge's type moves the version from the one before it", () => {
  const cases = [
    { version: "2.32.3", merges: ["fix: Keep the tab bar at the bottom (#113)"] },
    { version: "2.32.3", merges: ["refactor: Name the release helpers (#113)"] },
    { version: "2.32.3", merges: ["build: Bump the dev-tools group (#113)"] },
    { version: "2.33.0", merges: ["feat: Show outs on live games (#113)"] },
    { version: "3.0.0", merges: ["feat!: Move the page to a new address (#113)"] },
    { version: "3.0.0", merges: ["fix!: Drop the old saved rankings (#113)"] },
    { version: "2.32.2", merges: ["docs: Explain versions (#113)", "test: Cover it (#114)"] },
    { version: "2.32.2", merges: ["ci: Retry the review (#113)", "chore: Tidy lint (#114)"] },
  ];
  for (const { version, merges } of cases) {
    assert.equal(readVersion("mlb", createGit(merges)), version, merges.join(" / "));
  }
});

test("a major change moves every app the merge deploys, through shared code too", () => {
  const merge = {
    subject: "feat!: Move the pages to a new address (#113)",
    files: ["shared/page/days.js"],
  };
  assert.equal(readVersion("mlb", createGit([merge])), "3.0.0");
  assert.equal(readVersion("wnba", createGit([merge])), "2.0.0");
});

test("a major change that names its app moves only that app's major version", () => {
  const files = ["apps/mlb/page/js/app.js", "shared/page/team-sheet.js"];
  const cases = [
    { subject: "feat(mlb)!: Drop the old saved rankings (#113)", mlb: "3.0.0", wnba: "1.15.0" },
    { subject: "fix(mlb)!: Drop the old saved rankings (#113)", mlb: "3.0.0", wnba: "1.14.2" },
    { subject: "feat(wnba)!: Move the page to a new address (#113)", mlb: "2.33.0", wnba: "2.0.0" },
  ];
  for (const { subject, mlb, wnba } of cases) {
    const git = createGit([{ subject, files }]);
    assert.deepEqual(
      { mlb: readVersion("mlb", git), wnba: readVersion("wnba", git) },
      { mlb, wnba },
      subject,
    );
  }
});

test("merges add up in order, and a bigger bump resets the smaller numbers", () => {
  const merges = [
    "fix: One (#113)",
    "fix: Two (#114)",
    "feat: Three (#115)",
    "fix: Four (#116)",
    "feat!: Five (#117)",
    "docs: Six (#118)",
    "feat: Seven (#119)",
    "fix: Eight (#120)",
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "3.1.1");
});

test("a merge whose title has no known type counts as a fix", () => {
  const merges = ["Count down to first pitch (#111)", "style: Even out rows (#113)"];
  assert.equal(readVersion("mlb", createGit(merges)), "2.32.4");
});

test("a merge that changes only other apps' folders leaves an app's version alone", () => {
  const merges = [
    { subject: "feat: Show the WNBA bracket (#130)", files: ["apps/wnba/page/js/app.js"] },
    {
      subject: "fix: Tidy both pages (#131)",
      files: ["apps/wnba/page/styles.css", "shared/page/chrome.css"],
    },
    { subject: "fix: Tidy the baseball page (#132)", files: ["apps/mlb/page/styles.css"] },
    { subject: "fix: Tidy the tooling (#133)", files: ["worker/build.mjs"] },
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "2.32.5");
});

test("a merge that changes only what the app's deploy skips leaves its version alone", () => {
  const merges = [
    { subject: "fix: Cover the bracket (#134)", files: ["apps/mlb/tests/bracket.test.js"] },
    { subject: "fix: Correct the README (#135)", files: ["README.md", "apps/mlb/README.md"] },
    { subject: "feat!: Check titles more (#136)", files: ["worker/check-pr-title.mjs"] },
    { subject: "fix: Run the tooling's tests (#137)", files: ["tests/release.test.js"] },
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "2.32.2");
});

test("a merge that changes the app's page, or what every app deploys, moves its version", () => {
  const merges = [
    {
      subject: "fix: Tidy the page and its test (#134)",
      files: [MLB_PAGE_FILE, "tests/a.test.js"],
    },
    { subject: "fix: Share a module (#135)", files: ["shared/page/days.js"] },
    { subject: "build: Bump the dev-tools group (#136)", files: ["package-lock.json"] },
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "2.32.5");
});

test("a merge commit's files are read against its first parent", () => {
  const git = (args) => {
    if (args[0] === "merge-base") return "";
    const files = args.includes("--diff-merges=first-parent") ? `${MLB_PAGE_FILE}\n` : "";
    return `\x1eMerge pull request #114 from a branch\n\n${files}`;
  };
  assert.equal(readVersion("mlb", git), "2.32.3");
});

test("an app with no baseline counts from 1.0.0 at the merge that added its folder", () => {
  const merges = [
    { subject: "fix: Tidy the baseball page (#132)", files: ["apps/mlb/page/styles.css"] },
    { subject: "feat: Show the hockey scores (#133)", files: ["apps/nhl/page/js/app.js"] },
  ];
  assert.equal(readVersion("nhl", createGit(merges, NEW_APP_FIRST)), "1.1.0");
});

test("without the baseline in HEAD's history, there's no version", () => {
  const git = (args) => {
    if (args[0] === "merge-base") throw new Error("not an ancestor");
    return "";
  };
  assert.equal(readVersion("mlb", git), null);
});

test("an app with no baseline and no merges yet has no version", () => {
  assert.equal(
    readVersion("nhl", () => ""),
    null,
  );
});

test("a title with a known type and a description passes", () => {
  for (const title of [
    "feat: Show outs on live games",
    "fix: Keep the tab bar at the bottom",
    "feat!: Move the page to a new address",
    "build: bump the dev-tools group with 2 updates",
  ]) {
    assert.equal(findTitleProblem(title, ["apps/mlb/page/js/app.js"]), null, title);
  }
});

test("a title without a known type, a colon, and a description is refused", () => {
  for (const title of [
    "Show outs on live games",
    "feature: Show outs on live games",
    "Feat: Show outs on live games",
    "feat:Show outs on live games",
    "feat: ",
  ]) {
    assert.match(
      findTitleProblem(title, ["apps/mlb/page/js/app.js"]),
      /^Start the title with a type: feat:, fix:, refactor:, build:, docs:, test:, ci:, chore:\./,
      title,
    );
  }
});

test("a type that doesn't release may change only what the deploy skips", () => {
  assert.equal(findTitleProblem("docs: Explain versions", ["README.md", "AGENTS.md"]), null);
  assert.equal(
    findTitleProblem("test: Cover the bracket", ["apps/mlb/tests/bracket.test.js"]),
    null,
  );
  assert.equal(
    findTitleProblem("chore: Tidy", [
      "README.md",
      "apps/mlb/page/js/app.js",
      "apps/mlb/page/styles.css",
    ]),
    "chore: doesn't release, but this changes what the Worker runs: apps/mlb/page/js/app.js, apps/mlb/page/styles.css. Use feat:, fix:, refactor:, build:.",
  );
});

test("a type that doesn't release can't mark a major change", () => {
  for (const title of ["docs!: Explain versions", "chore!: Tidy"]) {
    assert.match(
      findTitleProblem(title, ["README.md"]),
      /^(docs|chore): doesn't release, so it can't mark a major change\. Drop the !, or use feat:, fix:, refactor:, build:\.$/,
      title,
    );
  }
});

test("a major change may name the one Worker it breaks, among those it changes", () => {
  const files = ["apps/mlb/page/js/app.js", "shared/page/team-sheet.js"];
  for (const title of ["feat(mlb)!: Drop the old saved rankings", "fix(wnba)!: Drop a view"]) {
    assert.equal(findTitleProblem(title, files, APPS), null, title);
  }
  assert.equal(
    findTitleProblem("feat(nhl)!: Drop the old saved rankings", files, APPS),
    "There's no Worker named nhl. The Workers are: mlb, wnba.",
  );
  assert.equal(
    findTitleProblem("feat(wnba)!: Drop the old saved rankings", ["apps/mlb/page/js/app.js"], APPS),
    "This doesn't change what wnba's deploy runs, so it can't break wnba.",
  );
});

test("a scope is only for a major change", () => {
  const cases = [
    { title: "feat(mlb): Show outs on live games", files: ["apps/mlb/page/js/app.js"] },
    { title: "docs(mlb): Explain versions", files: ["README.md"] },
  ];
  for (const { title, files } of cases) {
    assert.equal(
      findTitleProblem(title, files, APPS),
      "A scope only names the one Worker a major change breaks, as in feat(mlb)!:. Drop (mlb).",
      title,
    );
  }
  assert.equal(
    findTitleProblem("docs(mlb)!: Explain versions", ["README.md"], APPS),
    "docs: doesn't release, so it can't mark a major change. Drop the !, or use feat:, fix:, refactor:, build:.",
  );
});

test("a type that releases may also change only what the deploy skips", () => {
  assert.equal(findTitleProblem("fix: Correct the README", ["README.md"]), null);
});
