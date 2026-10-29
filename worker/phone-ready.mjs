// Tells the owner on a red pull request when all that's left is their phone test: every other
// check main requires passed, its review passed and isn't asked again, and no review thread is
// open. One comment speaks for each head while that holds, edited as beta changes hands, and is
// taken down once it doesn't, so the comment on a pull request is always true of the head it has.
// Each run reads every open pull request into main, since GitHub keeps one waiting run and cancels
// the one before it.
// Usage: node worker/phone-ready.mjs, with GH_TOKEN and GITHUB_REPOSITORY set, as Actions sets
// the last.
import { fileURLToPath } from "node:url";
import { BETA_LABEL, WAIT_LABEL, findHolder, readOpenPulls } from "./beta-claim.mjs";
import { ACTIONS_LOGIN, createGitHub, createGraphQL, readAllPages } from "./github-api.mjs";
import { PHONE_CONTEXT, PHONE_OK_LABEL } from "./labeling.mjs";
import { readThreads } from "./review-context.mjs";

const REVIEW_LABEL = "review";
const MARKER_PATTERN = /<!-- phone-ready:([0-9a-f]{40}) -->/;

/** @param {string} head */
export const nameReadyMarker = (head) => `<!-- phone-ready:${head} -->`;

/**
 * A check main's rules require, with the App that must post it when they name one.
 * @typedef {{ context: string, integrationId?: number }} RequiredCheck
 */

/** @typedef {{ id: number, name: string, conclusion: string | null, app?: { id: number } | null }} CheckRun */

/** @typedef {{ context: string, state: string }} Status each context's latest status on the head */

/** @typedef {{ id: number, head: string, body: string }} ReadyComment */

/**
 * Whether a pull request is the kind that waits on the phone test: the gate holds it on the phone
 * status before anyone labeled it phone-ok, and it isn't a draft or asking for a review. A pull
 * request labeled phone-ok and still held needs a label again or main's deploy, which the gate's
 * own message says.
 * @param {{ isDraft: boolean, labels: string[], statuses: Status[] }} pull
 */
function isHeldForPhone({ isDraft, labels, statuses }) {
  if (isDraft || labels.includes(PHONE_OK_LABEL) || labels.includes(REVIEW_LABEL)) return false;
  return statuses.some((status) => status.context === PHONE_CONTEXT && status.state === "pending");
}

/**
 * Whether a required check passed on the head: its newest check run from the App the rule names,
 * or, without one, its status.
 * @param {RequiredCheck} check
 * @param {CheckRun[]} checkRuns
 * @param {Status[]} statuses
 */
function hasPassed({ context, integrationId }, checkRuns, statuses) {
  const newest = checkRuns
    .filter((run) => run.name === context)
    .filter((run) => integrationId === undefined || run.app?.id === integrationId)
    .toSorted((first, second) => second.id - first.id)
    .at(0);
  if (newest) return newest.conclusion === "success";
  return statuses.some((status) => status.context === context && status.state === "success");
}

/**
 * Whether everything but the phone is done: every other required check passed and no thread is
 * open.
 * @param {{ required: RequiredCheck[], checkRuns: CheckRun[], statuses: Status[], openThreads: number }} pull
 */
function hasPassedAllButPhone({ required, checkRuns, statuses, openThreads }) {
  if (openThreads > 0) return false;
  return required
    .filter((check) => check.context !== PHONE_CONTEXT)
    .every((check) => hasPassed(check, checkRuns, statuses));
}

/**
 * The comments this workflow posted that say a pull request is ready for the phone, each with the
 * head it speaks of.
 * @param {{ id: number, body?: string, user?: { login?: string } }[]} comments
 * @returns {ReadyComment[]}
 */
const listReadyComments = (comments) =>
  comments.flatMap((comment) => {
    const head = comment.user?.login === ACTIONS_LOGIN && comment.body?.match(MARKER_PATTERN)?.[1];
    return head ? [{ id: comment.id, head, body: String(comment.body) }] : [];
  });

/**
 * What to do with a pull request's ready comments: keep the one for its head while it's ready,
 * edited to `body` when that changed, or post one, and take down every other.
 * @param {{ head: string, body: string | null, comments: ReadyComment[] }} options `body` is null
 *   when the pull request isn't ready
 */
