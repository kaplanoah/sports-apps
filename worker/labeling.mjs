// Reads when a pull request's labels were added and when a commit was pushed, from its timeline
// and the commit's check suites.
import { createGitHub, createGraphQL } from "./github-api.mjs";

export const PHONE_CONTEXT = "phone";
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
 * The event that last added `label` to a pull request, if any.
 * @param {TimelineEvent[]} events
 * @param {string} label
 */
const findLastAdded = (events, label) =>
  events
    .filter((event) => event.event === "labeled" && event.label?.name === label)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);

/**
 * When `label` was last added to a pull request, or NaN when it never was.
 * @param {TimelineEvent[]} events
 * @param {string} label
 */
export function findAddedAt(events, label) {
  const lastAdded = findLastAdded(events, label);
  return lastAdded ? readEventTime(lastAdded) : Number.NaN;
}

/**
 * Who last added `label` to a pull request, when, and whether they added it after a push and after
 * its last force push, from its timeline. A commit's own date is when it was made, which can be long
 * before it was pushed, so the push time comes from GitHub.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @param {number} pushedAt when GitHub first saw the pushed commit, or NaN when it can't say
 * @returns {Labeling}
 */
export function findLabeling(events, label, pushedAt) {
  const lastAdded = findLastAdded(events, label);
  if (!lastAdded) return { labeler: null, addedAt: Number.NaN, isAfterLastPush: false };
  const forcePushes = events.filter((event) => event.event === "head_ref_force_pushed");
  const lastPush = Math.max(pushedAt, ...forcePushes.map(readEventTime));
  const addedAt = readEventTime(lastAdded);
  return {
    labeler: lastAdded.actor?.login ?? null,
    addedAt,
    isAfterLastPush: addedAt > lastPush,
  };
}

/**
 * The label, force-push and comment events on a pull request, page by page.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.pullNumber
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 * @returns {Promise<TimelineEvent[]>}
 */
export async function readTimeline({
  repository,
  pullNumber,
  fetchImpl = fetch,
  env = process.env,
}) {
  const graphql = createGraphQL({ fetchImpl, env });
  const [owner, name] = repository.split("/");
  const events = [];
  let after = null;
  for (;;) {
    const data = await graphql(READ_TIMELINE, { owner, name, number: Number(pullNumber), after });
    const timeline = data.repository?.pullRequest?.timelineItems;
    if (!timeline) throw new Error("GitHub didn't return the pull request's timeline");
    events.push(...timeline.nodes.map(readTimelineEvent));
    if (!timeline.pageInfo.hasNextPage) return events;
    const next = timeline.pageInfo.endCursor;
    if (!next || next === after) throw new Error("GitHub didn't advance the timeline cursor");
    after = next;
  }
}

const READ_TIMELINE = `query ReadTimeline($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(first: 100, after: $after, itemTypes: [LABELED_EVENT, UNLABELED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, ISSUE_COMMENT]) {
        nodes {
          __typename
          ... on LabeledEvent { created_at: createdAt label { name } actor { login } }
          ... on UnlabeledEvent { created_at: createdAt label { name } actor { login } }
          ... on HeadRefForcePushedEvent { created_at: createdAt actor { login } }
          ... on IssueComment { created_at: createdAt body actor: author { login } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const TIMELINE_EVENT_NAMES = new Map([
  ["LabeledEvent", "labeled"],
  ["UnlabeledEvent", "unlabeled"],
  ["HeadRefForcePushedEvent", "head_ref_force_pushed"],
  ["IssueComment", "commented"],
]);

/** @param {Omit<TimelineEvent, "event"> & { __typename: string }} node @returns {TimelineEvent} */
function readTimelineEvent({ __typename, ...fields }) {
  const event = TIMELINE_EVENT_NAMES.get(__typename);
  if (!event) throw new Error(`GitHub returned an unexpected timeline event: ${__typename}`);
  return { ...fields, event };
}

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
