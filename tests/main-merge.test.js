import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findNeedlessMainMerge } from "../worker/main-merge.mjs";

const LINES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * A repository with one commit, where `refs/remotes/origin/main` stands for main, and helpers to
 * branch, commit, and merge on it.
 * @param {import("node:test").TestContext} context
 */
function createHistory(context) {
  const cwd = mkdtempSync(join(tmpdir(), "main-merge-"));
  context.after(() => rmSync(cwd, { recursive: true, force: true }));
  /** @param {string[]} arguments_ */
  const readGit = (arguments_) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...arguments_,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  /**
   * @param {Record<string, string | Buffer>} files each file's content, by its path
   * @param {string} [message] which tells a squash on main from the commit it squashes
   */
  const commit = (files, message = "branch") => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(cwd, path, ".."), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
    readGit(["add", "."]);
    readGit(["commit", "-qm", message]);
    return readGit(["rev-parse", "HEAD"]);
  };
  /** @param {string} name @param {string} start */
  const branch = (name, start) => readGit(["checkout", "-qb", name, start]);
  /** @param {Record<string, string | Buffer>} files */
  const commitToMain = (files) => {
    readGit(["checkout", "-q", "--detach", "refs/remotes/origin/main"]);
    readGit(["update-ref", "refs/remotes/origin/main", commit(files, "main")]);
  };
  /** @param {string} name */
  const checkout = (name) => readGit(["checkout", "-q", name]);
  /** @param {string} revision */
  const merge = (revision) => {
    readGit(["merge", "-q", "--no-edit", revision]);
    return readGit(["rev-parse", "HEAD"]);
  };
  const find = () => findNeedlessMainMerge({ head: "HEAD", cwd });
  readGit(["init", "-q"]);
  const base = commit({ "notes.txt": `${LINES.join("\n")}\n`, "shared/page/sheet.js": "1;\n" });
  readGit(["update-ref", "refs/remotes/origin/main", base]);
  return { readGit, commit, branch, commitToMain, checkout, merge, find, base };
}

/** @param {number} line @param {string} text */
const editLine = (line, text) =>
  `${LINES.map((kept, index) => (index === line - 1 ? text : kept)).join("\n")}\n`;

test("a clean merge of main the branch didn't need is refused, sending it to the review label", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "feature.txt": "feature\n" });
  history.commitToMain({ "main.txt": "main\n" });
  history.checkout("feature");
  const merge = history.merge("origin/main");
  const reason = history.find() ?? "";
  assert.match(
    reason,
    new RegExp(`^Merge ${merge.slice(0, 7)} brings in main, which wasn't needed`),
  );
  assert.match(reason, /git reset --hard HEAD\^1/);
  assert.match(reason, /add the review label/);
});

test("a merge of main that resolves a conflict goes", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "notes.txt": editLine(5, "branch five") });
  history.commitToMain({ "notes.txt": editLine(5, "main five") });
  history.checkout("feature");
  assert.throws(() => history.merge("origin/main"));
  history.commit({ "notes.txt": editLine(5, "both fives") });
  assert.equal(history.find(), null);
});

test("a merge of main that keeps both sides of a conflict on adjacent lines, leaving the branch's own change as it was, goes", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "notes.txt": editLine(5, "branch five") });
  history.commitToMain({ "notes.txt": editLine(4, "main four") });
  history.checkout("feature");
  assert.throws(() => history.merge("origin/main"));
  const both = editLine(5, "branch five").replace("four", "main four");
  history.commit({ "notes.txt": both });
  assert.equal(history.find(), null);
});

test("a merge of main that brings in a red commit the branch lacked goes", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "feature.txt": "feature\n" });
  history.commitToMain({ "shared/page/sheet.js": "2;\n" });
  history.checkout("feature");
  history.merge("origin/main");
  assert.equal(history.find(), null);
});

test("a stacked branch's clean merge of main after its earlier pull request's squash goes", (context) => {
  const history = createHistory(context);
  history.branch("earlier", history.base);
  history.commit({ "earlier.txt": "earlier\n" });
  history.branch("stacked", "earlier");
  history.commit({ "stacked.txt": "stacked\n" });
  history.commitToMain({ "earlier.txt": "earlier\n" });
  history.checkout("stacked");
  history.merge("origin/main");
  assert.equal(history.find(), null);
});

test("a clean merge of main that edited a line one away from the branch's own is refused", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "notes.txt": editLine(5, "branch five") });
  history.commitToMain({ "notes.txt": editLine(3, "main three") });
  history.checkout("feature");
  history.merge("origin/main");
  assert.match(history.find() ?? "", /add the review label/);
});

test("a merge of a branch that isn't main is untouched", (context) => {
  const history = createHistory(context);
  history.branch("earlier", history.base);
  history.commit({ "earlier.txt": "earlier\n" });
  history.branch("stacked", "earlier");
  history.commit({ "stacked.txt": "stacked\n" });
  history.checkout("earlier");
  history.commit({ "earlier.txt": "earlier, reviewed\n" });
  history.checkout("stacked");
  history.merge("earlier");
  assert.equal(history.find(), null);
});

test("a needless merge of main already on origin is skipped", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "feature.txt": "feature\n" });
  history.commitToMain({ "main.txt": "main\n" });
  history.checkout("feature");
  const merge = history.merge("origin/main");
  history.readGit(["update-ref", "refs/remotes/origin/feature", merge]);
  history.commit({ "feature.txt": "feature, again\n" });
  assert.equal(history.find(), null);
});

test("a repository without origin's main is untouched", (context) => {
  const history = createHistory(context);
  history.branch("feature", history.base);
  history.commit({ "feature.txt": "feature\n" });
  history.commitToMain({ "main.txt": "main\n" });
  history.checkout("feature");
  history.merge("origin/main");
  history.readGit(["update-ref", "-d", "refs/remotes/origin/main"]);
  assert.equal(history.find(), null);
});
