// Reads JSON from the page's own Worker for a sheet. A read under way or done in the last while for
// the same path is shared, so the read a finger starts as it comes down on a row serves the sheet
// the tap opens, and a sheet opened again soon doesn't wait on another.
import { reloadWhenSignedOut } from "./access.js";

/** @typedef {{ timeoutMs: number, isExpected: (body: any) => boolean }} ReadRules */

/** @type {Map<string, { at: number, promise: Promise<any> }>} */
const recentReads = new Map();

/**
 * What the Worker said went wrong: a sheet's route says it in words, and the store and the access
 * gate as `{ code, message }`.
 * @param {any} body
 * @param {number} status
 * @returns {string}
 */
function readFailure(body, status) {
  const error = body?.error;
  if (typeof error === "string" && error) return error;
  if (typeof error?.message === "string" && error.message) return error.message;
  return `The Worker answered ${status}`;
}

/**
 * @param {string} path
 * @param {ReadRules} rules
 * @returns {Promise<any>}
 */
async function requestFromWorker(path, { timeoutMs, isExpected }) {
  const response = await fetch(new URL(path, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  reloadWhenSignedOut(response);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(new Error(readFailure(body, response.status)), {
      status: response.status,
    });
  if (!body || !isExpected(body))
    throw Object.assign(new Error("unexpected answer"), { status: response.status });
  return body;
}

/**
 * @param {string} path
 * @param {Promise<any>} promise
 */
function forgetRead(path, promise) {
  if (recentReads.get(path)?.promise === promise) recentReads.delete(path);
}

/**
 * The Worker's answer for a path relative to the page, or the one read or under way for it in the
 * last `reuseMs`. A read that fails is forgotten, so the next one tries again; when the Worker
 * answered, with an error or with what the read didn't expect, the failure carries its `status`.
 * @param {string} path
 * @param {ReadRules & { reuseMs: number }} options
 * @returns {Promise<any>}
 */
export function fetchFromWorker(path, { reuseMs, ...rules }) {
  const kept = recentReads.get(path);
  if (kept && Date.now() - kept.at < reuseMs) return kept.promise;
  const promise = requestFromWorker(path, rules);
  recentReads.set(path, { at: Date.now(), promise });
  promise.catch(() => forgetRead(path, promise));
  return promise;
}
