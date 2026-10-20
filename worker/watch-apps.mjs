// Opens each app's live page on a schedule, as a phone does, and keeps one open issue for each app
// that isn't opening, so its owner hears of an outage before the people who use it do, and one for
// each that opens without asking for its code. An app that fails once is opened again a minute
// later, so a moment's hiccup opens nothing; each issue closes once its app is right again.
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

/** @param {string} app */
export const nameNoCodeIssue = (app) => `The ${app.toUpperCase()} app asks for no code`;

/** @param {string} app @param {string} runUrl */
const describeNoCode = (app, runUrl) =>
  `The page opened without asking for its access code, so anyone with its address can open it. Give it its code again with \`npm run set-access-code -- ${app} <code>\`, or, if it's meant to be open, remove its code from the \`production\` environment's secrets.\n\nSee [the check's run](${runUrl}). This issue closes itself once the app asks for its code again, or no code is held for it.`;

/**
 * @param {ReturnType<typeof createGitHub>} github
 * @param {number} number
 * @param {string} comment
 */
async function closeIssue(github, number, comment) {
  await github(`/issues/${number}/comments`, { method: "POST", body: { body: comment } });
  await github(`/issues/${number}`, {
    method: "PATCH",
    body: { state: "closed", state_reason: "completed" },
  });
}

/**
 * Keeps the app's one outage issue open while it isn't opening.
 * @param {object} options
 * @param {string} options.app
 * @param {import("./check-page.mjs").PageCheck & { status: "broken" }} options.check
 * @param {any} options.outage the app's open outage issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 */
async function reportOutage({ app, check, outage, github, runUrl }) {
  if (outage) return `${app}: still not opening, ${check.reason}; #${outage.number} is open`;
  const created = await github("/issues", {
    method: "POST",
    body: { title: nameOutageIssue(app), body: describeOutage(check, runUrl) },
  });
  return `${app}: not opening, ${check.reason}; opened #${created.number}`;
}

/**
 * Closes the app's outage issue once it opens again.
 * @param {object} options
 * @param {string} options.app
 * @param {any} options.outage the app's open outage issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 */
async function reportOpening({ app, outage, github, runUrl }) {
  if (!outage) return `${app}: opens`;
  await closeIssue(github, outage.number, `The app opens again, as of [this run](${runUrl}).`);
  return `${app}: opens again, so #${outage.number} is closed`;
}

/**
 * Keeps an issue open while a page that should ask for its code opens without it.
 * @param {object} options
 * @param {string} options.app
 * @param {boolean} options.isOpenWithoutCode
 * @param {any} options.issue the app's open no-code issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string[]>}
 */
async function reportNoCode({ app, isOpenWithoutCode, issue, github, runUrl }) {
  if (isOpenWithoutCode && issue)
    return [`::warning::${app}: opens without its code; #${issue.number} is open`];
  if (isOpenWithoutCode) {
    const created = await github("/issues", {
      method: "POST",
      body: { title: nameNoCodeIssue(app), body: describeNoCode(app, runUrl) },
    });
    return [`::warning::${app}: opens without its code; opened #${created.number}`];
  }
  if (!issue) return [];
  await closeIssue(
    github,
    issue.number,
    `The app asks for its code again, as of [this run](${runUrl}).`,
  );
  return [`${app}: asks for its code again, so #${issue.number} is closed`];
}

/**
 * Brings one app's issues up to date with its check, and says what it did, a line for each.
 * @param {object} options
 * @param {string} options.app
 * @param {import("./check-page.mjs").PageCheck} options.check
 * @param {any[]} options.openIssues
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string[]>}
 */
export async function reportCheck({ app, check, openIssues, github, runUrl }) {
  if (check.status === "unchecked") return [`::warning::${app}: not checked, ${check.reason}`];
  /** @param {string} title */
  const findOpen = (title) =>
    openIssues.find((issue) => issue.title === title && !issue.pull_request);
  const outage = findOpen(nameOutageIssue(app));
  if (check.status === "broken")
    return [await reportOutage({ app, check, outage, github, runUrl })];
  const issue = findOpen(nameNoCodeIssue(app));
  return [
    await reportOpening({ app, outage, github, runUrl }),
    ...(await reportNoCode({ app, isOpenWithoutCode: !!check.note, issue, github, runUrl })),
  ];
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
    lines.push(...(await reportCheck({ app, check: checks[index], openIssues, github, runUrl })));
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = await watchApps({
    repository: String(process.env.GITHUB_REPOSITORY),
    runUrl: String(process.env.RUN_URL),
  });
  for (const line of lines) console.log(line);
}
