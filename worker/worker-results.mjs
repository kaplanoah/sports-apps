// What a Deploy run reports of each Worker, in its log and in its comment on the pull request it
// deployed, so the two say it the same way.

/** What the deploy's log and its comment say of a Worker the run checked answering. */
export const WORKER_CHECK_OK = "worker check: ok";

/** What the deploy's log and its comment say of a service every app that reports it says is ok. */
export const HEALTH_CHECK_OK = "health check: ok";

/**
 * What the deploy's log and its comment say of a service's health check, when it answered or no
 * app reported it.
 * @param {import("./check-service.mjs").ServiceCheck} check
 */
export function describeHealthCheck(check) {
  if (check.status === "unchecked") return `health check: skipped, ${check.reason}`;
  if (check.status !== "answering") return undefined;
  return check.attention ? `${HEALTH_CHECK_OK}, but ${check.attention}` : HEALTH_CHECK_OK;
}

/**
 * What a run did with a Worker: checked it answering, found an unchanged service
 * answering at its live commit, failed, or left it as it was. Its detail is a failure's error,
 * or a checked or answered service's health check when it says more than ok.
 * @typedef {{ worker: string, version: string | null, result: "checked" | "answered" | "failed" | "unchanged", detail?: string }} WorkerResult
 */
