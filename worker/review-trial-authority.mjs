export class TrialAuthorityError extends Error {}

/** @param {NodeJS.ProcessEnv} env */
export function requireOwnerTrialAuthority(env) {
  if (
    env.GITHUB_REPOSITORY !== "kaplanoah/sports-apps" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_ACTOR !== "kaplanoah" ||
    env.GITHUB_TRIGGERING_ACTOR !== "kaplanoah" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    env.TRUSTED_CODEX_REVIEW_ENABLED === "true"
  )
    throw new TrialAuthorityError(
      "Trial requires one owner dispatch on main with live Codex disabled.",
    );
}
