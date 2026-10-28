// Joins a code-bound result from the trusted review workflow using read-only Actions access.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createGitHub, GitHubError, readAllPages } from "./github-api.mjs";
import { readReviewIdentity, validateReviewArtifact } from "./review-data.mjs";
import { readJson } from "./judge-review.mjs";
import { runReviewGit } from "./review-repository.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { waitFor } from "./check-timing.mjs";
import { readReviewProvider } from "./review-provider.mjs";
import { matchesReviewProvider } from "./review-state.mjs";
import {
  readReviewRun,
  requireTrustedReviewAuthority,
  REVIEW_RESULT_PREFIX,
} from "./review-run.mjs";
import { isPullRequestRun } from "./find-passed-ci.mjs";

const FINISH_BUDGET_MS = 10 * 60 * 1000;
const FIRST_POLL_MS = 60 * 1000;
const MAX_POLL_MS = 5 * 60 * 1000;

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
export function verifyTrustedReviewResult(folder, env) {
  const result = readJson(join(folder, "result.json"));
  // The authenticated producer's run title supplies the immutable default-branch source.
  const identity = readReviewIdentity({
    ...env,
    ...(!result?.identity?.provider &&
    matchesReviewProvider(undefined, env.REVIEW_PROVIDER, env.REVIEW_SELECTION)
      ? { REVIEW_PROVIDER: undefined, REVIEW_SELECTION: undefined }
      : {}),
    GITHUB_RUN_ID: env.REVIEW_RUN,
    REVIEW_MERGE: result?.identity?.merge,
    GITHUB_WORKFLOW_REF: `${env.GITHUB_REPOSITORY}/.github/workflows/review.yml@refs/heads/main`,
  });
  validateReviewArtifact(folder, "result", identity, ["result.json"]);
  if (
    JSON.stringify(result.identity) !== JSON.stringify(identity) ||
    result.tree !== env.REVIEW_TREE ||
    result.passed !== true
  )
    throw new Error("The trusted review result does not match this code.");
  return { merge: identity.merge, tree: result.tree };
}

/**
 * REST pull_requests can be empty for fork runs and may change as the PR advances. The trusted
 * workflow's fixed run-name binds the request and default-branch source. Its sealed result binds
 * the reviewed base, head and tree; mutable event base metadata is not a code identity.
 * @param {any} run @param {{ repository: string, head: string, pull: string }} expected
 */
export const isTrustedReviewRun = (run, expected) =>
  run.repository?.full_name === expected.repository &&
  Boolean(readTrustedReviewSource(run, expected));

/** @param {any} run @param {{ head: string, pull: string }} expected */
function readTrustedReviewSource(run, expected) {
  const identity = readReviewRun(run);
  return identity && String(identity.pull) === expected.pull && identity.head === expected.head
    ? identity.source
    : null;
}

/**
 * @param {{ readGitHub: (path: string) => Promise<any>, repository: string, head: string, pull: string }} options
 * @returns {Promise<{ run: number | null, tree: string | null, source: string | null, pending: boolean }>}
 */
export async function findTrustedReviewRun(options) {
  const { readGitHub } = options;
  const runs = await readAllPages(
    readGitHub,
    `/actions/workflows/review.yml/runs?event=pull_request_target&head_sha=${options.head}`,
    (answer) => answer.workflow_runs,
  );
  const matching = runs.filter((run) => isTrustedReviewRun(run, options));
  if (matching.length === 0 || matching.some((run) => run.status !== "completed"))
    return { run: null, tree: null, source: null, pending: true };
  for (const run of matching) {
    if (run.conclusion !== "success") continue;
    const artifacts = await readAllPages(
      readGitHub,
      `/actions/runs/${run.id}/artifacts`,
      (answer) => answer.artifacts,
    );
    const results = artifacts.filter(
      (artifact) =>
        !artifact.expired &&
        artifact.workflow_run?.id === run.id &&
        typeof artifact.name === "string" &&
        artifact.name.startsWith(REVIEW_RESULT_PREFIX) &&
        isGitObjectId(artifact.name.slice(REVIEW_RESULT_PREFIX.length)),
    );
    if (results.length > 1) throw new Error("The trusted run has ambiguous review results.");
    if (results.length === 1)
      return {
        run: run.id,
        tree: results[0].name.slice(REVIEW_RESULT_PREFIX.length),
        source: readTrustedReviewSource(run, options),
        pending: false,
      };
  }
  return {
    run: null,
    tree: null,
    source: null,
    pending: false,
  };
}

