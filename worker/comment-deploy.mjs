// Comments on the pull request a Deploy run deployed once the run finishes, so the session that
// drives it, subscribed to its activity, hears the result without polling. On beta that's the
// open pull request holding beta, when the run deployed its head; on production, the one whose
// squash merge the run deployed, which GitHub names for the commit, as a squash's "(#N)" can be
// edited away. One comment for each channel and commit, edited when a re-run finishes. A run that
// checked nothing, like one waiting for CI on main, a superseded one, or one that found nothing
// to deploy, posts nothing.
import { fileURLToPath } from "node:url";
import { BETA_LABEL, findHolder, readOpenPulls } from "./beta-claim.mjs";
import { ACTIONS_LOGIN, createGitHub, readAllPages } from "./github-api.mjs";
import { hasDeployStarted } from "./report-deploy.mjs";
import { WORKER_CHECK_OK } from "./worker-results.mjs";

/** @typedef {import("./worker-results.mjs").WorkerResult} WorkerResult */

/**
 * @param {string} channel
 * @param {string} commit
 */
export const nameDeployMarker = (channel, commit) => `<!-- deploy:${channel}:${commit} -->`;

const UNCHANGED = "Not deployed or checked by this run";

// A Cloudflare error can quote its answer, which may name an address or the account's ID.
/** @param {string} text */
export const maskDetail = (text) =>
  text
    .replace(/https?:\/\/\S+/g, "<address>")
    .replace(/\b[\w-]+(\.[\w-]+)*\.workers\.dev\b/g, "<address>")
    .replace(/\b[0-9a-f]{32}\b/gi, "<id>")
    .replace(/\s+/g, " ")
    .replaceAll("|", "\\|")
    .trim();

/** @param {WorkerResult} result */
function describeResult({ result, detail }) {
  if (result === "checked") return WORKER_CHECK_OK;
  if (result === "failed") return `failed: ${maskDetail(detail ?? "")}`;
  return UNCHANGED;
}

/**
 * @param {object} deployment
 * @param {string} deployment.channel
 * @param {string} deployment.commit
 * @param {string} deployment.runUrl
 * @param {boolean} deployment.isFailed
 * @param {WorkerResult[]} deployment.results
 */
export function renderDeployComment({ channel, commit, runUrl, isFailed, results }) {
  const shortCommit = commit.slice(0, 7);
  const heading = isFailed
    ? `The ${channel} deploy of ${shortCommit} failed. Read [the run's log](${runUrl}) as the deploy-log skill says.`
    : `The ${channel} deploy of ${shortCommit} went through, as [the run's log](${runUrl}) says.`;
  const table = results.length
    ? [
        "",
        "| Worker | Version | Result |",
        "| --- | --- | --- |",
        ...results.map(
          (result) =>
            `| ${result.worker} | ${result.version ?? "unknown"} | ${describeResult(result)} |`,
        ),
      ]
    : ["", "The run stopped before it reported each Worker."];
  return [heading, ...table, "", nameDeployMarker(channel, commit)].join("\n");
}

/** @param {string} text the deploy job's worker-results output, empty when it wrote none */
function readResults(text) {
  if (!text) return [];
  try {
    const results = JSON.parse(text);
    return Array.isArray(results) ? /** @type {WorkerResult[]} */ (results) : [];
  } catch {
    return [];
  }
}

/**
 * @param {ReturnType<typeof createGitHub>} github
 * @param {string} commit
 * @returns {Promise<number | null>}
 */
async function findMergedPull(github, commit) {
  const pulls = await readAllPages(github, `/commits/${commit}/pulls`);
  const merged = pulls.find(
    (/** @type {{ merged_at: string | null, merge_commit_sha: string }} */ pull) =>
      pull.merged_at && pull.merge_commit_sha === commit,
  );
  return merged?.number ?? null;
}

/**
 * @param {{ repository: string, fetchImpl: typeof fetch, env: NodeJS.ProcessEnv }} options
 * @param {string} commit
 * @returns {Promise<number | null>}
 */
async function findBetaPull(options, commit) {
  const holder = findHolder(await readOpenPulls(options, [BETA_LABEL]));
  return holder?.headSha === commit ? holder.number : null;
}

/**
 * Posts the comment, or edits the one this run's channel and commit already has.
 * @param {ReturnType<typeof createGitHub>} github
 * @param {number} number
 * @param {string} body
 * @param {string} marker
 */
async function writeComment(github, number, body, marker) {
  const comments = await readAllPages(github, `/issues/${number}/comments`);
  const existing = comments.find(
    (/** @type {{ body?: string, user?: { login: string } }} */ comment) =>
      comment.user?.login === ACTIONS_LOGIN && comment.body?.includes(marker),
  );
  if (!existing) {
    await github(`/issues/${number}/comments`, { method: "POST", body: { body } });
    return "posted";
  }
  if (existing.body === body) return "kept";
  await github(`/issues/comments/${existing.id}`, { method: "PATCH", body: { body } });
  return "edited";
}

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.channel
 * @param {string} options.runUrl
 * @param {string} options.runId
 * @param {string} options.commit the commit the run deployed
 * @param {string} options.jobResult the deploy job's result, as GitHub gives it
 * @param {string} options.workerResults the deploy job's worker-results output
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<string>} what it did
 */
export async function commentDeploy({
  repository,
  channel,
  runUrl,
  runId,
  commit,
  jobResult,
  workerResults,
  fetchImpl = fetch,
  env = process.env,
}) {
  const results = readResults(workerResults);
  const github = createGitHub({ repository, fetchImpl, env });
  const isFailed =
    jobResult === "failure" ||
    (jobResult === "cancelled" && (await hasDeployStarted(github, runId)));
  if (!isFailed && !results.some(({ result }) => result !== "unchanged"))
    return "The run checked nothing, so no pull request hears of it";
  const options = { repository, fetchImpl, env };
  const number =
    channel === "beta" ? await findBetaPull(options, commit) : await findMergedPull(github, commit);
  if (!number) return `No pull request matches ${commit.slice(0, 7)} on ${channel}`;
  const body = renderDeployComment({ channel, commit, runUrl, isFailed, results });
  const outcome = await writeComment(github, number, body, nameDeployMarker(channel, commit));
  return `The deploy's comment on #${number} was ${outcome}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(
    await commentDeploy({
      repository: String(process.env.GITHUB_REPOSITORY),
      channel: String(process.env.CHANNEL),
      runUrl: String(process.env.RUN_URL),
      runId: String(process.env.RUN_ID),
      commit: String(process.env.COMMIT),
      jobResult: String(process.env.JOB_RESULT),
      workerResults: String(process.env.WORKER_RESULTS ?? ""),
    }),
  );
