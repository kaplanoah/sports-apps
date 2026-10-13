import { describeError } from "./responses.js";

// What every background job's status document says of its last run, beside what the job adds of
// its own, so Diagnostics reads each job's the same way: when the run started, how long it took,
// how many requests it made, and the last run that failed, kept until another fails.

/**
 * @typedef {object} JobFailure
 * @property {string} at when the run that failed started
 * @property {string} message
 */

/**
 * @typedef {object} JobRunStatus
 * @property {string} ranAt
 * @property {number} durationMs
 * @property {number} requests
 * @property {JobFailure | null} lastFailure
 */

/**
 * A fetch that counts the requests made through it.
 * @param {typeof fetch} fetchImpl
 */
export function countRequests(fetchImpl) {
  const counter = {
    count: 0,
    /** @type {typeof fetch} */
    fetchImpl: (input, init) => {
      counter.count += 1;
      return fetchImpl(input, init);
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
export function describeJobRun({ startedAt, endedAt, requests, failure }, stored) {
  const ranAt = new Date(startedAt).toISOString();
  return {
    ranAt,
    durationMs: endedAt - startedAt,
    requests,
    lastFailure: failure ? { at: ranAt, message: failure } : (stored?.lastFailure ?? null),
  };
}