/** @param {any} run */
function readJoinRecoverySubject(run) {
  const review = readReviewRun(run);
  if (review?.intent) return review.target === "main" ? review : null;
  if (!isPullRequestRun(run) || run.pull_requests?.length !== 1) return null;
  const pull = run.pull_requests[0];
  return Number.isSafeInteger(pull.number) &&
    pull.number > 0 &&
    isGitObjectId(pull.head?.sha) &&
    pull.base?.ref === "main" &&
    run.head_sha === pull.head.sha
    ? { pull: pull.number, head: pull.head.sha, target: "main" }
    : null;
}

/** @param {any} run @param {any} subject @param {string} repository */
function matchesJoinRecoveryCI(run, subject, repository) {
  return (
    isPullRequestRun(run) &&
    run.repository?.full_name === repository &&
    Number.isSafeInteger(run.id) &&
    run.id > 0 &&
    run.head_sha === subject.head &&
    run.pull_requests?.some(
      (pull) =>
        pull.number === subject.pull &&
        pull.head?.sha === subject.head &&
        pull.base?.ref === subject.target,
    )
  );
}

/**
 * Recovery only discovers a CI job. That job still verifies sealed code/provider evidence before
 * check can pass; discovery metadata never approves a review.
 * @param {any} event
 * @param {NodeJS.ProcessEnv} env
 * @param {(path:string, request?:{method?:string,readBody?:boolean})=>Promise<any>} readGitHub
 */
