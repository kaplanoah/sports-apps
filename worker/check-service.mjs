// A service has no address of its own, so its health is what each app's health says of it, in a
// field of its own under services, as the app reaches it through its binding. An app's health
// answers for the app apart from that field, so a failing service never reads as a failing app,
// and an app that doesn't answer, or binds no service yet, says nothing of the service.

const CHECK_INTERVAL_MS = 5000;
const CHECK_TIMEOUT_MS = 10000;

/** @typedef {{ ok: boolean, release: string | null }} ServiceReport */
/**
 * @typedef {{ status: "answering" }
 *   | { status: "unanswered", reason: string }
 *   | { status: "unchecked", reason: string }} ServiceCheck
 */

/**
 * What one app's health says of the service, or null when it says nothing of it.
 * @param {string} url the app's Worker
 * @param {string} service
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<ServiceReport | null>}
 */
async function readReport(url, service, fetchImpl) {
  try {
    const response = await fetchImpl(new URL("health", url).href, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return (await response.json())?.services?.[service] ?? null;
  } catch {
    return null;
  }
}

/**
 * Why an app's report isn't the service answering as the commit, or null when it is.
 * @param {string} app
 * @param {ServiceReport} report
 * @param {string} service
 * @param {string} [commit]
 */
function findReportProblem(app, { ok, release }, service, commit) {
  if (!ok) return `${app} gets no answer from ${service}`;
  if (commit && !(release && commit.startsWith(release)))
    return `${app} reaches ${service} at ${release ?? "no known commit"}, not ${commit.slice(0, 7)}`;
  return null;
}

/**
 * @param {object} options
 * @param {string} options.service
 * @param {{ app: string, url: string }[]} options.apps each app's Worker on the service's channel
 * @param {string} [options.commit] the commit the service should be running, in any length
 * @param {number} [options.attempts]
 * @param {number} [options.pauseMs] how long to wait before each attempt
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
  pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  fetchImpl = fetch,
}) {
  let problems = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pause(pauseMs);
    const reports = await Promise.all(
      apps.map(async ({ app, url }) => ({
        app,
        report: await readReport(url, service, fetchImpl),
      })),
    );
    const reporting = reports.filter(({ report }) => report);
    if (!reporting.length) return { status: "unchecked", reason: `no app reaches ${service} yet` };
    problems = reporting
      .map(({ app, report }) => findReportProblem(app, report, service, commit))
      .filter(Boolean);
    if (!problems.length) return { status: "answering" };
  }
  return { status: "unanswered", reason: problems.join("; ") };
}
