// Waits until CI's review of a pull request's head has finished, then prints whether it passed
// and every finding it posted on that head, from every page of the pull request's comments, so a
// session reads all of a review's findings before it answers any. A cloud session holds no token,
// so it reads the public repo unsigned, asking about once a minute to keep within GitHub's limit
// for an address, and stops after about nine minutes, before a cloud session's command times out,
// saying to run it again.
// Usage: node worker/wait-for-review.mjs <pull request number>, in a clone of the repo.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { REVIEWER, listFindingMarks, removeFindingMarks } from "./review-state.mjs";

// The job in ci.yml that finishes the review, whose check run says how it went.
const REVIEW_JOB = "review";
const POLL_MS = 60 * 1000;
const LONGEST_WAIT_MS = 9 * 60 * 1000;

/** @typedef {(path: string) => Promise<any>} ReadGitHub */

/**
 * The repository a clone's origin names, as owner/name, whether the address is GitHub's or a
 * cloud session's proxy's.
 * @param {string} origin
 */
export function readRepository(origin) {
  const match = origin.trim().match(/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error("The clone's origin names no repository on GitHub.");
  return `${match[1]}/${match[2]}`;
}

/**
 * The latest run of the review's check on a commit, or null before it has started.
 * @param {ReadGitHub} readGitHub
 * @param {string} sha
 */
async function readReviewRun(readGitHub, sha) {
  const { check_runs: runs } = await readGitHub(
    `/commits/${sha}/check-runs?check_name=${REVIEW_JOB}`,
  );
  return (
    runs.toSorted((/** @type {any} */ one, /** @type {any} */ other) => other.id - one.id)[0] ??
    null
  );
}

/**
 * The review's finished run on a commit, asking again about once a minute, or null once it has
 * waited as long as a session's command can.
 * @param {object} options
 * @param {ReadGitHub} options.readGitHub
 * @param {string} options.sha
 * @param {(ms: number) => Promise<void>} options.wait
 * @param {() => number} options.now
 */
async function waitForReviewRun({ readGitHub, sha, wait, now }) {
  const deadline = now() + LONGEST_WAIT_MS;
  for (;;) {
    const run = await readReviewRun(readGitHub, sha);
    if (run?.status === "completed") return run;
    if (now() + POLL_MS > deadline) return null;
    await wait(POLL_MS);
  }
}

/**
 * Where a comment of the review's is: its file and the line it was posted on, its file alone, or
 * the pull request for one on no file.
 * @param {any} comment as GitHub lists a review comment or an issue comment
 */
function nameCommentSpot(comment) {
  if (!comment.path) return "the pull request";
  const line = comment.original_line ?? comment.line;
  return line ? `${comment.path}:${line}` : comment.path;
}

/**
 * The comments in which the review posted findings on a commit, never a reply, each with where it
 * is, its text without the marks, and how many findings it holds.
 * @param {any[]} comments the pull request's review comments and issue comments
 * @param {string} sha
 */
export const listFindingComments = (comments, sha) =>
  comments
    .filter((comment) => comment.user?.login === REVIEWER && !comment.in_reply_to_id)
    .map((comment) => ({
      spot: nameCommentSpot(comment),
      text: removeFindingMarks(comment.body ?? ""),
      count: listFindingMarks(comment.body).filter(({ head }) => head === sha).length,
    }))
    .filter(({ count }) => count > 0);

/**
 * A comment of findings as the lines it prints: where it is and its first line, then each item of
 * one that lists several.
 * @param {{ spot: string, text: string }} comment
 */
function describeComment({ spot, text }) {
  const [first, ...rest] = text.split("\n");
  const items = rest.filter((line) => line.startsWith("- ")).map((line) => `  ${line}`);
  return [`- ${spot}: ${first}`, ...items];
}

/** @param {number} count */
const countFindings = (count) => `${count} finding${count === 1 ? "" : "s"}`;

/**
 * Whether the review of a pull request's head passed and what it posted on it, once it finished,
 * as the lines to print, or that it's still going.
 * @param {object} options
 * @param {ReadGitHub} options.readGitHub
 * @param {string} options.pullNumber
 * @param {(ms: number) => Promise<void>} options.wait
 * @param {() => number} options.now
 */
export async function describeReview({ readGitHub, pullNumber, wait, now }) {
  const { head } = await readGitHub(`/pulls/${pullNumber}`);
  const commit = head.sha.slice(0, 7);
  const run = await waitForReviewRun({ readGitHub, sha: head.sha, wait, now });
  if (!run) return [`The review of ${commit} is still going: run this again to wait for it.`];
  const comments = [
    ...(await readAllPages(readGitHub, `/pulls/${pullNumber}/comments`)),
    ...(await readAllPages(readGitHub, `/issues/${pullNumber}/comments`)),
  ];
  const found = listFindingComments(comments, head.sha);
  const total = found.reduce((sum, { count }) => sum + count, 0);
  const outcome =
    run.conclusion === "success" ? "passed" : `didn't pass (${run.conclusion}): read its summary`;
  return [
    `The review of ${commit} ${outcome}, and posted ${countFindings(total)} on it.`,
    ...found.flatMap(describeComment),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pullNumber = process.argv[2] ?? "";
  if (!/^\d+$/.test(pullNumber)) {
    console.error("Usage: node worker/wait-for-review.mjs <pull request number>");
    process.exit(1);
  }
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const lines = await describeReview({
    readGitHub: createGitHub({
      repository: readRepository(origin),
      fetchImpl: fetch,
      env: process.env,
    }),
    pullNumber,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  });
  console.log(lines.join("\n"));
}
