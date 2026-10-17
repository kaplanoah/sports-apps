// The review's one summary comment on a pull request, and the last head it reviewed in full,
// which the summary carries so the next push's review reads only what changed since
// (plan-review.mjs), and which only a review that read everything it was due moves on
// (judge-review.mjs).

export const SUMMARY_MARKER = "<!-- claude-review-summary -->";
// The reviewers' steps post with the run's own token.
export const REVIEWER = "github-actions[bot]";
const STATE = /<!-- claude-review-state (\{.*?\}) -->/;

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
    return typeof head === "string" && /^[0-9a-f]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

/** @param {string} head */
export const writeReviewedHead = (head) =>
  `<!-- claude-review-state ${JSON.stringify({ head })} -->`;
