// Waits until CI's review of a pull request's head has finished, then prints whether it passed
// and every finding it posted on that head, in full, from every page of the pull request's
// comments, so a session reads all of a review's findings before it answers any. The head's CI run
// is its newest one made since the pull request was last marked ready for review, since a draft's
// run passes its review without reviewing, and the review is that run's `review` job as its latest
// try has it, where a job a re-run left alone keeps its result. A cloud session holds no token, so
// it reads the public repo unsigned, within GitHub's limit of 60 requests an hour for an address:
// it reads the pull request and the last page of its events once, then, once every POLL_MS, asks
// for the head's CI run until there is one and for that run's jobs, reads the pull request again
// every PULL_EVERY asks, and stops after about nine minutes, before a cloud session's command
// times out, saying to run it again, so even an hour of waits back to back leaves room to read a
// finished review's comments. It stops when a newer push replaced the head, since the newer push's
// run cancels the head's review, or when the pull request is a draft, which CI doesn't review.
// Usage: node worker/wait-for-review.mjs <pull request number>, in a clone of the repo. It exits
// with EXIT_CODES: 0 once the review passed, 1 once it didn't, 2 while it's still going, 3 when a
// newer push replaced the head, 4 when CI hasn't started a run on the head since it was marked
// ready, as on a pull request in conflict, 5 for a draft, 6 once GitHub's limit is used up, and 7
// when it isn't handed a pull request's number.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GitHubError, createGitHub, readAllPages, readLastPage } from "./github-api.mjs";
import {
  listFindingMarks,
  pluralize,
  readReviewComments,
  removeFindingMarks,
} from "./review-state.mjs";

// The workflow that reviews a pull request, and its job that finishes the review.
const CI_WORKFLOW = "ci.yml";
const REVIEW_JOB = "review";
// Three asks a wait, the last re-reading the pull request, keep an hour of waits back to back
// under GitHub's limit with room for the last one's comments, which a test counts.
const POLL_MS = 4.5 * 60 * 1000;
const PULL_EVERY = 3;
const LONGEST_WAIT_MS = 9 * 60 * 1000;
// How long a head can go without a CI run before the wait says CI hasn't started on it.
const START_WAIT_MS = 3 * 60 * 1000;

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

/** @typedef {(path: string, request?: { withLastPage?: boolean }) => Promise<any>} ReadGitHub */

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
 * When the pull request was last marked ready for review, or 0 for one never a draft, from the
 * last page of its events, which are listed oldest first.
 * @param {ReadGitHub} readGitHub
 * @param {string} pullNumber
 */
async function readReadyAt(readGitHub, pullNumber) {
  const events = await readLastPage(readGitHub, `/issues/${pullNumber}/events`);
  const ready = events.filter((/** @type {any} */ event) => event.event === "ready_for_review");
  return ready.length ? Date.parse(ready.at(-1).created_at) : 0;
}

/**
 * The head's CI run: its newest made since the pull request was last marked ready, or null while
 * there's none.
 * @param {ReadGitHub} readGitHub
 * @param {{ sha: string, readyAt: number }} head
 */
async function readCiRun(readGitHub, { sha, readyAt }) {
  const { workflow_runs: runs } = await readGitHub(
    `/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${sha}&per_page=1`,
  );
  const [newest] = runs;
  return newest && Date.parse(newest.created_at) >= readyAt ? newest : null;
}

/**
 * A CI run's review job as its latest try has it, or null before the run has one.
 * @param {ReadGitHub} readGitHub
 * @param {number} runId
 */
async function readReviewJob(readGitHub, runId) {
  const jobs = await readAllPages(
    readGitHub,
    `/actions/runs/${runId}/jobs?filter=latest`,
    (answer) => answer.jobs,
  );
  return jobs.find((/** @type {any} */ job) => job.name === REVIEW_JOB) ?? null;
}

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
 * A finished review job as how the wait ended.
 * @param {any} job
 * @param {string} sha
 * @returns {Finished}
 */
const describeJob = (job, sha) => ({
  outcome: job.conclusion === "success" ? "passed" : "failed",
  sha,
  conclusion: job.conclusion,
});

/**
 * How the wait for the review of a pull request's head ended: the head's CI run's review job
 * finished, a newer push replaced the head, the pull request is a draft, the head has no CI run a
 * few minutes on, or the wait has gone as long as a session's command can.
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
  const readyAt = await readReadyAt(readGitHub, pullNumber);
  /** @type {any} */
  let ciRun = null;
  for (let ask = 1; ; ask += 1) {
    ciRun ??= await readCiRun(readGitHub, { sha, readyAt });
    if (!ciRun && now() - started >= START_WAIT_MS) return { outcome: "unstarted", sha };
    const job = ciRun && (await readReviewJob(readGitHub, ciRun.id));
    const isDone = job?.status === "completed";
    if (isDone || ask % PULL_EVERY === 0) {
      const stop = findStop(await readPull(readGitHub, pullNumber), sha);
      if (stop) return stop;
    }
    if (isDone) return describeJob(job, sha);
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
 * @param {any[]} comments the review's own, as readReviewComments reads them
 * @param {string} sha
 */
export const listFindingComments = (comments, sha) =>
  comments
    .filter((comment) => !comment.in_reply_to_id)
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

/**
 * The lines on a finished review: whether it passed, and every finding it posted on the head.
 * @param {ReadGitHub} readGitHub
 * @param {string} pullNumber
 * @param {{ sha: string, conclusion: string }} review
 */
async function describeFinished(readGitHub, pullNumber, { sha, conclusion }) {
  const found = listFindingComments(await readReviewComments(readGitHub, pullNumber), sha);
  const total = found.reduce((sum, { count }) => sum + count, 0);
  const outcome =
    conclusion === "success" ? "passed" : `didn't pass (${conclusion}): read its summary`;
  return [
    `The review of ${sha.slice(0, 7)} ${outcome}, and posted ${pluralize(total, "finding")} on it.`,
    ...found.flatMap(describeComment),
  ];
}

/**
 * What to say when GitHub refused a request for a limit, with when it lets requests through.
 * @param {{ limit: number | null, resetsAt: Date | null }} refusal
 * @param {number} now
 */
export function describeLimit({ limit, resetsAt }, now) {
  const lead = limit
    ? `GitHub's limit of ${limit} requests an hour is used up`
    : "GitHub is holding back requests";
  if (!resetsAt) return `${lead}: run this again in a minute.`;
  const minutes = Math.max(1, Math.ceil((resetsAt.getTime() - now) / 60000));
  return `${lead}: run this again in ${pluralize(minutes, "minute")}, once it lets requests through.`;
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
    if (!(error instanceof GitHubError) || !error.isLimited) throw error;
    return { code: EXIT_CODES.limited, lines: [describeLimit(error, now())] };
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
