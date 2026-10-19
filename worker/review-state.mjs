// What CI's review keeps on a pull request: one summary comment, which carries the last head the
// review read in full so the next push's review reads only what changed since, and the findings
// it posts, each by its weight and marked with what it says and the head it was posted on, so no
// try posts one twice and the review can tell a finding an earlier head's review posted from a
// new one.

export const SUMMARY_MARKER = "<!-- claude-review-summary -->";
// The posting and summary steps post with the run's own token.
export const REVIEWER = "github-actions[bot]";
// What a finding a checker couldn't settle is posted as, in place of its weight.
export const UNSURE = "Unsure";
// What a posted finding is marked, each weight and UNSURE, in the order the review posts and
// counts them.
export const WEIGHTS = ["Important", UNSURE, "Nit", "Pre-existing"];
// The comment that holds the findings on files a pull request doesn't change, which GitHub takes
// on no line.
export const OFF_DIFF_HEADING = "Findings on files this pull request doesn't change:";
const STATE = /<!-- claude-review-state (\{.*?\}) -->/;
const FINDING_MARK = /<!-- claude-finding ([0-9a-f]{16}) ([0-9a-f]{40}) -->/g;
// A mark on a line of its own, as each item of a checklist of Nits ends.
const FINDING_MARK_LINE = new RegExp(String.raw`^[ \t]*${FINDING_MARK.source}[ \t]*(?:\n|$)`, "gm");

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
 * A comment's text as it reads, without the marks of the findings it carries.
 * @param {string} body
 */
export const removeFindingMarks = (body) =>
  body
    .replace(FINDING_MARK_LINE, "")
    .replace(FINDING_MARK, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
