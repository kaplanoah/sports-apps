// A service has no address of its own, so its health is what each app's health says of it, in a
// field of its own under services, as the app reaches it through its binding. An app's health
// answers for the app apart from that field, so a failing service never reads as a failing app.
// An app that binds no service yet answers with no such field, but one that doesn't answer at all
// may be what a bad version of the service did to it.
import { CHECK_INTERVAL_MS, CHECK_TIMEOUT_MS, waitFor } from "./check-timing.mjs";

/** @typedef {import("../shared/worker/health.js").ServiceHealth} ServiceReport */
/**
 * @typedef {{ status: "answering", attention?: string }
 *   | { status: "unanswered", reason: string }
 *   | { status: "unchecked", reason: string }} ServiceCheck
 */
/** @typedef {{ answered: false } | { answered: true, report: ServiceReport | null }} AppHealth */

/**
 * What an app's health answers, or that it didn't.
 * @param {string} url the app's Worker
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ answered: false } | { answered: true, body: any }>}
 */
export async function readHealth(url, fetchImpl) {
  try {
    const response = await fetchImpl(new URL("health", url).href, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return { answered: true, body: await response.json() };
  } catch {
    return { answered: false };
  }
}

/**
 * What one app's health says of the service, and whether it answered at all.
 * @param {string} url the app's Worker
 * @param {string} service
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<AppHealth>}
 */
async function readAppHealth(url, service, fetchImpl) {
  const health = await readHealth(url, fetchImpl);
  if (!health.answered) return { answered: false };
  return { answered: true, report: health.body?.services?.[service] ?? null };
}

/**
 * Why an app's health isn't the service answering as the commit, or null when it is or the app
 * binds no service yet.
 * @param {string} app
 * @param {AppHealth} health
 * @param {string} service
 * @param {string} [commit]
 */
function findHealthProblem(app, health, service, commit) {
  if (!health.answered) return `${app}'s health doesn't answer`;
  if (!health.report) return null;
  const { ok, release, problem } = health.report;
  if (!ok) return `${app} finds ${service} not ok: ${problem ?? "no reason given"}`;
  if (commit && !(release && commit.startsWith(release)))
    return `${app} reaches ${service} at ${release ?? "no known commit"}, not ${commit.slice(0, 7)}`;
  return null;
}

/**
 * What the apps say the service needs from its owner while it answers, or null when nothing.
 * @param {AppHealth[]} healths
 */
function findAttention(healths) {
  const notes = healths.map((health) => health.answered && health.report?.attention);
  return [...new Set(notes.filter(Boolean))].join("; ") || null;
}

/**
 * Whether every app answered and none binds the service yet.
 * @param {AppHealth[]} healths
 */
const isUnbound = (healths) => healths.every((health) => health.answered && !health.report);

/**
 * @param {object} options
 * @param {string} options.service
 * @param {{ app: string, url: string }[]} options.apps each app's Worker on the service's channel
 * @param {string} [options.commit] the commit the service should be running, in any length
 * @param {number} [options.attempts]
 * @param {number} [options.pauseMs] how long to wait between attempts
 * @param {(milliseconds: number) => Promise<unknown>} [options.pause]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<ServiceCheck>}
 */
export async function checkService({
  service,
  apps,
  commit,
  attempts = 1,
  pauseMs = CHECK_INTERVAL_MS,
  pause = waitFor,
  fetchImpl = fetch,
}) {
  let problems = [];
  let isReported = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await pause(pauseMs);
    const healths = await Promise.all(
      apps.map(({ url }) => readAppHealth(url, service, fetchImpl)),
    );
    if (isUnbound(healths)) {
      if (!isReported) return { status: "unchecked", reason: `no app reaches ${service} yet` };
      continue;
    }
    isReported ||= healths.some((health) => health.answered && health.report);
    problems = healths
      .map((health, index) => findHealthProblem(apps[index].app, health, service, commit))
      .filter(Boolean);
    if (problems.length) continue;
    const attention = findAttention(healths);
    return attention ? { status: "answering", attention } : { status: "answering" };
  }
  return { status: "unanswered", reason: problems.join("; ") };
}
