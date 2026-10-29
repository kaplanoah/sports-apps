// Opens each app's live page on a schedule, as a phone does, and keeps one open issue for each app
// that isn't opening, so its owner hears of an outage before the people who use it do, and one for
// each that opens without asking for its code. It keeps one for each service the apps reach that
// isn't answering them, too, and one for each that answers but needs its owner. An app or service
// that fails once is checked again a minute later, so a moment's hiccup opens nothing. It keeps one
// for each app whose health says its league's feeds are failing, which the health says only once
// they've failed for a while. Each issue closes once its app, service, or feeds are right again.
import { fileURLToPath } from "node:url";
import { listApps, listServices } from "./apps.mjs";
import { checkAppPage } from "./check-page.mjs";
import { FEED_FAILURE_MS } from "../shared/worker/feed-failures.js";
import { checkFeeds } from "./check-feeds.mjs";
import { checkService } from "./check-service.mjs";
import { listAppWorkers, readWorkersSubdomain } from "./deploy.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { closeIssue, findOpenIssue, openIssue } from "./issues.mjs";

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

/** @param {string} service */
export const nameServiceAttentionIssue = (service) => `The ${service} service needs attention`;

/** @param {string} attention @param {string} runUrl */
const describeServiceAttention = (attention, runUrl) =>
  `The service answers the apps, but says: ${attention}.\n\nSee [the check's run](${runUrl}). This issue closes itself once the service no longer asks for attention.`;

/** @param {string} app */
export const nameFeedIssue = (app) => `The ${app.toUpperCase()} app's league feeds are failing`;

/** @param {Record<string, import("./check-feeds.mjs").FeedFailure>} feeds */
const listFeeds = (feeds) =>
  Object.entries(feeds)
    .map(([feed, { since, reason }]) => `- \`${feed}\`: ${reason} (failing since ${since})`)
    .join("\n");

/**
 * @param {Record<string, import("./check-feeds.mjs").FeedFailure>} feeds
 * @param {string} runUrl
 */
const describeFeedFailures = (feeds, runUrl) =>
  `The app's health says these feeds have been failing for ${FEED_FAILURE_MS / 60000} minutes or more:\n\n${listFeeds(feeds)}\n\nSee [the check's run](${runUrl}). This issue closes itself once every feed answers again.`;

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
  const number = await openIssue(github, nameOutageIssue(app), describeOutage(check, runUrl));
  return `${app}: not opening, ${check.reason}; opened #${number}`;
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
    const number = await openIssue(github, nameNoCodeIssue(app), describeNoCode(app, runUrl));
    return [`::warning::${app}: opens without its code; opened #${number}`];
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
  const outage = findOpenIssue(openIssues, nameOutageIssue(app));
  if (check.status === "broken")
    return [await reportOutage({ app, check, outage, github, runUrl })];
  const issue = findOpenIssue(openIssues, nameNoCodeIssue(app));
  return [
    await reportOpening({ app, outage, github, runUrl }),
    ...(await reportNoCode({
      app,
      isOpenWithoutCode: !!check.isOpenWithoutCode,
      issue,
      github,
      runUrl,
    })),
  ];
}

/**
 * Keeps the app's one feed issue open while its health says its league's feeds are failing.
 * @param {object} options
 * @param {string} options.app
 * @param {import("./check-feeds.mjs").FeedCheck} options.check
 * @param {any[]} options.openIssues
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string[]>}
 */
async function reportFeedCheck({ app, check, openIssues, github, runUrl }) {
  if (check.status === "unchecked")
    return [`::warning::${app}: feeds not checked, ${check.reason}`];
  const issue = findOpenIssue(openIssues, nameFeedIssue(app));
  if (check.status === "failing") {
    const names = Object.keys(check.feeds).join(", ");
    if (issue) return [`::warning::${app}: feeds failing: ${names}; #${issue.number} is open`];
    const body = describeFeedFailures(check.feeds, runUrl);
    const number = await openIssue(github, nameFeedIssue(app), body);
    return [`::warning::${app}: feeds failing: ${names}; opened #${number}`];
  }
  if (!issue) return [];
  await closeIssue(github, issue.number, `Every feed answers again, as of [this run](${runUrl}).`);
  return [`${app}: feeds answer again, so #${issue.number} is closed`];
}

/**
 * Keeps the service's one outage issue open while it isn't answering the apps.
 * @param {object} options
 * @param {string} options.service
 * @param {import("./check-service.mjs").ServiceCheck & { status: "unanswered" }} options.check
 * @param {any} options.outage the service's open outage issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 */
