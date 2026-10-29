// Tells the owner on a red pull request when all that's left is their phone test: every other
// check main requires passed, its review passed and isn't asked again, and no review thread is
// open. One comment for each head is enough, and a later head takes down the comments it outdated,
// so the comment on a pull request always speaks of the head it has. Each run reads every open
// pull request into main, since GitHub keeps one waiting run and cancels the one before it.
// Usage: node worker/phone-ready.mjs, with GH_TOKEN and GITHUB_REPOSITORY set, as Actions sets
// the last.
import { fileURLToPath } from "node:url";
import { BETA_LABEL, WAIT_LABEL, findHolder, readOpenPulls } from "./beta-claim.mjs";
import { createGitHub, createGraphQL, readAllPages } from "./github-api.mjs";
import { PHONE_CONTEXT, PHONE_OK_LABEL } from "./labeling.mjs";
import { readThreads } from "./review-context.mjs";

const REVIEW_LABEL = "review";
const COMMENTER = "github-actions[bot]";
const MARKER_PATTERN = /<!-- phone-ready:([0-9a-f]{40}) -->/;

/** @param {string} head */
export const nameReadyMarker = (head) => `<!-- phone-ready:${head} -->`;

/**
 * @typedef {object} PullState
 * @property {boolean} isDraft
 * @property {string[]} labels
 * @property {string[]} required the checks main's rules require
 * @property {{ id: number, name: string, conclusion: string | null }[]} checkRuns
 *   every check run on the head
 * @property {{ context: string, state: string }[]} statuses each context's latest status on the
 *   head
 * @property {number} openThreads review threads not yet resolved
 */

/**
 * The newest check run with each name.
 * @param {PullState["checkRuns"]} checkRuns
 */
const pickNewestRuns = (checkRuns) =>
  new Map(
    checkRuns.toSorted((first, second) => first.id - second.id).map((run) => [run.name, run]),
  );

/**
 * Whether a required check passed on the head, as a check run or a status.
 * @param {string} context
 * @param {Map<string, PullState["checkRuns"][number]>} newestRuns
 * @param {PullState["statuses"]} statuses
 */
function hasPassed(context, newestRuns, statuses) {
  const run = newestRuns.get(context);
  if (run) return run.conclusion === "success";
  return statuses.some((status) => status.context === context && status.state === "success");
}

/**
 * Whether the owner's phone test is all a pull request waits on: the gate holds it on the phone
 * status before anyone labeled it phone-ok, every other required check passed, no review is asked
 * for, and no thread is open. A pull request labeled phone-ok and still held needs a label again
 * or main's deploy, which the gate's own message says.
 * @param {PullState} pull
 */
function isReadyForPhone({ isDraft, labels, required, checkRuns, statuses, openThreads }) {
  if (isDraft || labels.includes(PHONE_OK_LABEL) || labels.includes(REVIEW_LABEL)) return false;
  if (openThreads > 0) return false;
  const isPhoneHeld = statuses.some(
    (status) => status.context === PHONE_CONTEXT && status.state === "pending",
  );
  const newestRuns = pickNewestRuns(checkRuns);
  return (
    isPhoneHeld &&
    required
      .filter((context) => context !== PHONE_CONTEXT)
      .every((context) => hasPassed(context, newestRuns, statuses))
  );
}

/**
 * The comments this workflow posted that say a pull request is ready for the phone, each with the
 * head it speaks of.
 * @param {{ id: number, body?: string, user?: { login?: string } }[]} comments
 */
const listReadyComments = (comments) =>
  comments.flatMap((comment) => {
    const head = comment.user?.login === COMMENTER && comment.body?.match(MARKER_PATTERN)?.[1];
    return head ? [{ id: comment.id, head }] : [];
  });

/**
 * Which ready comments a later head outdated, and whether to post one for the head.
 * @param {{ isReady: boolean, head: string, comments: { id: number, head: string }[] }} options
 */
function planReadyComment({ isReady, head, comments }) {
  return {
    outdated: comments.filter((comment) => comment.head !== head).map((comment) => comment.id),
    isPosted: isReady && !comments.some((comment) => comment.head === head),
  };
}

/**
 * Where a pull request stands with beta.
 * @param {number} number
 * @param {string[]} labels
 * @param {number | null} holder the pull request that holds beta, or null when beta is free
 */
