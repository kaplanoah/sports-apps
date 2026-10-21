// Keeps the beta channel to one pull request at a time, while the owner tests it on the phone. A
// pull request claims beta with the beta label, and of the open ones labeled beta, the one labeled
// first holds it. A push to beta deploys only the holder's head. The Beta workflow, on each pull
// request event, takes beta off a pull request that closed, was pushed after its label, or got
// phone-ok after it, and off every one but the holder, which waits in line with beta-wait. Once
// beta is free, it comments on the one that has waited longest, which wakes whoever drives it.
// When another takes beta before the one told claims it, it comments that the one told stays
// first in line, which spends the telling, so it's told again once beta is free.
// GitHub keeps one waiting run of the workflow and cancels the one before it, so each run reads
// every pull request rather than the event that started it.
// Usage: node worker/beta-claim.mjs deploy <commit>, or node worker/beta-claim.mjs queue, with
// GH_TOKEN and GITHUB_REPOSITORY set, as Actions sets the last.
import { fileURLToPath } from "node:url";
import { GitHubError, createGitHub, readAllPages } from "./github-api.mjs";
import {
  PHONE_OK_LABEL,
  findLabeling,
  readEventTime,
  readPushTime,
  readTimeline,
} from "./labeling.mjs";

export const BETA_LABEL = "beta";
export const WAIT_LABEL = "beta-wait";

const LABELS = [
  {
    name: BETA_LABEL,
    color: "1d76db",
    description: "Holds the beta channel while the owner tests it on the phone",
  },
  { name: WAIT_LABEL, color: "c5def5", description: "Waits in line for the beta channel" },
];

export const FREE_MESSAGE = "Beta is free, and this pull request has waited longest.";
const FREE_MARKER = "<!-- beta-free -->";
const TAKEN_MARKER = "<!-- beta-taken -->";
const REFUSED = "so nothing was deployed to beta";

/** @typedef {import('./labeling.mjs').TimelineEvent} TimelineEvent */

/**
 * @typedef {object} PullRequest
 * @property {number} number
 * @property {boolean} isOpen
 * @property {string} headSha empty for a closed one
 * @property {string[]} labels
 * @property {TimelineEvent[]} events its timeline, empty for a closed one
 * @property {number} headPushedAt when GitHub first saw its head, or NaN when it wasn't read
 */

/** @typedef {{ number: number, label: string, isAdded: boolean }} LabelChange */

/**
 * @typedef {object} Plan
 * @property {number | null} holder
 * @property {LabelChange[]} changes
 * @property {number | null} told the pull request told beta is free
 * @property {number | null} taken the one told before the holder took beta, told it stays first
 */

/**
 * @param {PullRequest} pull
 * @param {string} label
 */
const hasLabel = (pull, label) => pull.labels.includes(label);

/**
 * When a label was last added to a pull request, or NaN when it never was.
 * @param {PullRequest} pull
 * @param {string} label
 */
const findAddedAt = (pull, label) => findLabeling(pull.events, label, pull.headPushedAt).addedAt;

/**
 * Orders pull requests by when a label was last added to them, earliest first, and one GitHub
 * can't date last.
 * @param {string} label
 */
const compareAdded =
  (label) => (/** @type {PullRequest} */ first, /** @type {PullRequest} */ second) => {
    const [firstAt, secondAt] = [first, second].map((pull) => {
      const addedAt = findAddedAt(pull, label);
      return Number.isNaN(addedAt) ? Infinity : addedAt;
    });
    return firstAt - secondAt || first.number - second.number;
  };

/** @param {number} time */
const formatTime = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Whether a pull request labeled beta has given it up: it closed or merged, its head was pushed
 * after the label, or it was labeled phone-ok after it. A phone-ok added before the label
 * stays on through a push, so only one added since counts.
 * @param {PullRequest} pull
 */
export function isReleased(pull) {
  if (!pull.isOpen) return true;
  const beta = findLabeling(pull.events, BETA_LABEL, pull.headPushedAt);
  if (!beta.isAfterLastPush) return true;
  return findAddedAt(pull, PHONE_OK_LABEL) > beta.addedAt;
}

/**
 * The pull request that holds beta: of the open ones labeled beta that haven't given it up, the
 * one labeled first, or null when beta is free.
 * @param {PullRequest[]} pulls
 * @returns {PullRequest | null}
 */
export const findHolder = (pulls) =>
  pulls
    .filter((pull) => hasLabel(pull, BETA_LABEL) && !isReleased(pull))
    .toSorted(compareAdded(BETA_LABEL))
    .at(0) ?? null;

/**
 * Whether a push of `commit` to beta may deploy: only when it's the head of the pull request that
 * holds beta.
 * @param {PullRequest[]} pulls
 * @param {string} commit
 * @returns {{ mayDeploy: boolean, message: string }}
 */
