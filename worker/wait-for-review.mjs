// Waits until CI's review of a pull request's head has finished, then prints whether it passed
// and every finding it posted on that head, in full, from every page of the pull request's
// comments, so a session reads all of a review's findings before it answers any. A cloud session
// holds no token, so it reads the public repo unsigned, asking about once a minute to keep within
// GitHub's limit for an address, and stops after about nine minutes, before a cloud session's
// command times out, saying to run it again. It reads the pull request again each time it asks,
// and stops when a newer push replaced the head, since the newer push's run cancels the head's
// review, or the pull request is a draft, which CI doesn't review.
// Usage: node worker/wait-for-review.mjs <pull request number>, in a clone of the repo. It exits
// with EXIT_CODES: 0 once the review passed, 1 once it didn't, 2 while it's still going, 3 when a
// newer push replaced the head, 4 when CI hasn't started on the head, as on a pull request in
// conflict, 5 for a draft, 6 once GitHub's limit for the address is used up, and 7 when it isn't
// handed a pull request's number.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GitHubError, createGitHub, readAllPages } from "./github-api.mjs";
import { REVIEWER, listFindingMarks, removeFindingMarks } from "./review-state.mjs";

// The job in ci.yml that finishes the review, whose check run says how it went.
const REVIEW_JOB = "review";
const POLL_MS = 60 * 1000;
const LONGEST_WAIT_MS = 9 * 60 * 1000;
// The review's check run starts only once every review job before it has finished, so until
// then whether CI started at all is told from whether the head has any check run.
const START_WAIT_MS = 3 * 60 * 1000;
const LIMIT_STATUSES = new Set([403, 429]);
const UNSIGNED_LIMIT = 60;

export const EXIT_CODES = Object.freeze({
  passed: 0,
  failed: 1,
  going: 2,
  replaced: 3,
  unstarted: 4,
  draft: 5,
  limited: 6,
  usage: 7,
});

/** @typedef {(path: string) => Promise<any>} ReadGitHub */

/** @typedef {{ outcome: "passed" | "failed", sha: string, conclusion: string }} Finished */

/**
 * @typedef {{ outcome: "replaced", sha: string, newer: string }
 *   | { outcome: "going" | "unstarted" | "draft", sha: string }} Stopped
 */

/** @typedef {Finished | Stopped} Wait */

/**
 * Whether the wait ended with the review finished.
 * @param {Wait} ended
 * @returns {ended is Finished}
 */
const isFinished = (ended) => ended.outcome === "passed" || ended.outcome === "failed";

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
 * The pull request's head and whether it's a draft.
 * @param {ReadGitHub} readGitHub
 * @param {string} pullNumber
 */
