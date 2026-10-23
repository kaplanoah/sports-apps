// What CI's review keeps on a pull request: one summary comment, which carries the last head the
// review read in full so the next review reads only what changed since, and the findings it
// posts, each by its weight and marked with what it says and the head it was posted on, so no try
// posts one twice and the review can tell a finding an earlier head's review posted from a new
// one.
import { readAllPages } from "./github-api.mjs";
import { isGitObjectId } from "./git-object.mjs";

export const SUMMARY_MARKER = "<!-- claude-review-summary -->";
// The posting and summary steps post with the run's own token.
export const REVIEWER = "github-actions[bot]";
// What a finding the check across areas couldn't settle is posted as, in place of its weight.
export const UNSURE = "Unsure";
// What a posted finding is marked, each weight and UNSURE, in the order the review posts and
// counts them.
export const WEIGHTS = ["Important", UNSURE, "Nit", "Pre-existing"];
// The comment that holds the findings on files a pull request doesn't change, which GitHub takes
// on no line.
export const OFF_DIFF_HEADING = "Findings on files this pull request doesn't change:";
const STATE = /<!-- claude-review-state (\{.*?\}) -->/;
const FINDING_MARK = /<!-- claude-finding ([0-9a-f]{16}) ([0-9a-f]{40}) -->/g;

/**
 * The review's own summary among a pull request's comments, never anyone else's that starts the
 * same way.
 * @param {any[]} comments as GitHub lists an issue's comments
 */
export const findSummary = (comments) =>
  comments.find(
    (comment) => comment.user?.login === REVIEWER && comment.body?.startsWith(SUMMARY_MARKER),
  ) ?? null;

/**
 * The head the summary says was last reviewed in full, or null when it names none, as a summary
 * from before the review kept one doesn't.
 * @param {string | undefined} body
 * @returns {string | null}
 */
export function readReviewedHead(body) {
  try {
    const head = JSON.parse(body?.match(STATE)?.[1] ?? "{}").head;
    return isGitObjectId(head) ? head : null;
  } catch {
    return null;
  }
}

/** @param {string} head */
export const writeReviewedHead = (head) =>
  `<!-- claude-review-state ${JSON.stringify({ head })} -->`;

/**
 * The mark a finding's comment carries, the same in every form it's posted in.
 * @param {string} key what the finding says
 * @param {string} head the head the review that posted it read
 */
export const writeFindingMark = (key, head) => `<!-- claude-finding ${key} ${head} -->`;

/**
 * The findings a comment carries, by their marks.
 * @param {string | undefined} body
 */
export const listFindingMarks = (body) =>
  [...(body ?? "").matchAll(FINDING_MARK)].map((match) => ({ key: match[1], head: match[2] }));

/**
 * Every comment the review posted on a pull request, from every page of its review comments and
 * then its conversation's, where the findings it posted are.
 * @param {(path: string) => Promise<any>} readGitHub
 * @param {string} pullNumber
 */
export async function readReviewComments(readGitHub, pullNumber) {
  const comments = [
    ...(await readAllPages(readGitHub, `/pulls/${pullNumber}/comments`)),
    ...(await readAllPages(readGitHub, `/issues/${pullNumber}/comments`)),
  ];
  return comments.filter((comment) => comment.user?.login === REVIEWER);
}
