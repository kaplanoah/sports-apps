import { isGitObjectId } from "./git-object.mjs";

export const REVIEW_CHECK_NAME = "trusted-review";
export const REVIEW_RESULT_PREFIX = "trusted-review-passed-";

/** @param {unknown} target */
export const isPublishableReviewTarget = (target) => target === "main";

/** @param {string | undefined} value */
export const isRepositoryName = (value) => /^[\w.-]+\/[\w.-]+$/.test(value ?? "");

/** @param {string | undefined} value */
export const isRunId = (value) => /^\d+$/.test(value ?? "");

/** @param {NodeJS.ProcessEnv} env */
export function requireTrustedReviewAuthority(env) {
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    !["pull_request_target", "workflow_run"].includes(env.GITHUB_EVENT_NAME) ||
    !["review.yml", "trusted-review-publisher.yml"].some(
      (name) =>
        env.GITHUB_WORKFLOW_REF ===
        `${env.GITHUB_REPOSITORY}/.github/workflows/${name}@refs/heads/main`,
    )
  )
    throw new Error("Trusted review lifecycle requires trusted main workflow authority.");
}

/** @param {any} run */
export function readReviewRun(run) {
  const match =
    /^Review ([1-9]\d*) head ([a-f0-9]{40}) base ([a-f0-9]{40}) source ([a-f0-9]{40})(?: target (main|other) intent (review|observe|exempt))?$/.exec(
      run?.display_title ?? "",
    );
  if (!match) return null;
  const [, pull, head, base, source, target, intent] = match;
  if (
    run.path !== ".github/workflows/review.yml" ||
    run.event !== "pull_request_target" ||
    run.head_sha !== head ||
    !Number.isSafeInteger(run.id) ||
    !Number.isSafeInteger(run.repository?.id) ||
    !isGitObjectId(source)
  )
    return null;
  return { pull: Number(pull), head, base, source, target, intent };
}
