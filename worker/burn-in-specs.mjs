// Lists the browser specs burn-in repeats: each one a pull request adds or changes, but for one
// that has passed burn-in on an earlier push and hasn't changed since. A helper the specs import
// or the config they run with that changed since then burns them all in again. A change to the
// page alone doesn't, since the spec already ran ten times as it is, and the browser job and the
// nightly run catch a test the page made flaky.
// Usage: node worker/burn-in-specs.mjs, in a full checkout of the pull request's merge commit,
// with GH_TOKEN, GITHUB_REPOSITORY, BRANCH (the pull request's head branch), and HEAD_SHA set. It
// writes the specs to $GITHUB_OUTPUT as specs=<spec> <spec>.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isPullRequestRun } from "./find-passed-ci.mjs";
import { createGitHub } from "./github-api.mjs";

const SPECS = "apps/*/tests/browser/*.spec.mjs";
const SPEC = /^apps\/[^/]+\/tests\/browser\/[^/]+\.spec\.mjs$/;
const SHARED_BY_SPECS = [
  /^tests\/browser\//,
  /^apps\/[^/]+\/tests\/browser\//,
  /^playwright\.config\.mjs$/,
  /^package(-lock)?\.json$/,
];
// A pull request's last few runs hold its last burn-in, and an older one would burn in as much.
const RUNS_READ = 10;
const JOBS_PAGE = 100;

/** @param {string} path */
const isSharedBySpecs = (path) =>
  !SPEC.test(path) && SHARED_BY_SPECS.some((pattern) => pattern.test(path));

/**
 * @param {string[]} changedSpecs the specs the pull request adds or changes
 * @param {string[] | null} sinceBurnedIn the files changed since the last head that passed burn-in,
 *   or null with no such head
 */
export function listSpecsToBurnIn(changedSpecs, sinceBurnedIn) {
  if (sinceBurnedIn === null || sinceBurnedIn.some(isSharedBySpecs)) return changedSpecs;
  return changedSpecs.filter((spec) => sinceBurnedIn.includes(spec));
}

/**
 * Whether a run's burn-in ran and every machine of it passed.
 * @param {{ name: string, conclusion: string | null }[]} jobs
 */
export const isBurnedIn = (jobs) => {
  const burnIn = jobs.filter((job) => job.name.startsWith("burn-in ("));
  return burnIn.length > 0 && burnIn.every((job) => job.conclusion === "success");
};

/**
 * @param {(path: string) => Promise<any>} readJson
 * @param {number} runId
 */
async function readJobs(readJson, runId) {
  const jobs = [];
  for (let page = 1; ; page += 1) {
    const batch = await readJson(`/actions/runs/${runId}/jobs?per_page=${JOBS_PAGE}&page=${page}`);
    jobs.push(...batch.jobs);
    if (batch.jobs.length < JOBS_PAGE) return jobs;
  }
}

/**
 * The newest head of the branch, before this one, on which burn-in passed.
 * @param {{ readJson: (path: string) => Promise<any>, branch: string, headSha: string }} options
 * @returns {Promise<string | null>}
 */
export async function findBurnedInHead({ readJson, branch, headSha }) {
  const { workflow_runs: runs } = await readJson(
    `/actions/workflows/ci.yml/runs?event=pull_request&status=completed&branch=${encodeURIComponent(branch)}&per_page=${RUNS_READ}`,
  );
  for (const run of runs.filter((each) => isPullRequestRun(each) && each.head_sha !== headSha))
    if (isBurnedIn(await readJobs(readJson, run.id))) return run.head_sha;
  return null;
}

/** @param {string[]} args */
const runGit = (args) => execFileSync("git", args, { encoding: "utf8" });

/** @param {string} output */
const listLines = (output) => output.split("\n").filter(Boolean);

/**
 * The files changed from a commit to the pull request's head, or null for a commit the checkout
 * doesn't hold, as after a force push.
 * @param {string} since
 */
function listChangedSince(since) {
  try {
    return listLines(runGit(["diff", "--name-only", "--no-renames", since, "HEAD^2"]));
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changedSpecs = listLines(
    runGit([
      "diff",
      "--name-only",
      "--no-renames",
      "--diff-filter=AM",
      "HEAD^1",
      "HEAD",
      "--",
      SPECS,
    ]),
  );
  const readJson = createGitHub({
    repository: String(process.env.GITHUB_REPOSITORY),
    fetchImpl: fetch,
    env: process.env,
  });
  const burnedIn = changedSpecs.length
    ? await findBurnedInHead({
        readJson,
        branch: String(process.env.BRANCH),
        headSha: String(process.env.HEAD_SHA),
      })
    : null;
  const specs = listSpecsToBurnIn(changedSpecs, burnedIn && listChangedSince(burnedIn));
  const passed = changedSpecs.filter((spec) => !specs.includes(spec));
  console.log(
    passed.length
      ? `Passed burn-in on ${burnedIn} and unchanged since: ${passed.join(", ")}.`
      : "No spec this pull request changes has passed burn-in as it is now.",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `specs=${specs.join(" ")}\n`);
}
