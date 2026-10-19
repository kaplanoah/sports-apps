// Finds a pull request's CI run that passed on exactly some code. A pull request's CI tests it
// merged into its base branch as that branch was then, and records that code's git tree: once
// every check passed and the gate didn't hold the change, so that main can deploy without waiting
// for CI to run again, since when the base is main and nothing else merged first, the squash merge
// has the same tree; and once every test passed, whatever the gate said, so that a label change,
// which brings no new code, runs only the gate again.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGitHub } from "./github-api.mjs";

export const CI_WORKFLOW = ".github/workflows/ci.yml";

/** @param {string} tree */
export const namePassedArtifact = (tree) => `ci-passed-${tree}`;

/** @param {string} tree */
export const nameTestedArtifact = (tree) => `ci-tested-${tree}`;

// Only a pull request's run of the CI workflow's path, from a branch of this repository. A branch's
// run uses the branch's own copy of the workflow, which only someone who can push here could
// change, while a fork's could be anyone's, and could record a tree it never tested.
export const isPullRequestRun = (run) =>
  run.path === CI_WORKFLOW &&
  run.event === "pull_request" &&
  run.head_repository?.id === run.repository?.id;

const isPassedPullRequestRun = (run) => isPullRequestRun(run) && run.conclusion === "success";

/**
 * @typedef {object} FindOptions
 * @property {string} tree the git tree to look for
 * @property {string} repository as owner/name
 * @property {typeof fetch} [fetchImpl]
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * The first run that recorded this artifact and that `isRecordingRun` accepts.
 * @param {Omit<FindOptions, "tree"> & { artifact: string, isRecordingRun: (run: any) => boolean }} options
 * @returns {Promise<number | null>} the run's id
 */
async function findRecordingRun({
  artifact,
  isRecordingRun,
  repository,
  fetchImpl = fetch,
  env = process.env,
}) {
  const readJson = createGitHub({ repository, fetchImpl, env });
  const { artifacts } = await readJson(`/actions/artifacts?name=${artifact}&per_page=100`);
  for (const { expired, workflow_run } of artifacts) {
    if (expired) continue;
    const run = await readJson(`/actions/runs/${workflow_run.id}`);
    if (isRecordingRun(run)) return run.id;
  }
  return null;
}

/**
 * A run on which every check passed and the gate didn't hold the change.
 * @param {FindOptions} options
 */
export const findPassedRun = ({ tree, ...options }) =>
  findRecordingRun({
    ...options,
    artifact: namePassedArtifact(tree),
    isRecordingRun: isPassedPullRequestRun,
  });

/**
 * A run on which every test passed. Its check may have held a red change, so the run's own
 * conclusion doesn't count: the record is made only once every test and the review passed.
 * @param {FindOptions} options
 */
export const findTestedRun = ({ tree, ...options }) =>
  findRecordingRun({
    ...options,
    artifact: nameTestedArtifact(tree),
    isRecordingRun: isPullRequestRun,
  });

const SEARCHES = {
  passed: {
    find: findPassedRun,
    missing: "No pull request's CI passed on exactly this code",
    found: (runId) => `CI run ${runId} passed on exactly this code, so it deploys now.`,
    waiting: "so the deploy waits for CI on main",
  },
  tested: {
    find: findTestedRun,
    missing: "No CI run passed every test on exactly this code",
    found: (runId) =>
      `CI run ${runId} passed every test on exactly this code, so only the gate runs again.`,
    waiting: "so every check runs again",
  },
};

/**
 * The run that passed on this code, or why it isn't there.
 * @param {keyof typeof SEARCHES} kind
 * @param {string} tree
 * @returns {Promise<{ runId: number } | { reason: string }>}
 */
async function lookForRun(kind, tree) {
  try {
    const repository = String(process.env.GITHUB_REPOSITORY);
    const runId = await SEARCHES[kind].find({ tree, repository });
    return runId ? { runId } : { reason: SEARCHES[kind].missing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reason: `Couldn't look for a passed CI run: ${message}` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const kind = process.argv.includes("--tested") ? "tested" : "passed";
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const found = await lookForRun(kind, tree);
  if ("runId" in found) {
    console.log(SEARCHES[kind].found(found.runId));
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `run=${found.runId}\n`);
  } else {
    console.log(`::notice::${found.reason}, ${SEARCHES[kind].waiting}.`);
  }
}
