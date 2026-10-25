// Joins a code-bound result from the trusted review workflow using read-only Actions access.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { readReviewIdentity, validateReviewArtifact } from "./review-data.mjs";
import { readJson } from "./judge-review.mjs";
import { createReviewGitEnvironment } from "./review-repository.mjs";
import { isGitObjectId } from "./git-object.mjs";
import { waitFor } from "./check-timing.mjs";
import { readReviewProvider } from "./review-provider.mjs";
import { readReviewRun, REVIEW_RESULT_PREFIX } from "./review-run.mjs";

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
    env.REVIEW_PROVIDER === "claude" &&
    env.REVIEW_SELECTION === "initial"
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
 * workflow's fixed run-name binds the event's PR/head/base and default-branch source; its sealed
 * result verifies the code.
 * @param {any} run @param {{ repository: string, head: string, base: string, pull: string }} expected
 */
export const isTrustedReviewRun = (run, expected) =>
  run.repository?.full_name === expected.repository &&
  Boolean(readTrustedReviewSource(run, expected));

/** @param {any} run @param {{ head: string, base: string, pull: string }} expected */
function readTrustedReviewSource(run, expected) {
  const identity = readReviewRun(run);
  return identity &&
    String(identity.pull) === expected.pull &&
    identity.head === expected.head &&
    identity.base === expected.base
    ? identity.source
    : null;
}

/**
 * @param {{ readGitHub: (path: string) => Promise<any>, repository: string, head: string, base: string, pull: string }} options
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
      base: env.REVIEW_BASE,
      pull: env.PR,
    });
    if (!result.pending) return result;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Timed out waiting for trusted review.");
    await waitFor(Math.min(interval, remaining));
    interval = Math.min(interval * 2, MAX_POLL_MS);
  }
}

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
function verifyReviewedMerge(folder, env) {
  const result = verifyTrustedReviewResult(folder, env);
  /** @param {string[]} args */
  const readGit = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: env.GITHUB_WORKSPACE,
      env: createReviewGitEnvironment(env),
      encoding: "utf8",
    }).trim();
  readGit(["fetch", "--no-tags", "origin", result.merge]);
  const parents = readGit(["show", "--no-patch", "--format=%P", result.merge]);
  const tree = readGit(["rev-parse", `${result.merge}^{tree}`]);
  if (parents !== `${env.REVIEW_BASE} ${env.REVIEW_HEAD}` || tree !== result.tree)
    throw new Error("The reviewed merge does not match its head, base and tree.");
  return tree;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env } = process;
  if (process.argv[2] === "verify") {
    const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
    const { choice } = await readReviewProvider(env, readGitHub);
    const tree = verifyReviewedMerge(process.argv[3], {
      ...env,
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
