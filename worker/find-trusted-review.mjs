// Joins a code-bound result from the trusted review workflow using read-only Actions access.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { readReviewIdentity, validateReviewArtifact } from "./review-data.mjs";
import { readJson } from "./judge-review.mjs";
import { join } from "node:path";

/** @param {string} folder @param {NodeJS.ProcessEnv} env */
export function verifyTrustedReviewResult(folder, env) {
  const identity = readReviewIdentity({
    ...env,
    GITHUB_RUN_ID: env.REVIEW_RUN,
    GITHUB_WORKFLOW_REF: `${env.GITHUB_REPOSITORY}/.github/workflows/review.yml@refs/heads/main`,
  });
  validateReviewArtifact(folder, "result", identity, ["result.json"]);
  const result = readJson(join(folder, "result.json"));
  if (
    JSON.stringify(result.identity) !== JSON.stringify(identity) ||
    result.tree !== env.REVIEW_TREE ||
    result.passed !== true
  )
    throw new Error("The trusted review result does not match this code.");
}

/**
 * REST pull_requests can be empty for fork runs and changes as the PR advances. The trusted
 * workflow's fixed run-name binds the event's PR/head/base; its sealed result verifies the code.
 * @param {any} run @param {{ repository: string, head: string, base: string, pull: string }} expected
 */
export const isTrustedReviewRun = (run, expected) =>
  run.path === ".github/workflows/review.yml" &&
  run.event === "pull_request_target" &&
  run.head_sha === expected.head &&
  run.repository?.full_name === expected.repository &&
  Number.isSafeInteger(run.repository?.id) &&
  run.display_title === `Review ${expected.pull} head ${expected.head} base ${expected.base}`;

/**
 * @param {{ readGitHub: (path: string) => Promise<any>, repository: string, tree: string, head: string, base: string, pull: string }} options
 * @returns {Promise<{ run: number | null, pending: boolean }>}
 */
export async function findTrustedReviewRun(options) {
  const { readGitHub, tree } = options;
  const artifacts = await readAllPages(
    readGitHub,
    `/actions/artifacts?name=trusted-review-passed-${tree}`,
    (answer) => answer.artifacts,
  );

  for (const artifact of artifacts) {
    if (artifact.expired) continue;
    const run = await readGitHub(`/actions/runs/${artifact.workflow_run.id}`);
    if (isTrustedReviewRun(run, options) && run.conclusion === "success")
      return { run: run.id, pending: false };
  }
  const runs = await readAllPages(
    readGitHub,
    `/actions/workflows/review.yml/runs?event=pull_request_target&head_sha=${options.head}`,
    (answer) => answer.workflow_runs,
  );

  const matching = runs.filter((run) => isTrustedReviewRun(run, options));
  return {
    run: null,
    pending: matching.length === 0 || matching.some((run) => run.status !== "completed"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env } = process;
  if (process.argv[2] === "verify") {
    verifyTrustedReviewResult(process.argv[3], env);
    process.exit(0);
  }
  const readGitHub = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl: fetch, env });
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const started = Date.now();
  let result;
  do {
    result = await findTrustedReviewRun({
      readGitHub,
      tree,
      repository: env.GITHUB_REPOSITORY,
      head: env.REVIEW_HEAD,
      base: env.REVIEW_BASE,
      pull: env.PR,
    });
    if (!result.pending) break;
    if (Date.now() - started >= 110 * 60 * 1000)
      throw new Error("Timed out waiting for trusted review.");
    await new Promise((resume) => setTimeout(resume, 20000));
  } while (result.pending);
  const output = `run=${result.run ?? ""}\nowed=${result.run === null}\ntree=${tree}\n`;
  if (result.run === null)
    console.log("No successful trusted review covers this head and base; review remains owed.");
  appendFileSync(env.GITHUB_OUTPUT, output);
}
