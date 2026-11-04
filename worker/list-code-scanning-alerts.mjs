// The run's log is public, so it reads only CodeQL's alerts, which its public queries find in the
// public code, and prints no alert's message or code.
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

const TOOL = "CodeQL";

/**
 * @typedef {object} Alert
 * @property {number} number
 * @property {string} state
 * @property {string | null} [dismissed_reason]
 * @property {{ id: string, severity?: string | null, security_severity_level?: string | null }} rule
 * @property {{ location?: { path?: string, start_line?: number } }} [most_recent_instance]
 */

/**
 * @typedef {object} Analysis
 * @property {string} category
 * @property {string} commit_sha
 * @property {string} created_at
 */

/** @param {Alert} alert */
function renderAlertLine(alert) {
  const state = alert.dismissed_reason ? `${alert.state}/${alert.dismissed_reason}` : alert.state;
  const severity = alert.rule.security_severity_level ?? alert.rule.severity ?? "unknown";
  const location = alert.most_recent_instance?.location;
  const place = location?.path ? `${location.path}:${location.start_line ?? "?"}` : "no location";
  return `#${alert.number} ${state} ${severity} ${alert.rule.id} ${place}`;
}

/** @param {Analysis} analysis */
const renderAnalysisLine = (analysis) =>
  `${analysis.category}: ${analysis.commit_sha} at ${analysis.created_at}`;

/**
 * The newest of each category, since CodeQL analyzes each language apart and one can fall behind.
 * @param {Analysis[]} newestFirst
 */
function pickLatestByCategory(newestFirst) {
  const latest = new Map();
  for (const analysis of newestFirst)
    if (!latest.has(analysis.category)) latest.set(analysis.category, analysis);
  return [...latest.values()];
}

/**
 * CodeQL's default setup analyzes a pull request's head, not its merge.
 * @param {string} [pull] the pull request's number, or none for main
 */
function findRef(pull) {
  if (!pull) return "refs/heads/main";
  if (!/^[1-9]\d*$/.test(pull)) throw new Error(`"${pull}" is not a pull request's number`);
  return `refs/pull/${pull}/head`;
}

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env] with PULL, a pull request's number, to read its head's
 *   instead of main's
 * @returns {Promise<string[]>} the lines to print
 */
export async function listCodeScanningAlerts({ repository, fetchImpl = fetch, env = process.env }) {
  const ref = findRef(env.PULL);
  const github = createGitHub({ repository, fetchImpl, env });
  const analyses = pickLatestByCategory(
    await readAllPages(github, `/code-scanning/analyses?tool_name=${TOOL}&ref=${ref}`),
  );
  /** @type {Alert[]} */
  const alerts = await readAllPages(
    github,
    `/code-scanning/alerts?tool_name=${TOOL}&ref=${ref}&sort=created&direction=asc`,
  );
  return [
    `Latest ${TOOL} analysis of each category on ${ref} (${analyses.length}):`,
    ...analyses.map((analysis) => renderAnalysisLine(analysis)),
    `${TOOL} alerts on ${ref}, in every state (${alerts.length}):`,
    ...alerts.map((alert) => renderAlertLine(alert)),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = await listCodeScanningAlerts({ repository: String(process.env.GITHUB_REPOSITORY) });
  console.log(lines.join("\n"));
}