async function readPull(readGitHub, pullNumber) {
  const pull = await readGitHub(`/pulls/${pullNumber}`);
  return { head: String(pull.head.sha), isDraft: pull.draft === true };
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
 * Whether CI has started any check on a commit.
 * @param {ReadGitHub} readGitHub
 * @param {string} sha
 */
const hasAnyCheck = async (readGitHub, sha) =>
  (await readGitHub(`/commits/${sha}/check-runs?per_page=1`)).total_count > 0;

/**
 * What stops the wait on a head before its review finishes: a newer push, or a draft.
 * @param {{ head: string, isDraft: boolean }} pull
 * @param {string} sha
 * @returns {Stopped | null}
 */
function findStop(pull, sha) {
  if (pull.head !== sha) return { outcome: "replaced", sha, newer: pull.head };
  return pull.isDraft ? { outcome: "draft", sha } : null;
}

/**
 * How the wait for the review of a pull request's head ended, asking again about once a minute,
 * and reading the pull request each time, until the review finished, a newer push replaced the
 * head, the pull request is a draft, CI hasn't started on the head a few minutes on, or the wait
 * has gone as long as a session's command can.
 * @param {object} options
 * @param {ReadGitHub} options.readGitHub
 * @param {string} options.pullNumber
 * @param {(ms: number) => Promise<void>} options.wait
 * @param {() => number} options.now
 * @returns {Promise<Wait>}
 */
async function waitForReview({ readGitHub, pullNumber, wait, now }) {
  const started = now();
  const { head: sha, isDraft } = await readPull(readGitHub, pullNumber);
  if (isDraft) return { outcome: "draft", sha };
  let isStarted = false;
  for (;;) {
    const run = await readReviewRun(readGitHub, sha);
    const stop = findStop(await readPull(readGitHub, pullNumber), sha);
    if (stop) return stop;
    if (run?.status === "completed")
      return {
        outcome: run.conclusion === "success" ? "passed" : "failed",
        sha,
        conclusion: run.conclusion,
      };
    isStarted ||= Boolean(run);
    if (!isStarted && now() - started >= START_WAIT_MS) {
      isStarted = await hasAnyCheck(readGitHub, sha);
      if (!isStarted) return { outcome: "unstarted", sha };
    }
    if (now() - started + POLL_MS > LONGEST_WAIT_MS) return { outcome: "going", sha };
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
 * A comment of findings as the lines it prints: where it is, then its whole text, indented.
 * @param {{ spot: string, text: string }} comment
 */
const describeComment = ({ spot, text }) => [
  `- ${spot}:`,
  ...text.split("\n").map((line) => (line ? `  ${line}` : "")),
];

/** @param {number} count */
const countFindings = (count) => `${count} finding${count === 1 ? "" : "s"}`;

/**
 * The lines on a finished review: whether it passed, and every finding it posted on the head.
 * @param {ReadGitHub} readGitHub
 * @param {string} pullNumber
 * @param {{ sha: string, conclusion: string }} review
 */
async function describeFinished(readGitHub, pullNumber, { sha, conclusion }) {
  const comments = [
    ...(await readAllPages(readGitHub, `/pulls/${pullNumber}/comments`)),
    ...(await readAllPages(readGitHub, `/issues/${pullNumber}/comments`)),
  ];
  const found = listFindingComments(comments, sha);
  const total = found.reduce((sum, { count }) => sum + count, 0);
  const outcome =
    conclusion === "success" ? "passed" : `didn't pass (${conclusion}): read its summary`;
  return [
    `The review of ${sha.slice(0, 7)} ${outcome}, and posted ${countFindings(total)} on it.`,
    ...found.flatMap(describeComment),
  ];
}

/**
 * What to say when GitHub's limit for the address is used up, with when it resets.
 * @param {Date | null} resetsAt
 * @param {number} now
 */
export function describeLimit(resetsAt, now) {
  const lead = `GitHub's limit of ${UNSIGNED_LIMIT} requests an hour for this address is used up`;
  if (!resetsAt) return `${lead}: run this again within the hour.`;
  const minutes = Math.max(1, Math.ceil((resetsAt.getTime() - now) / 60000));
  return `${lead}: run this again in ${minutes} minute${minutes === 1 ? "" : "s"}, once it resets.`;
}

/**
 * What to say when the wait stopped before the review finished.
 * @param {Stopped} stopped
 * @param {string} pullNumber
 */
function describeStop(stopped, pullNumber) {
  const commit = stopped.sha.slice(0, 7);
  if (stopped.outcome === "replaced")
    return `${commit} was replaced by a newer push ${stopped.newer.slice(0, 7)}: run this again to wait for its review.`;
  if (stopped.outcome === "unstarted")
    return `CI hasn't started on ${commit}: check the PR for a merge conflict.`;
  if (stopped.outcome === "draft")
    return `#${pullNumber} is a draft, and a draft isn't reviewed until it's marked ready.`;
  return `The review of ${commit} is still going: run this again to wait for it.`;
}

/**
 * What the wait for a pull request's review says and the code it exits with.
 * @param {object} options
 * @param {ReadGitHub} options.readGitHub
 * @param {string} options.pullNumber
 * @param {(ms: number) => Promise<void>} options.wait
 * @param {() => number} options.now
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function reportReview(options) {
  const { readGitHub, pullNumber, now } = options;
  try {
    const ended = await waitForReview(options);
    const code = EXIT_CODES[ended.outcome];
    if (isFinished(ended))
      return { code, lines: await describeFinished(readGitHub, pullNumber, ended) };
    return { code, lines: [describeStop(ended, pullNumber)] };
  } catch (error) {
    if (!(error instanceof GitHubError) || !LIMIT_STATUSES.has(error.status)) throw error;
    return { code: EXIT_CODES.limited, lines: [describeLimit(error.resetsAt, now())] };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pullNumber = process.argv[2] ?? "";
  if (!/^\d+$/.test(pullNumber)) {
    console.error("Usage: node worker/wait-for-review.mjs <pull request number>");
    process.exit(EXIT_CODES.usage);
  }
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const { code, lines } = await reportReview({
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
  process.exitCode = code;
}
