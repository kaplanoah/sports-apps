// Keeps one open issue while production's deploy is failing, so its owner hears that main isn't
// live, and closes it once a run checks the live apps at its commit. A run that checks nothing,
// like one that waits for CI on main or one a newer merge supersedes, leaves the issue as it is.
// GitHub reports a job stopped by its time limit as cancelled, as it does a waiting job a newer
// run supersedes, so a cancelled deploy counts as failed only once it has started a step.
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { closeIssue, findOpenIssue, openIssue } from "./issues.mjs";

export const DEPLOY_ISSUE_TITLE = "The production deploy is failing";

/** @param {string} commit @param {string} runUrl */
const describeFailure = (commit, runUrl) =>
  `Deploying main at ${commit.slice(0, 7)} to production failed, so the live apps may not run what main holds. Read [the run's log](${runUrl}), as the ship skill's step 10 says, fix what it names, and re-run the latest Deploy run on main.\n\nThis issue closes itself once a Deploy run checks the live apps.`;

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.runUrl
 * @param {string} options.runId
 * @param {string} options.commit the commit the run deployed
 * @param {string} options.jobResult the deploy job's result, as GitHub gives it
 * @param {string} options.checkedCommit the commit the run checked production at, or ""
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<string>} what it did
 */
export async function reportDeploy({
  repository,
  runUrl,
  runId,
  commit,
  jobResult,
  checkedCommit,
  fetchImpl = fetch,
  env = process.env,
}) {
  const checked = Boolean(checkedCommit);
  if (!checked && jobResult !== "failure" && jobResult !== "cancelled")
    return "The run checked nothing, so the deploy issue stays as it is";
  const github = createGitHub({ repository, fetchImpl, env });
  if (!checked && jobResult === "cancelled" && !(await hasDeployStarted(github, runId)))
    return "The deploy was cancelled before it started, so the deploy issue stays as it is";
  const failed = !checked;
  const issue = findOpenIssue(await readAllPages(github, "/issues?state=open"), DEPLOY_ISSUE_TITLE);
  if (failed) {
    if (issue) return `The deploy failed again; #${issue.number} is open`;
    const number = await openIssue(github, DEPLOY_ISSUE_TITLE, describeFailure(commit, runUrl));
    return `The deploy failed, so #${number} is open`;
  }
  if (!issue) return "The deploy went through";
  await closeIssue(
    github,
    issue.number,
    `Production is checked at ${checkedCommit.slice(0, 7)}, as of [this run](${runUrl}).`,
  );
  return `The deploy went through, so #${issue.number} is closed`;
}

/**
 * Whether the run's deploy job started a step before it stopped.
 * @param {ReturnType<typeof createGitHub>} github
 * @param {string} runId
 */
async function hasDeployStarted(github, runId) {
  const jobs = await readAllPages(github, `/actions/runs/${runId}/jobs`, (answer) => answer.jobs);
  return jobs.some(
    (/** @type {{ name: string, steps?: unknown[] }} */ job) =>
      job.name === "deploy" && Boolean(job.steps?.length),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(
    await reportDeploy({
      repository: String(process.env.GITHUB_REPOSITORY),
      runUrl: String(process.env.RUN_URL),
      runId: String(process.env.RUN_ID),
      commit: String(process.env.COMMIT),
      jobResult: String(process.env.JOB_RESULT),
      checkedCommit: String(process.env.CHECKED_COMMIT ?? ""),
    }),
  );
