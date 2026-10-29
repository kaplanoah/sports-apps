// Keeps one summary per legacy or trusted review mode. Its authoritative state carries the last
// completed head and, for trusted review, its base. Finding marks identify what each review
// posted so retries do not duplicate it.
import { isGitObjectId } from "./git-object.mjs";
import { ACTIONS_LOGIN, readAllPages } from "./github-api.mjs";
import { isReviewSelection } from "./review-selection.mjs";

export const SUMMARY_MARKER = process.env.REVIEW_TRUSTED
  ? "<!-- trusted-review-summary -->"
  : "<!-- claude-review-summary -->";
// What a finding the check across areas couldn't settle is posted as, in place of its weight.
export const UNSURE = "Unsure";
// What a posted finding is marked, each weight and UNSURE, in the order the review posts and
// counts them.
export const WEIGHTS = ["Important", UNSURE, "Nit", "Pre-existing"];
// The comment that holds the findings on files a pull request doesn't change, which GitHub takes
// on no line.
export const OFF_DIFF_HEADING = "Findings on files this pull request doesn't change:";
const STATE_PREFIX = "<!-- claude-review-state ";
const STATE = /^<!-- claude-review-state (\{.*?\}) -->$/;
const FINDING_MARK = /<!-- claude-finding ([0-9a-f]{16}) ([0-9a-f]{40}) -->/g;

/** @param {{ provider?: string, selection?: string } | null | undefined} recorded @param {string | undefined} provider @param {string | undefined} selection */
export const matchesReviewProvider = (recorded, provider, selection) =>
  (recorded?.provider ?? "claude") === provider && (recorded?.selection ?? "initial") === selection;

/**
 * The review's own summary among a pull request's comments, never anyone else's that starts the
 * same way.
 * @param {any[]} comments as GitHub lists an issue's comments
 */
export const findSummary = (comments) =>
  comments.find(
    (comment) => comment.user?.login === ACTIONS_LOGIN && comment.body?.startsWith(SUMMARY_MARKER),
  ) ?? null;

/**
 * The summary's single authoritative state, or null for old, malformed or duplicate state.
 * @param {string | undefined} body
 * @returns {{ head: string | null, base?: string, provider?: string, selection?: string } | null}
 */
export function readReviewedState(body) {
  try {
    const lines = body?.split("\n") ?? [];
    if (lines[0] !== SUMMARY_MARKER || body.split(STATE_PREFIX).length !== 2) return null;
    const state = JSON.parse(lines[1]?.match(STATE)?.[1] ?? "{}");
    const keys = Object.keys(state).join(",");
    if (!["head", "head,base", "head,base,provider,selection"].includes(keys)) return null;
    if (
      keys === "head,base,provider,selection" &&
      (!["claude", "codex"].includes(state.provider) || !isReviewSelection(state.selection))
    )
      return null;
    if (state.head !== null && !isGitObjectId(state.head)) return null;
    if (state.base !== undefined && !isGitObjectId(state.base)) return null;
    return state;
  } catch {
    return null;
  }
}

// Model quotes remain readable without becoming authoritative review control marks.
/** @param {string} text */
export const escapeReviewText = (text) => text.replaceAll("<!--", "<\u2060!--");

/** @param {string | null} head @param {string} [base] @param {string} [provider] @param {string} [selection] */
export const writeReviewedHead = (head, base, provider, selection) =>
  `<!-- claude-review-state ${JSON.stringify({ head, ...(base ? { base } : {}), ...(provider ? { provider, selection } : {}) })} -->`;

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
  return comments.filter((comment) => comment.user?.login === ACTIONS_LOGIN);
}
