// Says whether a pushed merge of main into a branch was needed. A merge restarts all of CI and
// voids an owner's phone-ok, while the review label already tests and reviews the pull request
// merged onto main's current tip, so a merge is needed only when the branch conflicts with main,
// lacks a red commit main has, or has a change against main that differs once main is in, as a
// stacked branch's does after the pull request it built on squash-merges.
import { execFileSync, spawnSync } from "node:child_process";
import { findMissingRedCommits } from "./red-change.mjs";

const MAIN = "origin/main";

/**
 * What a git command prints.
 * @param {string} cwd @param {string[]} arguments_ @param {string} [input]
 */
const readGit = (cwd, arguments_, input) =>
  execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

/**
 * Whether a git command that answers by its exit status says yes (0) or no (1).
 * @param {string} cwd @param {string[]} arguments_
 */
function askGit(cwd, arguments_) {
  const { status, stderr } = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  if (status === 0) return true;
  if (status === 1) return false;
  throw new Error(`git ${arguments_[0]} failed: ${stderr.trim()}`);
}

/** @param {string} cwd @param {string} ancestor @param {string} commit */
const isAncestor = (cwd, ancestor, commit) =>
  askGit(cwd, ["merge-base", "--is-ancestor", ancestor, commit]);

/** @param {string} cwd */
const hasMain = (cwd) => askGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/${MAIN}`]);

/** @param {string} cwd @param {string} ours @param {string} theirs */
const hasConflict = (cwd, ours, theirs) =>
  !askGit(cwd, ["merge-tree", "--write-tree", ours, theirs]);

/**
 * A diff's patch ID, which ignores its line numbers, or "" for an empty diff.
 * @param {string} cwd @param {string[]} revisions
 */
function readPatchId(cwd, revisions) {
  const diff = readGit(cwd, ["diff", "-U0", "--no-ext-diff", "--no-textconv", ...revisions, "--"]);
  return readGit(cwd, ["patch-id", "--stable"], `${diff}\n`).split(" ")[0];
}

/**
 * Whether merging main's commit changed the branch's own change against main. With no context
 * lines, main's edits beside the branch's lines don't count.
 * @param {string} cwd @param {string} merge @param {string} parent @param {string} main
 */
const changesOwnDiff = (cwd, merge, parent, main) =>
  readPatchId(cwd, [`${main}...${parent}`]) !== readPatchId(cwd, [main, merge]);

/**
 * Whether a merge needed to bring in main's commit.
 * @param {string} cwd @param {string} merge @param {string} parent @param {string} main
 */
const isNeeded = (cwd, merge, parent, main) =>
  hasConflict(cwd, parent, main) ||
  findMissingRedCommits({ main, head: parent, cwd }).length > 0 ||
  changesOwnDiff(cwd, merge, parent, main);

/**
 * Whether a merge brings in main and needed none of what it brings.
 * @param {string} cwd @param {string[]} parents the merge, its first parent, and what it merges
 */
function isNeedlessMainMerge(cwd, [merge, parent, ...merged]) {
  const mainParents = merged.filter(
    (commit) => isAncestor(cwd, commit, MAIN) && !isAncestor(cwd, commit, parent),
  );
  return mainParents.length > 0 && mainParents.every((main) => !isNeeded(cwd, merge, parent, main));
}

/**
 * Why pushing a commit is refused for an unpublished merge of main it didn't need, or null.
 * @param {{ head: string, cwd?: string }} options
 * @returns {string | null}
 */
export function findNeedlessMainMerge({ head, cwd = process.cwd() }) {
  if (!hasMain(cwd)) return null;
  const needless = readGit(cwd, [
    "rev-list",
    "--merges",
    "--parents",
    head,
    "--not",
    "--remotes=origin",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "))
    .find((commits) => isNeedlessMainMerge(cwd, commits));
  if (!needless) return null;
  return (
    `Merge ${needless[0].slice(0, 7)} brings in main, which wasn't needed: it has no conflict, ` +
    "no red commit is missing from the branch, and the pull request's own change is unchanged. " +
    "Drop the merge commit (for example git reset --hard HEAD^1 if it's the newest commit and " +
    "the tree is clean) and add the review label, which tests and reviews the pull request " +
    "merged onto current main."
  );
}
