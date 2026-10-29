// Reads when a pull request's labels were added and when a commit was pushed, from its timeline
// and the commit's check suites.
import { createGitHub, createGraphQL, readAllPages } from "./github-api.mjs";

export const PHONE_CONTEXT = "phone";
export const PHONE_OK_LABEL = "phone-ok";

/**
 * @typedef {object} TimelineEvent
 * @property {string} event
 * @property {string} [created_at] when GitHub recorded it
 * @property {{ name: string }} [label]
 * @property {{ login: string } | null} [actor]
 * @property {string} [body] a comment's text
 * @property {{ oid: string } | null} [head] the commit a force push left as the head
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
 * Who last added `label` to a pull request and when, or null and NaN when no one ever did.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @returns {{ labeler: string | null, addedAt: number }}
 */
export function findLastAdding(events, label) {
  const lastAdded = events
    .filter((event) => event.event === "labeled" && event.label?.name === label)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);
  if (!lastAdded) return { labeler: null, addedAt: Number.NaN };
  return { labeler: lastAdded.actor?.login ?? null, addedAt: readEventTime(lastAdded) };
}

/**
 * When a pull request's head was last force-pushed, or -Infinity when it never was.
 * @param {TimelineEvent[]} events
 */
export const findLastForcePushAt = (events) =>
  Math.max(...events.filter((event) => event.event === "head_ref_force_pushed").map(readEventTime));

/**
 * The last force push before `time`, when it was and the head it left, or -Infinity and null when
 * there was none.
 * @param {TimelineEvent[]} events
 * @param {number} time
 */
export function findLastForcePushBefore(events, time) {
  const lastForcePush = events
    .filter((event) => event.event === "head_ref_force_pushed" && readEventTime(event) < time)
    .toSorted((first, second) => readEventTime(first) - readEventTime(second))
    .at(-1);
  if (!lastForcePush) return { at: -Infinity, head: null };
  return { at: readEventTime(lastForcePush), head: lastForcePush.head?.oid ?? null };
}

/**
 * Who last added `label` to a pull request, when, and whether they added it after a push and after
 * its last force push, from its timeline. A commit's own date is when it was made, which can be long
 * before it was pushed, so the push time comes from GitHub.
 * @param {TimelineEvent[]} events
 * @param {string} label
 * @param {number} pushedAt when its head was first pushed to the pull request's branch, or NaN when
 *   it wasn't read
 * @returns {Labeling}
 */
export function findLabeling(events, label, pushedAt) {
  const { labeler, addedAt } = findLastAdding(events, label);
  const lastPush = Math.max(pushedAt, findLastForcePushAt(events));
  return { labeler, addedAt, isAfterLastPush: addedAt > lastPush };
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
          ... on HeadRefForcePushedEvent { created_at: createdAt actor { login } head: afterCommit { oid } }
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
 * When a commit was first pushed to `branch`: its earliest check suite there, which GitHub makes as
 * the push that brings the commit arrives, or NaN when it has none. A suite on another branch, like
 * beta or a scratch branch, says nothing of when the commit reached this one.
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.sha
 * @param {string} options.branch
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] holds GH_TOKEN
 */
export async function readPushTime({
  repository,
  sha,
  branch,
  fetchImpl = fetch,
  env = process.env,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const suites = await readAllPages(
    github,
    `/commits/${sha}/check-suites`,
    (answer) => answer.check_suites,
  );
  const times = suites
    .filter((/** @type {{ head_branch: string }} */ suite) => suite.head_branch === branch)
    .map((/** @type {{ created_at: string }} */ suite) => Date.parse(suite.created_at));
  return times.length ? Math.min(...times) : Number.NaN;
}
