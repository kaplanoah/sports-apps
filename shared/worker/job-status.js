import { RequestBudgetExhausted } from "./request-budget.js";
import { describeError } from "./responses.js";

// What every background job's status document says of its last run, beside what the job adds of
// its own, so Diagnostics reads each job's the same way: when the run started, how long it took,
// how many requests it made, and the last run that failed, kept until another fails.

/** @typedef {import("../page/job-status.js").JobRunStatus} JobRunStatus */

/**
 * A fetch that counts the requests made through it.
 * @param {typeof fetch} fetchImpl
 */
function countRequests(fetchImpl) {
  const counter = {
    count: 0,
    /** @type {typeof fetch} */
    fetchImpl: (input, init) => {
      const response = fetchImpl(input, init);
      counter.count += 1;
      return response;
    },
  };
  return counter;
}

/**
 * Logs what failed, and keeps it for the run's status.
 * @param {string[]} failures what failed so far this run
 * @param {string} what what failed, as an error names it
 * @param {unknown} error
 */
export function noteFailure(failures, what, error) {
  if (error instanceof RequestBudgetExhausted) return;
  const failure = `${what} failed: ${describeError(error)}`;
  console.error(failure);
  failures.push(failure);
}

/**
 * Does `work`, noting a failure for the run's status rather than letting it stop the run.
 * @param {string[]} failures what failed so far this run
 * @param {string} what what failed, as an error names it
 * @param {() => Promise<unknown>} work
 */
export async function catchFailure(failures, what, work) {
  try {
    await work();
  } catch (error) {
    noteFailure(failures, what, error);
  }
}

/**
 * A run's part of the status, keeping the last failure that `stored` names when this run had none.
 * @param {object} run
 * @param {number} run.startedAt
 * @param {number} run.endedAt
 * @param {number} run.requests
 * @param {string} run.failure what went wrong, or blank when nothing did
 * @param {Partial<JobRunStatus> | null} stored the status the last run saved
 * @returns {JobRunStatus}
 */
function describeJobRun({ startedAt, endedAt, requests, failure }, stored) {
  const ranAt = new Date(startedAt).toISOString();
  return {
    ranAt,
    durationMs: endedAt - startedAt,
    requests,
    lastFailure: failure ? { at: ranAt, message: failure } : (stored?.lastFailure ?? null),
  };
}

/**
 * What a job's run gets: the store's context, its fetch counted, the store's reading of the league
 * on that fetch, and what failed so far.
 * @typedef {import("./season-store.js").JobContext & { failures: string[], loadSnapshot: (season: number) => Promise<any> }} RunContext
 */

/**
 * Does one run of a job and saves how it went in the job's status document, with what the job
 * adds of its own. A failure the run doesn't catch is noted as the run's.
 * @param {import("./season-store.js").JobContext} context
 * @param {object} job
 * @param {string} job.statusKey where the job saves its status, as `<name>/status`
 * @param {(context: RunContext) => Promise<void>} job.updateStore one run
 * @param {boolean} [job.onlyWhenActive] omit status writes when no requests or documents changed
 * @param {(context: RunContext) => Promise<Record<string, unknown>>} [job.describeRun] what the
 *   job adds of its own to the status
 */
export async function runWithStatus(
  context,
  { statusKey, updateStore, describeRun, onlyWhenActive = false },
) {
  const startedAt = context.now();
  const counter = countRequests(context.fetchImpl);
  /** @type {((season: number) => Promise<any>) | undefined} */
  let loadSnapshot;
  let changed = false;
  /** @type {RunContext} */
  const runContext = {
    ...context,
    docs: onlyWhenActive
      ? {
          ...context.docs,
          write: async (key, document) => {
            await context.docs.write(key, document);
            changed = true;
          },
          update: (key, change) =>
            context.docs.update(key, (document) => {
              const next = change(document);
              if (next) changed = true;
              return next;
            }),
          remove: async (key) => {
            await context.docs.remove(key);
            changed = true;
          },
        }
      : context.docs,
    fetchImpl: counter.fetchImpl,
    loadSnapshot: (season) =>
      (loadSnapshot ??= context.createLoadSnapshot(counter.fetchImpl))(season),
    failures: [],
  };
  await catchFailure(runContext.failures, "The run", () => updateStore(runContext));
  if (onlyWhenActive && !counter.count && !changed && !runContext.failures.length) return;
  const stored = await context.docs.read(statusKey);
  const failure = runContext.failures.join("; ");
  const requests = counter.count;
  await context.docs.write(statusKey, {
    ...describeJobRun({ startedAt, endedAt: context.now(), requests, failure }, stored),
    ...(await describeRun?.(runContext)),
  });
}
