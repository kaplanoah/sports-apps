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
import { PHONE_CONTEXT, PHONE_OK_LABEL, REVIEW_LABEL } from "./labeling.mjs";

const MARKER_PATTERN = /<!-- phone-ready:([0-9a-f]{40}) -->/;
const THREAD_STATES_QUERY = `query ($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved }
      }
    }
  }
}`;

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
 * Where a pull request's head stands: ready for the phone, not ready, or unsettled while a required
 * check's newest run is still going, which only its finish decides.
 * @typedef {"ready" | "not ready" | "unsettled"} Readiness
 */

/**
 * Whether a pull request could wait on the phone test, before reading its head: it isn't a draft,
 * asking for a review, or labeled phone-ok. A pull request labeled phone-ok and still held needs a
 * label again or main's deploy, which the gate's own message says.
 * @param {{ isDraft: boolean, labels: string[] }} pull
 */
const isAwaitingPhone = ({ isDraft, labels }) =>
  !isDraft && !labels.includes(PHONE_OK_LABEL) && !labels.includes(REVIEW_LABEL);

/** @param {Status[]} statuses */
const isHeldForPhone = (statuses) =>
  statuses.some((status) => status.context === PHONE_CONTEXT && status.state === "pending");

/**
 * Where a required check stands on the head: its newest check run from the App the rule names, or,
 * for a rule that names no App, its status, which anyone who can post statuses could post.
 * @param {RequiredCheck} check
 * @param {CheckRun[]} checkRuns
 * @param {Status[]} statuses
 * @returns {Readiness}
 */
function judgeCheck({ context, integrationId }, checkRuns, statuses) {
  const newest = checkRuns
    .filter((run) => run.name === context)
    .filter((run) => integrationId === undefined || run.app?.id === integrationId)
    .toSorted((first, second) => second.id - first.id)
    .at(0);
  const status = statuses.find((candidate) => candidate.context === context);
  const outcome = newest ? newest.conclusion : integrationId === undefined && status?.state;
  if (outcome === null || outcome === "pending") return "unsettled";
  return outcome === "success" ? "ready" : "not ready";
}

/**
 * Where everything but the phone stands: not ready once any other required check failed, unsettled
 * while one is still going, and ready once all passed.
 * @param {{ required: RequiredCheck[], checkRuns: CheckRun[], statuses: Status[] }} head
 * @returns {Readiness}
 */
function judgeAllButPhone({ required, checkRuns, statuses }) {
  const judged = required
    .filter((check) => check.context !== PHONE_CONTEXT)
    .map((check) => judgeCheck(check, checkRuns, statuses));
  if (judged.includes("not ready")) return "not ready";
  return judged.includes("unsettled") ? "unsettled" : "ready";
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
 * What to do with a pull request's ready comments: keep the one for its head unless the head isn't
 * ready, edited to `body` when ready and that changed, post one when ready and none is kept, and
 * take down every other.
 * @param {{ head: string, readiness: Readiness, body: string | null, comments: ReadyComment[] }} options
 *   `body` is null unless the head is ready
 */
function planReadyComment({ head, readiness, body, comments }) {
  const kept =
    readiness === "not ready" ? undefined : comments.find((comment) => comment.head === head);
  return {
    removed: comments.filter((comment) => comment !== kept).map((comment) => comment.id),
    edited: kept && body !== null && kept.body !== body ? kept.id : null,
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
 * How many of a pull request's review threads are open, page by page.
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} callGraphQL
 * @param {{ owner: string, name: string, number: number }} pull
 */
async function countOpenThreads(callGraphQL, pull) {
  let open = 0;
  let after = null;
  for (;;) {
    const data = await callGraphQL(THREAD_STATES_QUERY, { ...pull, after });
    const threads = data.repository?.pullRequest?.reviewThreads;
    if (!threads) throw new Error("GitHub didn't return the pull request's review threads");
    open += threads.nodes.filter((/** @type {any} */ thread) => !thread.isResolved).length;
    if (!threads.pageInfo.hasNextPage) return open;
    const next = threads.pageInfo.endCursor;
    if (!next || next === after) throw new Error("GitHub didn't advance the review thread cursor");
    after = next;
  }
}

/**
 * Where a pull request stands with the phone, reading its head only when it could wait on the
 * phone, and its checks and threads only once the phone status holds it, so a run's requests grow
 * with the red pull requests alone.
 * @param {object} options
 * @param {(path: string) => Promise<any>} options.github
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} options.callGraphQL
 * @param {string} options.repository as owner/name
 * @param {any} options.pull as GitHub lists an open pull request
 * @param {string[]} options.labels
 * @param {RequiredCheck[]} options.required
 * @returns {Promise<Readiness>}
 */
async function readReadiness({ github, callGraphQL, repository, pull, labels, required }) {
  if (!isAwaitingPhone({ isDraft: Boolean(pull.draft), labels })) return "not ready";
  const head = pull.head.sha;
  const { statuses } = await github(`/commits/${head}/status`);
  if (!isHeldForPhone(statuses)) return "not ready";
  const [owner, name] = repository.split("/");
  const [checkRuns, openThreads] = await Promise.all([
    readAllPages(github, `/commits/${head}/check-runs?filter=all`, (answer) => answer.check_runs),
    countOpenThreads(callGraphQL, { owner, name, number: pull.number }),
  ]);
  if (openThreads > 0) return "not ready";
  return judgeAllButPhone({ required, checkRuns, statuses });
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
    const readiness = await readReadiness({
      github,
      callGraphQL,
      repository,
      pull,
      labels,
      required,
    });
    const body =
      readiness === "ready"
        ? renderReadyComment(head, describeBeta(pull.number, labels, await readHolderOnce()))
        : null;
    const plan = planReadyComment({ head, readiness, body, comments });
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