export function describeBeta(number, labels, holder) {
  if (holder === number) return "It holds beta now, so the beta apps run it.";
  if (holder !== null && (labels.includes(BETA_LABEL) || labels.includes(WAIT_LABEL)))
    return `It waits for beta, which #${holder} holds, so try it once it's on beta.`;
  if (holder !== null) return `It isn't on beta yet, and #${holder} holds beta.`;
  return "It isn't on beta yet, and beta is free.";
}

/**
 * @param {string} head
 * @param {string} beta where the pull request stands with beta
 */
const renderReadyComment = (head, beta) =>
  [
    `This red change is ready for the phone test at ${head.slice(0, 7)}: every other check and its review passed, and no thread is open.`,
    "",
    "1. Open the beta apps.",
    "2. Try the change.",
    `3. Add the \`${PHONE_OK_LABEL}\` label.`,
    "",
    beta,
    "",
    nameReadyMarker(head),
  ].join("\n");

/**
 * The checks main's rules require.
 * @param {(path: string) => Promise<any>} github
 * @returns {Promise<string[]>}
 */
async function readRequiredChecks(github) {
  const rules = await github("/rules/branches/main");
  return rules
    .filter((/** @type {any} */ rule) => rule.type === "required_status_checks")
    .flatMap((/** @type {any} */ rule) =>
      rule.parameters.required_status_checks.map(
        (/** @type {{ context: string }} */ check) => check.context,
      ),
    );
}

/**
 * @param {object} options
 * @param {(path: string) => Promise<any>} options.github
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} options.callGraphQL
 * @param {string} options.repository as owner/name
 * @param {any} options.pull as GitHub lists an open pull request
 * @param {string[]} options.required
 * @returns {Promise<PullState>}
 */
async function readPullState({ github, callGraphQL, repository, pull, required }) {
  const head = pull.head.sha;
  const [owner, name] = repository.split("/");
  const [checkRuns, status, threads] = await Promise.all([
    readAllPages(github, `/commits/${head}/check-runs?filter=all`, (answer) => answer.check_runs),
    github(`/commits/${head}/status`),
    readThreads(callGraphQL, { owner, name, number: pull.number }),
  ]);
  return {
    isDraft: Boolean(pull.draft),
    labels: pull.labels.map((/** @type {{ name: string }} */ label) => label.name),
    required,
    checkRuns,
    statuses: status.statuses,
    openThreads: threads.filter((/** @type {any} */ thread) => !thread.isResolved).length,
  };
}

/**
 * @typedef {object} TellOptions
 * @property {string} repository as owner/name
 * @property {typeof fetch} [fetchImpl]
 * @property {NodeJS.ProcessEnv} [env] holds GH_TOKEN
 * @property {() => Promise<number | null>} [readHolder] the pull request that holds beta
 */

/**
 * Comments on each red pull request into main whose head waits only on the owner's phone, and
 * takes down the comments earlier heads left.
 * @param {TellOptions} options
 * @returns {Promise<number[]>} the pull requests it commented on
 */
export async function tellPhoneReady({
  repository,
  fetchImpl = fetch,
  env = process.env,
  readHolder = async () =>
    findHolder(await readOpenPulls({ repository, fetchImpl, env }, [BETA_LABEL]))?.number ?? null,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const callGraphQL = createGraphQL({ fetchImpl, env });
  const pulls = await readAllPages(github, "/pulls?state=open&base=main");
  const required = await readRequiredChecks(github);
  const told = [];
  for (const pull of pulls) {
    if (pull.head?.repo?.full_name !== repository) continue;
    const head = pull.head.sha;
    const state = await readPullState({ github, callGraphQL, repository, pull, required });
    const comments = listReadyComments(
      await readAllPages(github, `/issues/${pull.number}/comments`),
    );
    const plan = planReadyComment({ isReady: isReadyForPhone(state), head, comments });
    for (const id of plan.outdated)
      await github(`/issues/comments/${id}`, { method: "DELETE", readBody: false });
    if (!plan.isPosted) continue;
    const beta = describeBeta(pull.number, state.labels, await readHolder());
    await github(`/issues/${pull.number}/comments`, {
      method: "POST",
      body: { body: renderReadyComment(head, beta) },
    });
    told.push(pull.number);
  }
  return told;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const told = await tellPhoneReady({ repository: String(process.env.GITHUB_REPOSITORY) });
  console.log(
    told.length
      ? `Told ${told.map((number) => `#${number}`).join(", ")} the phone test is all that's left.`
      : "No red pull request newly waits only on the phone.",
  );
}
