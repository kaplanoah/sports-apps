// Opens each app's live page on a schedule, as a phone does, and keeps one open issue for each app
// that isn't opening, so its owner hears of an outage before the people who use it do, and one for
// each that opens without asking for its code. It keeps one for each service the apps reach that
// isn't answering them, too. An app or service that fails once is checked again a minute later, so
// a moment's hiccup opens nothing; each issue closes once its app or service is right again.
import { fileURLToPath } from "node:url";
import { listApps, listServices } from "./apps.mjs";
import { checkAppPage } from "./check-page.mjs";
import { checkService } from "./check-service.mjs";
import { listAppWorkers, readWorkersSubdomain } from "./deploy.mjs";
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
  `The page opened without asking for its access code, so anyone with its address can open it. Give it the code every app asks for again with \`npm run set-access-code -- ${app} <code>\`.\n\nSee [the check's run](${runUrl}). This issue closes itself once the app asks for its code again, or the \`production\` environment holds no \`ACCESS_CODE\`, which stops this check for every app.`;

/** @param {string} service */
export const nameServiceIssue = (service) => `The ${service} service isn't answering`;

/**
 * @param {import("./check-service.mjs").ServiceCheck & { status: "unanswered" }} check
 * @param {string} runUrl
 */
const describeServiceOutage = (check, runUrl) =>
  `Asked through each app's health twice a minute apart, ${check.reason}.\n\nSee [the check's run](${runUrl}). This issue closes itself once the service answers again.`;

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
 * Keeps the service's one issue open while it isn't answering the apps, and says what it did.
 * @param {object} options
 * @param {string} options.service
 * @param {import("./check-service.mjs").ServiceCheck} options.check
 * @param {any[]} options.openIssues
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string>}
 */
async function reportServiceCheck({ service, check, openIssues, github, runUrl }) {
  if (check.status === "unchecked") return `::warning::${service}: not checked, ${check.reason}`;
  const issue = openIssues.find(
    (open) => open.title === nameServiceIssue(service) && !open.pull_request,
  );
  if (check.status === "unanswered") {
    if (issue) return `${service}: still not answering, ${check.reason}; #${issue.number} is open`;
    const created = await github("/issues", {
      method: "POST",
      body: { title: nameServiceIssue(service), body: describeServiceOutage(check, runUrl) },
    });
    return `${service}: not answering, ${check.reason}; opened #${created.number}`;
  }
  if (!issue) return `${service}: answers`;
  await closeIssue(github, issue.number, `The service answers again, as of [this run](${runUrl}).`);
  return `${service}: answers again, so #${issue.number} is closed`;
}

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.runUrl
 * @param {string[]} [options.apps]
 * @param {(app: string) => Promise<import("./check-page.mjs").PageCheck>} [options.checkApp]
 * @param {string[]} [options.services]
 * @param {(service: string) => Promise<import("./check-service.mjs").ServiceCheck>} [options.checkServiceOf]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 */
export async function watchApps({
  repository,
  runUrl,
  apps = listApps(),
  checkApp = (app) =>
    checkAppPage({ app, channel: "production", attempts: 2, pauseMs: RECHECK_DELAY_MS }),
  services = listServices(),
  fetchImpl = fetch,
  env = process.env,
  checkServiceOf = (service) =>
    checkService({
      service,
      apps: listAppWorkers("production", readWorkersSubdomain(env)),
      attempts: 2,
      pauseMs: RECHECK_DELAY_MS,
      fetchImpl,
    }),
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const openIssues = await readAllPages(github, "/issues?state=open");
  const [checks, serviceChecks] = await Promise.all([
    Promise.all(apps.map((app) => checkApp(app))),
    Promise.all(services.map((service) => checkServiceOf(service))),
  ]);
  const lines = [];
  for (const [index, app] of apps.entries())
    lines.push(...(await reportCheck({ app, check: checks[index], openIssues, github, runUrl })));
  for (const [index, service] of services.entries())
    lines.push(
      await reportServiceCheck({
        service,
        check: serviceChecks[index],
        openIssues,
        github,
        runUrl,
      }),
    );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = await watchApps({
    repository: String(process.env.GITHUB_REPOSITORY),
    runUrl: String(process.env.RUN_URL),
  });
  for (const line of lines) console.log(line);
}
