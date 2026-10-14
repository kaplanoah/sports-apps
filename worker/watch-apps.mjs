// Opens each app's live page on a schedule, as a phone does, and keeps one open issue for each app
// that isn't opening, so its owner hears of an outage before the people who use it do. An app that
// fails once is opened again a minute later, so a moment's hiccup opens nothing; the issue closes
// once the app opens again.
import { fileURLToPath } from "node:url";
import { listApps } from "./apps.mjs";
import { checkAppPage } from "./check-page.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";

const RECHECK_DELAY_MS = 60 * 1000;

/** @param {string} app */
export const nameOutageIssue = (app) => `The ${app.toUpperCase()} app isn't opening`;

/**
 * @param {import("./check-page.mjs").PageCheck & { status: "broken" }} check
 * @param {string} runUrl
 */
const describeOutage = (check, runUrl) =>
  `Opened twice a minute apart, ${check.reason}.\n\nSee [the check's run](${runUrl}). This issue closes itself once the app opens again.`;

/**
 * Brings one app's issue up to date with its check, and says what it did.
 * @param {object} options
 * @param {string} options.app
 * @param {import("./check-page.mjs").PageCheck} options.check
 * @param {any[]} options.openIssues
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 */
export async function reportCheck({ app, check, openIssues, github, runUrl }) {
  const title = nameOutageIssue(app);
  const open = openIssues.find((issue) => issue.title === title && !issue.pull_request);
  if (check.status === "unchecked") return `::warning::${app}: not checked, ${check.reason}`;
  if (check.status === "drawn" && !open) return `${app}: opens`;
  if (check.status === "drawn") {
    await github(`/issues/${open.number}/comments`, {
      method: "POST",
      body: { body: `The app opens again, as of [this run](${runUrl}).` },
    });
    await github(`/issues/${open.number}`, {
      method: "PATCH",
      body: { state: "closed", state_reason: "completed" },
    });
    return `${app}: opens again, so #${open.number} is closed`;
  }
  if (open) return `${app}: still not opening, ${check.reason}; #${open.number} is open`;
  const created = await github("/issues", {
    method: "POST",
    body: { title, body: describeOutage(check, runUrl) },
  });
  return `${app}: not opening, ${check.reason}; opened #${created.number}`;
}

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.runUrl
 * @param {string[]} [options.apps]
 * @param {(app: string) => Promise<import("./check-page.mjs").PageCheck>} [options.checkApp]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 */
export async function watchApps({
  repository,
  runUrl,
  apps = listApps(),
  checkApp = (app) =>
    checkAppPage({ app, channel: "production", attempts: 2, pauseMs: RECHECK_DELAY_MS }),
  fetchImpl = fetch,
  env = process.env,
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const openIssues = await readAllPages(github, "/issues?state=open");
  const checks = await Promise.all(apps.map((app) => checkApp(app)));
  const lines = [];
  for (const [index, app] of apps.entries())
    lines.push(await reportCheck({ app, check: checks[index], openIssues, github, runUrl }));
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = await watchApps({
    repository: String(process.env.GITHUB_REPOSITORY),
    runUrl: String(process.env.RUN_URL),
  });
  for (const line of lines) console.log(line);
}