export function decideBetaDeploy(pulls, commit) {
  const holder = findHolder(pulls);
  const shortCommit = commit.slice(0, 7);
  if (!holder)
    return {
      mayDeploy: false,
      message: `No open pull request holds beta, ${REFUSED}. Claim beta for ${shortCommit}'s pull request first.`,
    };
  const since = formatTime(findAddedAt(holder, BETA_LABEL));
  if (holder.headSha !== commit)
    return {
      mayDeploy: false,
      message: `#${holder.number} has held beta since ${since}, and ${shortCommit} isn't its head, ${REFUSED}.`,
    };
  return {
    mayDeploy: true,
    message: `#${holder.number} has held beta since ${since}, and ${shortCommit} is its head, so it deploys.`,
  };
}

/**
 * The deploy check, refusing when GitHub can't say who holds beta.
 * @param {string} commit
 * @param {() => Promise<PullRequest[]>} readPulls
 */
export const checkBetaDeploy = (commit, readPulls) =>
  readPulls().then(
    (pulls) => decideBetaDeploy(pulls, commit),
    (/** @type {Error} */ error) => ({
      mayDeploy: false,
      message: `GitHub couldn't say who holds beta (${error.message}), ${REFUSED}.`,
    }),
  );

/**
 * The label changes one pull request needs: beta off one that gave it up, beta off one that
 * doesn't hold it, which goes in line, and beta-wait off one that closed.
 * @param {PullRequest} pull
 * @param {PullRequest | null} holder
 * @returns {LabelChange[]}
 */
function listLabelChanges(pull, holder) {
  const { number } = pull;
  const isWaiting = hasLabel(pull, WAIT_LABEL);
  if (!pull.isOpen)
    return [BETA_LABEL, WAIT_LABEL]
      .filter((label) => hasLabel(pull, label))
      .map((label) => ({ number, label, isAdded: false }));
  if (!hasLabel(pull, BETA_LABEL) || pull === holder) return [];
  const release = { number, label: BETA_LABEL, isAdded: false };
  if (isReleased(pull) || isWaiting) return [release];
  return [release, { number, label: WAIT_LABEL, isAdded: true }];
}

/**
 * When the workflow last commented on a pull request with `marker`, or -Infinity when it never
 * did.
 * @param {PullRequest} pull
 * @param {string} marker
 */
const findCommentedAt = (pull, marker) =>
  Math.max(
    -Infinity,
    ...pull.events
      .filter((event) => event.event === "commented" && event.body?.includes(marker))
      .map(readEventTime),
  );

/**
 * Whether a waiting pull request has been told beta is free since it last went in line. A telling
 * is spent once the one told claims beta, or once another takes beta first, so it can be told
 * again.
 * @param {PullRequest} pull
 */
function isTold(pull) {
  const toldAt = findCommentedAt(pull, FREE_MARKER);
  return (
    toldAt > findAddedAt(pull, WAIT_LABEL) &&
    !(findAddedAt(pull, BETA_LABEL) > toldAt) &&
    !(findCommentedAt(pull, TAKEN_MARKER) > toldAt)
  );
}

/**
 * The open pull requests waiting for beta, the one that has waited longest first.
 * @param {PullRequest[]} pulls
 */
export const listLine = (pulls) =>
  pulls
    .filter((pull) => pull.isOpen && hasLabel(pull, WAIT_LABEL))
    .toSorted(compareAdded(WAIT_LABEL));

/**
 * The pull request to tell beta is free: the one that has waited longest, unless it has been told
 * already, which leaves its turn to it.
 * @param {PullRequest[]} pulls
 * @returns {PullRequest | null}
 */
function findNextWaiter(pulls) {
  const [first] = listLine(pulls);
  return first && !isTold(first) ? first : null;
}

/**
 * The pull request told beta is free before another took it: the one that has waited longest,
 * while its telling is unspent and another holds beta.
 * @param {PullRequest[]} pulls
 * @param {PullRequest} holder
 * @returns {PullRequest | null}
 */
function findPassedWaiter(pulls, holder) {
  const [first] = listLine(pulls);
  return first && first !== holder && isTold(first) ? first : null;
}

/**
 * What one run of the Beta workflow does, from every pull request labeled beta or beta-wait: who
 * holds beta, the label changes, the pull request it tells beta is free, if any, and the one
 * told before another took beta, if any. It reads no event, so any run puts the labels right, a
 * run after one GitHub dropped too.
 * @param {PullRequest[]} pulls
 * @returns {Plan}
 */
export function planQueue(pulls) {
  const holder = findHolder(pulls);
  return {
    holder: holder?.number ?? null,
    changes: pulls.flatMap((pull) => listLabelChanges(pull, holder)),
    told: holder ? null : (findNextWaiter(pulls)?.number ?? null),
    taken: holder ? (findPassedWaiter(pulls, holder)?.number ?? null) : null,
  };
}

/**
 * The comment that tells a pull request another took beta before it claimed it.
 * @param {number} holder
 */
export const formatTakenMessage = (holder) =>
  `#${holder} took beta before this pull request claimed it, so it stays first in line.`;

/**
 * @typedef {object} ReadOptions
 * @property {string} repository as owner/name
 * @property {typeof fetch} [fetchImpl]
 * @property {NodeJS.ProcessEnv} [env] holds GH_TOKEN
 */

/**
 * The open pull requests with any of `labels`, each with its timeline, and when its head was
 * pushed when it's labeled beta.
 * @param {ReadOptions} options
 * @param {string[]} labels
 * @returns {Promise<PullRequest[]>}
 */
