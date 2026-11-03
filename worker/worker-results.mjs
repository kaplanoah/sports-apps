// What a Deploy run reports of each Worker, in its log and in its comment on the pull request it
// deployed, so the two say it the same way.

/** What the deploy's log and its comment say of a Worker the run checked answering. */
export const WORKER_CHECK_OK = "worker check: ok";

/**
 * What a run did with a Worker: checked it answering, failed, or left it as it was.
 * @typedef {{ worker: string, version: string | null, result: "checked" | "failed" | "unchanged", detail?: string }} WorkerResult
 */
