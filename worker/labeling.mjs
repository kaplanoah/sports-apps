// Reads when a pull request's labels were added and when its head was pushed, from its timeline
// and its head's check suites.
import { createGitHub, readAllPages } from "./github-api.mjs";

export const PHONE_OK_LABEL = "phone-ok";

/**
 * @typedef {object} TimelineEvent
 * @property {string} event
 * @property {string} [created_at] when GitHub recorded it
 * @property {{ name: string }} [label]
 * @property {{ login: string } | null} [actor]
 * @property {string} [body] a comment's text
 */

/**
 * @typedef {object} Labeling
 * @property {string | null} labeler who last added the label
 * @property {number} addedAt when it was last added, or NaN when it never was
 * @property {boolean} isAfterLastPush
 */

/** @param {TimelineEvent} event */
export const readEventTime = (event) => Date.parse(event.created_at ?? "");

/**
 * Who last added `label` to a pull request, when, and whether they added it after its head commit
 * reached GitHub and after its last force push, from its timeline. A commit's own date is when it
 * was made, which can be long before it was pushed, so the head's arrival comes from GitHub.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @param {number} headPushedAt when GitHub first saw the head commit, or NaN when it can't say
 * @returns {Labeling}
 */
export function findLabeling(events, label, headPushedAt) {
  const lastAdded = events
    .filter((event) => event.event === "labeled" && event.label?.name === label)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);
  if (!lastAdded) return { labeler: null, addedAt: Number.NaN, isAfterLastPush: false };
  const forcePushes = events.filter((event) => event.event === "head_ref_force_pushed");
  const lastPush = Math.max(headPushedAt, ...forcePushes.map(readEventTime));
  const addedAt = readEventTime(lastAdded);
  return {
    labeler: lastAdded.actor?.login ?? null,
    addedAt,
    isAfterLastPush: addedAt > lastPush,
  };
}

/**
 * Every event on a pull request's timeline, page by page.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.pullNumber
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 * @returns {Promise<TimelineEvent[]>}
 */
export const readTimeline = ({ repository, pullNumber, fetchImpl = fetch, env = process.env }) =>
  readAllPages(createGitHub({ repository, fetchImpl, env }), `/issues/${pullNumber}/timeline`);

/**
 * When GitHub first saw a commit: its earliest check suite, which GitHub makes as the push that
 * brings the commit arrives, or NaN when it has none.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.sha
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 */
export async function readPushTime({ repository, sha, fetchImpl = fetch, env = process.env }) {
  const github = createGitHub({ repository, fetchImpl, env });
  const { check_suites: suites } = await github(`/commits/${sha}/check-suites?per_page=100`);
  const times = suites.map((/** @type {{ created_at: string }} */ suite) =>
    Date.parse(suite.created_at),
  );
  return times.length ? Math.min(...times) : Number.NaN;
}