export async function readOpenPulls({ repository, fetchImpl = fetch, env = process.env }, labels) {
  const github = createGitHub({ repository, fetchImpl, env });
  const open = await readAllPages(github, "/pulls?state=open");
  const labeled = open
    .map((pull) => ({
      pull,
      names: pull.labels.map((/** @type {{ name: string }} */ label) => label.name),
    }))
    .filter(({ names }) => names.some((name) => labels.includes(name)));
  return Promise.all(
    labeled.map(async ({ pull, names }) => ({
      number: pull.number,
      isOpen: true,
      headSha: pull.head.sha,
      labels: names,
      events: await readTimeline({ repository, pullNumber: String(pull.number), fetchImpl, env }),
      headPushedAt: names.includes(BETA_LABEL)
        ? await readPushTime({ repository, sha: pull.head.sha, fetchImpl, env })
        : Number.NaN,
    })),
  );
}

/**
 * The closed pull requests still labeled beta or beta-wait.
 * @param {ReadOptions} options
 * @returns {Promise<PullRequest[]>}
 */
async function readClosedPulls({ repository, fetchImpl = fetch, env = process.env }) {
  const github = createGitHub({ repository, fetchImpl, env });
  const found = new Map();
  for (const label of [BETA_LABEL, WAIT_LABEL])
    for (const issue of await readAllPages(github, `/issues?state=closed&labels=${label}`))
      if (issue.pull_request) found.set(issue.number, issue);
  return [...found.values()].map((issue) => ({
    number: issue.number,
    isOpen: false,
    headSha: "",
    labels: issue.labels.map((/** @type {{ name: string }} */ label) => label.name),
    events: [],
    headPushedAt: Number.NaN,
  }));
}

/**
 * Makes the beta and beta-wait labels when the repository lacks them, so a session can add them.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} github
 */
async function createMissingLabels(github) {
  for (const label of LABELS)
    await github(`/labels/${label.name}`).catch((error) => {
      if (!(error instanceof GitHubError && error.status === 404)) throw error;
      return github("/labels", { method: "POST", body: label });
    });
}

/**
 * Adds or takes off one label, leaving the pull request's others as they are. A label already
 * taken off, as by a session meanwhile, is fine.
 * @param {(path: string, request?: { method?: string, body?: unknown }) => Promise<any>} github
 * @param {LabelChange} change
 */
function applyLabelChange(github, { number, label, isAdded }) {
  if (isAdded)
    return github(`/issues/${number}/labels`, { method: "POST", body: { labels: [label] } });
  return github(`/issues/${number}/labels/${label}`, { method: "DELETE" }).catch((error) => {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
  });
}

/**
 * Reads every pull request labeled beta or beta-wait, puts their labels right, and tells the
 * next in line when beta is free, or the one told that another took beta first.
 * @param {ReadOptions} options
 */
export async function updateQueue({ repository, fetchImpl = fetch, env = process.env }) {
  const github = createGitHub({ repository, fetchImpl, env });
  await createMissingLabels(github);
  const options = { repository, fetchImpl, env };
  const pulls = [
    ...(await readOpenPulls(options, [BETA_LABEL, WAIT_LABEL])),
    ...(await readClosedPulls(options)),
  ];
  const plan = planQueue(pulls);
  for (const change of plan.changes) await applyLabelChange(github, change);
  if (plan.told)
    await github(`/issues/${plan.told}/comments`, {
      method: "POST",
      body: { body: `${FREE_MESSAGE}\n\n${FREE_MARKER}` },
    });
  if (plan.taken && plan.holder)
    await github(`/issues/${plan.taken}/comments`, {
      method: "POST",
      body: { body: `${formatTakenMessage(plan.holder)}\n\n${TAKEN_MARKER}` },
    });
  return plan;
}

/**
 * The line of a run's log that says whom it told what.
 * @param {Plan} plan
 */
function describeTelling({ holder, told, taken }) {
  if (told) return `Told #${told} beta is free.`;
  if (taken) return `Told #${taken} that #${holder} took beta first.`;
  return "Told no one.";
}

/**
 * A run's log.
 * @param {Plan} plan
 */
export function describePlan(plan) {
  const { holder, changes } = plan;
  const lines = [holder ? `#${holder} holds beta.` : "Beta is free."];
  for (const { number, label, isAdded } of changes)
    lines.push(`${isAdded ? "Added" : "Took off"} ${label} on #${number}.`);
  lines.push(describeTelling(plan));
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, commit = ""] = process.argv.slice(2);
  const options = { repository: String(process.env.GITHUB_REPOSITORY) };
  if (command === "deploy") {
    const { mayDeploy, message } = await checkBetaDeploy(commit, () =>
      readOpenPulls(options, [BETA_LABEL]),
    );
    console.log(mayDeploy ? message : `::error::${message}`);
    if (!mayDeploy) process.exitCode = 1;
  } else if (command === "queue") {
    console.log(describePlan(await updateQueue(options)));
  } else {
    throw new Error("Say deploy <commit> or queue.");
  }
}