export async function recoverTrustedReviewJoin(event, env, readGitHub) {
  requireTrustedReviewAuthority(env);
  if (
    env.GITHUB_EVENT_NAME !== "workflow_run" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    event.action !== "completed" ||
    !Number.isSafeInteger(event.workflow_run?.id) ||
    event.workflow_run.id <= 0
  )
    throw new Error("Join recovery requires a first trusted completion event.");
  const trigger = await readGitHub(`/actions/runs/${event.workflow_run.id}`);
  if (
    trigger.id !== event.workflow_run.id ||
    trigger.status !== "completed" ||
    !Number.isSafeInteger(trigger.repository?.id) ||
    trigger.repository?.full_name !== env.GITHUB_REPOSITORY
  )
    return null;
  const subject = readJoinRecoverySubject(trigger);
  if (!subject) return null;
  const pull = await readGitHub(`/pulls/${subject.pull}`);
  if (
    pull.state !== "open" ||
    pull.draft ||
    pull.head?.sha !== subject.head ||
    pull.base?.ref !== subject.target
  )
    return null;
  const expected = {
    repository: env.GITHUB_REPOSITORY,
    head: subject.head,
    pull: String(subject.pull),
    readGitHub,
  };
  const reviews = await readAllPages(
    readGitHub,
    `/actions/workflows/review.yml/runs?event=pull_request_target&head_sha=${subject.head}`,
    (answer) => answer.workflow_runs,
  );
  const latest = reviews
    .filter((run) => isTrustedReviewRun(run, expected) && readReviewRun(run)?.intent === "review")
    .sort((first, second) => second.id - first.id)[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success") return null;
  const result = await findTrustedReviewRun(expected);
  if (result.pending || result.run !== latest.id) return null;
  const ciRuns = await readAllPages(
    readGitHub,
    `/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${subject.head}`,
    (answer) => answer.workflow_runs,
  );
  const ci = ciRuns
    .filter((run) => matchesJoinRecoveryCI(run, subject, env.GITHUB_REPOSITORY))
    .sort((first, second) => second.id - first.id)[0];
  if (!ci || ci.status !== "completed" || ci.conclusion !== "failure" || ci.run_attempt !== 1)
    return null;
  const jobs = await readAllPages(
    readGitHub,
    `/actions/runs/${ci.id}/jobs?filter=latest`,
    (answer) => answer.jobs,
  );
  if (jobs.some((job) => job.run_id !== ci.id)) throw new Error("Foreign CI join job.");
  const joins = jobs.filter((job) => job.name === "review-join");
  if (joins.length !== 1 || !Number.isSafeInteger(joins[0].id) || joins[0].id <= 0)
    throw new Error("Ambiguous CI join job.");
  const join = joins[0];
  if (
    !jobs.some((job) => job.name === "check" && job.conclusion === "failure") ||
    jobs.some((job) => job.status !== "completed") ||
    !["success", "failure", "timed_out"].includes(join.conclusion) ||
    jobs.some(
      (job) =>
        !["review-join", "check"].includes(job.name) &&
        !["success", "skipped"].includes(job.conclusion),
    )
  )
    return null;
  await readGitHub(`/actions/jobs/${join.id}/rerun`, { method: "POST", readBody: false });
  return join.id;
}

/** @param {NodeJS.ProcessEnv} env */
async function waitForTrustedReview(env) {
  const minutes = Number(env.REVIEW_TIMEOUT_MINUTES);
  if (!Number.isFinite(minutes) || minutes * 60000 <= FINISH_BUDGET_MS)
    throw new Error("The review join needs a job timeout longer than its finish budget.");
  const deadline = Date.now() + minutes * 60000 - FINISH_BUDGET_MS;
  const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
  let interval = FIRST_POLL_MS;
  for (;;) {
    const result = await findTrustedReviewRun({
      readGitHub,
      repository: env.GITHUB_REPOSITORY,
      head: env.REVIEW_HEAD,
      pull: env.PR,
    });
    if (!result.pending) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Timed out waiting for trusted review.");
    await waitFor(Math.min(interval, remaining));
    interval = Math.min(interval * 2, MAX_POLL_MS);
  }
}

/**
 * The base is the first parent of the merge this CI run tested, so the review must cover exactly
 * the code that merges now, whatever base.sha the pull's event carried.
 * @param {NodeJS.ProcessEnv} env
 */
function readTestedBase(env) {
  const [base, head, ...others] = runReviewGit(
    env.GITHUB_WORKSPACE,
    ["show", "--no-patch", "--format=%P", "HEAD"],
    { environment: env },
  ).split(" ");
  if (head !== env.REVIEW_HEAD || others.length > 0 || !isGitObjectId(base))
    throw new Error("The tested checkout is not this pull request's merge.");
  return base;
}

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
function verifyReviewedMerge(folder, env) {
  const result = verifyTrustedReviewResult(folder, env);
  const options = { environment: env };
  runReviewGit(env.GITHUB_WORKSPACE, ["fetch", "--no-tags", "origin", result.merge], options);
  const parents = runReviewGit(
    env.GITHUB_WORKSPACE,
    ["show", "--no-patch", "--format=%P", result.merge],
    options,
  );
  const tree = runReviewGit(env.GITHUB_WORKSPACE, ["rev-parse", `${result.merge}^{tree}`], options);
  if (parents !== `${env.REVIEW_BASE} ${env.REVIEW_HEAD}` || tree !== result.tree)
    throw new Error("The reviewed merge does not match its head, base and tree.");
  return tree;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env } = process;
  if (process.argv[2] === "recover") {
    try {
      const job = await recoverTrustedReviewJoin(
        readJson(env.GITHUB_EVENT_PATH),
        env,
        createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env }),
      );
      console.log(
        job
          ? "Requested the current CI join recovery; no model was rerun."
          : "Recovery did not request a rerun. Inspect the current CI join/check state before manual recovery.",
      );
    } catch (error) {
      console.error(
        "CI join recovery failed. Inspect its current state before a manual join retry." +
          (error instanceof GitHubError ? ` GitHub answered ${error.status}.` : ""),
      );
      process.exitCode = 1;
    }
  } else if (process.argv[2] === "verify") {
    const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
    const { choice } = await readReviewProvider(env, readGitHub);
    const tree = verifyReviewedMerge(process.argv[3], {
      ...env,
      REVIEW_BASE: readTestedBase(env),
      REVIEW_PROVIDER: choice.provider,
      REVIEW_SELECTION: choice.selection,
    });
    appendFileSync(env.GITHUB_OUTPUT, `tree=${tree}\n`);
  } else {
    const result = await waitForTrustedReview(env);
    if (result.run === null)
      console.log("No successful trusted review covers this head and base; review remains owed.");
    appendFileSync(
      env.GITHUB_OUTPUT,
      `run=${result.run ?? ""}\nowed=${result.run === null}\ntree=${result.tree ?? ""}\nsource=${result.source ?? ""}\n`,
    );
  }
}