async function reportServiceOutage({ service, check, outage, github, runUrl }) {
  if (outage) return `${service}: still not answering, ${check.reason}; #${outage.number} is open`;
  const title = nameServiceIssue(service);
  const number = await openIssue(github, title, describeServiceOutage(check, runUrl));
  return `${service}: not answering, ${check.reason}; opened #${number}`;
}

/**
 * Closes the service's outage issue once it answers again.
 * @param {object} options
 * @param {string} options.service
 * @param {any} options.outage the service's open outage issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 */
async function reportServiceAnswering({ service, outage, github, runUrl }) {
  if (!outage) return `${service}: answers`;
  await closeIssue(
    github,
    outage.number,
    `The service answers again, as of [this run](${runUrl}).`,
  );
  return `${service}: answers again, so #${outage.number} is closed`;
}

/**
 * Keeps an issue open while a service that answers asks for its owner's attention.
 * @param {object} options
 * @param {string} options.service
 * @param {string | undefined} options.attention what the service says it needs, if anything
 * @param {any} options.issue the service's open attention issue, if any
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string[]>}
 */
async function reportServiceAttention({ service, attention, issue, github, runUrl }) {
  if (attention && issue) return [`::warning::${service}: ${attention}; #${issue.number} is open`];
  if (attention) {
    const title = nameServiceAttentionIssue(service);
    const number = await openIssue(github, title, describeServiceAttention(attention, runUrl));
    return [`::warning::${service}: ${attention}; opened #${number}`];
  }
  if (!issue) return [];
  await closeIssue(
    github,
    issue.number,
    `The service no longer asks for attention, as of [this run](${runUrl}).`,
  );
  return [`${service}: no longer needs attention, so #${issue.number} is closed`];
}

/**
 * Brings one service's issues up to date with its check, and says what it did, a line for each.
 * @param {object} options
 * @param {string} options.service
 * @param {import("./check-service.mjs").ServiceCheck} options.check
 * @param {any[]} options.openIssues
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.runUrl
 * @returns {Promise<string[]>}
 */
async function reportServiceCheck({ service, check, openIssues, github, runUrl }) {
  if (check.status === "unchecked") return [`::warning::${service}: not checked, ${check.reason}`];
  const outage = findOpenIssue(openIssues, nameServiceIssue(service));
  if (check.status === "unanswered")
    return [await reportServiceOutage({ service, check, outage, github, runUrl })];
  const issue = findOpenIssue(openIssues, nameServiceAttentionIssue(service));
  return [
    await reportServiceAnswering({ service, outage, github, runUrl }),
    ...(await reportServiceAttention({
      service,
      attention: check.attention,
      issue,
      github,
      runUrl,
    })),
  ];
}

/**
 * The app's production Worker.
 * @param {string} app
 * @param {string} subdomain
 */
const findWorkerUrl = (app, subdomain) =>
  String(listAppWorkers("production", subdomain).find((worker) => worker.app === app)?.url);

/**
 * @param {object} options
 * @param {string} options.repository as owner/name
 * @param {string} options.runUrl
 * @param {string[]} [options.apps]
 * @param {(app: string) => Promise<import("./check-page.mjs").PageCheck>} [options.checkApp]
 * @param {string[]} [options.services]
 * @param {(service: string) => Promise<import("./check-service.mjs").ServiceCheck>} [options.checkServiceOf]
 * @param {(app: string) => Promise<import("./check-feeds.mjs").FeedCheck>} [options.checkFeedsOf]
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
  checkFeedsOf = (app) =>
    checkFeeds({
      url: findWorkerUrl(app, readWorkersSubdomain(env)),
      accessCode: env.ACCESS_CODE,
      fetchImpl,
    }),
}) {
  const github = createGitHub({ repository, fetchImpl, env });
  const openIssues = await readAllPages(github, "/issues?state=open");
  const [checks, feedChecks, serviceChecks] = await Promise.all([
    Promise.all(apps.map((app) => checkApp(app))),
    Promise.all(apps.map((app) => checkFeedsOf(app))),
    Promise.all(services.map((service) => checkServiceOf(service))),
  ]);
  const lines = [];
  for (const [index, app] of apps.entries())
    lines.push(
      ...(await reportCheck({ app, check: checks[index], openIssues, github, runUrl })),
      ...(await reportFeedCheck({ app, check: feedChecks[index], openIssues, github, runUrl })),
    );
  for (const [index, service] of services.entries())
    lines.push(
      ...(await reportServiceCheck({
        service,
        check: serviceChecks[index],
        openIssues,
        github,
        runUrl,
      })),
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