function planReadyComment({ head, body, comments }) {
  const kept = body === null ? undefined : comments.find((comment) => comment.head === head);
  return {
    removed: comments.filter((comment) => comment !== kept).map((comment) => comment.id),
    edited: kept && kept.body !== body ? kept.id : null,
    isPosted: body !== null && !kept,
  };
}

/**
 * Where a pull request stands with beta, and what that asks before the test.
 * @param {number} number
 * @param {string[]} labels
 * @param {number | null} holder the pull request that holds beta, or null when beta is free
 */
export function describeBeta(number, labels, holder) {
  if (holder === number) return "It holds beta now, so the beta apps run it.";
  if (holder !== null && (labels.includes(BETA_LABEL) || labels.includes(WAIT_LABEL)))
    return `It waits for beta, which #${holder} holds, so start once it holds beta.`;
  if (holder !== null)
    return `It isn't on beta yet, and #${holder} holds beta, so ask its session to put it on beta first.`;
  return "It isn't on beta yet, so ask its session to put it on beta first.";
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
 * @returns {Promise<RequiredCheck[]>}
 */
async function readRequiredChecks(github) {
  const rules = await github("/rules/branches/main");
  return rules
    .filter((/** @type {any} */ rule) => rule.type === "required_status_checks")
    .flatMap((/** @type {any} */ rule) =>
      rule.parameters.required_status_checks.map(
        (/** @type {{ context: string, integration_id?: number }} */ check) => ({
          context: check.context,
          integrationId: check.integration_id,
        }),
      ),
    );
}

/**
 * Whether a pull request waits only on the phone, reading its checks and threads only once the
 * phone status holds it, so a run's requests grow with the red pull requests alone.
 * @param {object} options
 * @param {(path: string) => Promise<any>} options.github
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} options.callGraphQL
 * @param {string} options.repository as owner/name
 * @param {any} options.pull as GitHub lists an open pull request
 * @param {string[]} options.labels
 * @param {RequiredCheck[]} options.required
 */
async function isReadyForPhone({ github, callGraphQL, repository, pull, labels, required }) {
  const head = pull.head.sha;
  const { statuses } = await github(`/commits/${head}/status`);
  if (!isHeldForPhone({ isDraft: Boolean(pull.draft), labels, statuses })) return false;
  const [owner, name] = repository.split("/");
  const [checkRuns, threads] = await Promise.all([
    readAllPages(github, `/commits/${head}/check-runs?filter=all`, (answer) => answer.check_runs),
    readThreads(callGraphQL, { owner, name, number: pull.number }),
  ]);
  const openThreads = threads.filter((/** @type {any} */ thread) => !thread.isResolved).length;
  return hasPassedAllButPhone({ required, checkRuns, statuses, openThreads });
}

/**
 * @typedef {object} TellOptions
 * @property {string} repository as owner/name
 * @property {typeof fetch} [fetchImpl]
 * @property {NodeJS.ProcessEnv} [env] holds GH_TOKEN
 * @property {() => Promise<number | null>} [readHolder] the pull request that holds beta
 */

/**
 * Comments on each red pull request into main whose head waits only on the owner's phone, keeps
 * that comment's beta line current, and takes down the comments no longer true.
 * @param {TellOptions} options
 * @returns {Promise<number[]>} the pull requests it newly told
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
  /** @type {Promise<number | null> | undefined} */
  let holder;
  const readHolderOnce = () => (holder ??= readHolder());
  const told = [];
  for (const pull of pulls) {
    if (pull.head?.repo?.full_name !== repository) continue;
    const head = pull.head.sha;
    const labels = pull.labels.map((/** @type {{ name: string }} */ label) => label.name);
    const comments = listReadyComments(
      await readAllPages(github, `/issues/${pull.number}/comments`),
    );
    const isReady = await isReadyForPhone({
      github,
      callGraphQL,
      repository,
      pull,
      labels,
      required,
    });
    const body = isReady
      ? renderReadyComment(head, describeBeta(pull.number, labels, await readHolderOnce()))
      : null;
    const plan = planReadyComment({ head, body, comments });
    for (const id of plan.removed)
      await github(`/issues/comments/${id}`, { method: "DELETE", readBody: false });
    if (plan.edited !== null)
      await github(`/issues/comments/${plan.edited}`, { method: "PATCH", body: { body } });
    if (!plan.isPosted) continue;
    await github(`/issues/${pull.number}/comments`, { method: "POST", body: { body } });
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
