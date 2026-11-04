// Prints the repository's code-scanning alerts, one line each, and the analysis of main they were
// last read against. The Code scanning alerts workflow runs it with the workflow's own token,
// since a Claude session's GitHub access can't read code scanning, so a session reads the alerts
// from that run's log. Each line holds only what CodeQL's public queries find in the public code.
import { fileURLToPath } from "node:url";
import { createGitHub, readAllPages } from "./github-api.mjs";

/**
 * @typedef {object} Alert
 * @property {number} number
 * @property {string} state
 * @property {string | null} [dismissed_reason]
 * @property {{ id: string, severity?: string | null, security_severity_level?: string | null }} rule
 * @property {{ location?: { path?: string, start_line?: number } }} [most_recent_instance]
 */

/** @param {Alert} alert */
function renderAlertLine(alert) {
  const state = alert.dismissed_reason ? `${alert.state}/${alert.dismissed_reason}` : alert.state;
  const severity = alert.rule.security_severity_level ?? alert.rule.severity ?? "unknown";
  const location = alert.most_recent_instance?.location;
  const place = location?.path ? `${location.path}:${location.start_line ?? "?"}` : "no location";
  return `#${alert.number} ${state} ${severity} ${alert.rule.id} ${place}`;
}

/**
 * @param {{ commit_sha: string, created_at: string } | undefined} analysis
 */
const renderAnalysisLine = (analysis) =>
  analysis
    ? `Main's latest analysis: ${analysis.commit_sha} at ${analysis.created_at}`
    : "Main has no analysis yet.";

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<string[]>} the lines to print
 */
export async function listCodeScanningAlerts({ repository, fetchImpl = fetch, env = process.env }) {
  const github = createGitHub({ repository, fetchImpl, env });
  const [analysis] = await github("/code-scanning/analyses?ref=refs/heads/main&per_page=1");
  /** @type {Alert[]} */
  const alerts = await readAllPages(github, "/code-scanning/alerts?sort=created&direction=asc");
  return [
    renderAnalysisLine(analysis),
    `Alerts, in every state (${alerts.length}):`,
    ...alerts.map((alert) => renderAlertLine(alert)),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = await listCodeScanningAlerts({ repository: String(process.env.GITHUB_REPOSITORY) });
  console.log(lines.join("\n"));
}
