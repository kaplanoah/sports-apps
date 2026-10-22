// Gives a pull request labeled preview a preview of each app's beta Worker it changes, named for
// the pull request, which serves the pull request's page on beta's data, so a design round runs on
// the real app without holding beta. A preview answers only at its name under its app's preview
// host, which, like a page host, never shows in the repo, a log, or a comment.
//
// The pull request's own code only builds, in the Preview build workflow, which has no secret. The
// Preview workflow runs this file as main has it, with the token, and takes from that build only
// each app's bundle, which it uploads but never runs.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { listApps } from "./apps.mjs";
import { findOutput, writeWorker } from "./build.mjs";
import { checkPageAt, nameAccessSecrets, readPageAccess } from "./check-page.mjs";
import {
  createCloudflareCaller,
  findWorkersApi,
  loadWorkerConfig,
  readAccount,
  runGit,
} from "./deploy.mjs";
import { findDeployedChanges, listChangedFiles } from "./deploy-scope.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";

const CHANNEL = "beta";
const LABEL = "preview";
const COMMENT_MARKER = "<!-- preview -->";
const BUILD_FOLDER = "preview";
const BUILD_MANIFEST = "build.json";
// The pull request events after which it no longer asks for previews.
const ENDING_ACTIONS = ["unlabeled", "closed"];

/** @param {number | string} pullRequest */
export const namePreview = (pullRequest) => `pr-${pullRequest}`;

/** @param {string} app */
export const nameHostSecret = (app) => `${app.toUpperCase()}_PREVIEW_HOST`;

/**
 * Where a pull request's preview of an app opens: beta's page, with beta's key and access code,
 * since beta's Worker answers the preview's access and data, at the preview's name under its host.
 * @param {string} app
 * @param {number | string} pullRequest
 * @param {NodeJS.ProcessEnv} env
 */
export function readPreviewAccess(app, pullRequest, env) {
  const beta = readPageAccess(app, CHANNEL, env);
  const missing = [
    ...(beta ? [] : [nameAccessSecrets(app, CHANNEL).pageUrl]),
    ...(env[nameHostSecret(app)] ? [] : [nameHostSecret(app)]),
  ];
  if (!beta || missing.length)
    throw new Error(`Set the preview environment's ${missing.join(" and ")}.`);
  const host = String(env[nameHostSecret(app)]);
  const pageUrl = new URL(beta.pageUrl);
  pageUrl.hostname = `${namePreview(pullRequest)}.${host}`;
  return { host, pageUrl: pageUrl.href, accessCode: beta.accessCode };
}

/**
 * The apps whose Workers the changes reach, and every app when they couldn't be listed.
 * @param {string[] | null} changedFiles
 * @param {string[]} [apps]
 */
export const listPreviewedApps = (changedFiles, apps = listApps()) =>
  apps.filter((app) => changedFiles === null || findDeployedChanges(changedFiles, app).length);

/**
 * @param {string} text
 * @param {string} host
 */
export const hideHost = (text, host) => text.replaceAll(host, "<preview host>");

/**
 * The files the pull request changes, since where it left its base.
 * @param {string} base the base branch's commit
 * @param {import("./deploy.mjs").Git} git
 */
function listPullRequestChanges(base, git) {
  try {
    return listChangedFiles(git(["merge-base", base, "HEAD"]), git);
  } catch {
    return null;
  }
}

/** @param {string | undefined} text */
function checkPullRequest(text) {
  if (!/^\d+$/.test(text ?? "")) throw new Error("Name the pull request by its number.");
  return String(text);
}

/** @param {string} folder @param {string} app */
const findBundle = (folder, app) => path.join(folder, `${app}.mjs`);

/**
 * Builds each app the pull request changes as beta, so its preview has beta's tag and tuning
 * panel, into the folder the Preview workflow takes, which names the pull request and its apps.
 * An event that ends its previews builds nothing, so code that doesn't build can't keep them up.
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {string} options.base the base branch's commit
 * @param {string} options.action the pull request event's
 * @param {import("./deploy.mjs").Git} [options.git]
 * @param {typeof writeWorker} [options.buildApp]
 * @param {string} [options.folder]
 * @param {typeof console.log} [options.log]
 */
export async function buildPreviews({
  pullRequest,
  base,
  action,
  git = runGit,
  buildApp = writeWorker,
  folder = BUILD_FOLDER,
  log = console.log,
}) {
  const apps = ENDING_ACTIONS.includes(action)
    ? []
    : listPreviewedApps(listPullRequestChanges(base, git));
  mkdirSync(folder, { recursive: true });
  for (const app of apps) {
    const { output } = await buildApp(app, { channel: CHANNEL });
    copyFileSync(output, findBundle(folder, app));
    log(`${app}: built`);
  }
  const manifest = { pullRequest: Number(pullRequest), apps };
  writeFileSync(path.join(folder, BUILD_MANIFEST), JSON.stringify(manifest));
  return apps;
}

/**
 * What the pull request's build hands on, trusting none of it: its number, and of this repo's
 * apps, the ones it built.
 * @param {string} folder
 */
export function readBuild(folder) {
  const manifest = JSON.parse(readFileSync(path.join(folder, BUILD_MANIFEST), "utf8"));
  const named = Array.isArray(manifest.apps) ? manifest.apps : [];
  return {
    pullRequest: checkPullRequest(String(manifest.pullRequest)),
    apps: listApps().filter((app) => named.includes(app) && existsSync(findBundle(folder, app))),
  };
}

/**
 * Whether the pull request still asks for previews: open, from this repo, and labeled preview.
 * @param {{ state: string, labels: { name: string }[], head: { repo: { full_name: string } | null } }} pull
 * @param {string} repository
 */
export const isPreviewWanted = (pull, repository) =>
  pull.state === "open" &&
  pull.head.repo?.full_name === repository &&
  pull.labels.some((label) => label.name === LABEL);

const runCommand = promisify(execFile);

// The Preview workflow installs wrangler before the token is there, so no install script sees it.
// Wrangler's answer names the preview's address, so it's read, never shown.
/** @param {string[]} args */
async function runWrangler(args) {
  const { stdout } = await runCommand("npx", ["--no-install", "wrangler", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * @param {unknown} error
 * @param {string} host
 */
function describeWranglerError(error, host) {
  const { stderr = "", message = String(error) } = /** @type {any} */ (error);
  const why = String(stderr).trim().split("\n").slice(-5).join("\n") || message;
  return hideHost(why, host);
}

/**
 * Puts the app's bundle from the build where its wrangler.toml names its Worker.
 * @param {string} bundle
 * @param {string} app
 */
function placeBundle(bundle, app) {
  const output = findOutput(app);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(bundle, output);
}

/**
 * Uploads the app's bundle as the pull request's preview of beta's Worker.
 * @param {object} options
 * @param {string} options.app
 * @param {string} options.folder
 * @param {string} options.name
 * @param {string} options.host
 * @param {typeof runWrangler} options.wrangler
 * @param {typeof placeBundle} options.place
 */
async function uploadPreview({ app, folder, name, host, wrangler, place }) {
  place(findBundle(folder, app), app);
  const config = `apps/${app}/worker/wrangler.toml`;
  try {
    await wrangler(["preview", "--config", config, "--env", CHANNEL, "--name", name, "--json"]);
  } catch (error) {
    throw new Error(`${app} preview failed: ${describeWranglerError(error, host)}`, {
      cause: error,
    });
  }
}

/** @typedef {"up" | "unchecked" | "broken" | "unchanged" | "deleted"} PreviewState */

/**
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {string[]} options.apps
 * @param {PreviewState} options.state
 * @param {string} [options.commit]
 */
export function describePreview({ pullRequest, apps, state, commit }) {
  const name = `\`${namePreview(pullRequest)}\``;
  const short = commit?.slice(0, 7);
  const lines = {
    up: `Preview ${name} is up for ${apps.join(" and ")} at ${short}, at its name under each app's preview host. The session gives the link in chat.`,
    unchecked: `Preview ${name} is uploaded for ${apps.join(" and ")} at ${short}, but couldn't be opened to check it. The Preview workflow's log says why.`,
    broken: `Preview ${name} didn't open at ${short}. The Preview workflow's log says why.`,
    unchanged: `No app's Worker changes in this pull request, so there's no preview ${name}.`,
    deleted: `Preview ${name} is deleted.`,
  };
  return `${COMMENT_MARKER}\n${lines[state]}`;
}

/**
 * What the pull request's previews came to, from whether it asks for them and how each opened.
 * @param {boolean} isWanted
 * @param {import("./check-page.mjs").PageCheck[]} checks
 * @returns {PreviewState}
 */
export function judgePreviews(isWanted, checks) {
  if (!isWanted) return "deleted";
  if (!checks.length) return "unchanged";
  if (checks.some((check) => check.status === "broken")) return "broken";
  if (checks.some((check) => check.status === "unchecked")) return "unchecked";
  return "up";
}

/**
 * Puts the text in the pull request's one preview comment, adding it the first time.
 * @param {object} options
 * @param {ReturnType<typeof createGitHub>} options.github
 * @param {string} options.pullRequest
 * @param {string} options.body
 */
async function writePreviewComment({ github, pullRequest, body }) {
  const comments = await readAllPages(github, `/issues/${pullRequest}/comments`);
  const comment = comments.find((each) => each.body?.startsWith(COMMENT_MARKER));
  if (comment) await github(`/issues/comments/${comment.id}`, { method: "PATCH", body: { body } });
  else await github(`/issues/${pullRequest}/comments`, { method: "POST", body: { body } });
}

/**
 * Deletes the pull request's preview of each app, one that's gone too.
 * @param {object} options
 * @param {string[]} options.apps
 * @param {string} options.name
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 * @param {typeof console.log} options.log
 */
async function deletePreviews({ apps, name, fetchImpl, env, log }) {
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const workers = `${findWorkersApi(readAccount(env))}/workers`;
  for (const app of apps) {
    const worker = loadWorkerConfig(app, CHANNEL).name;
    await callCloudflare(
      `${app} preview ${name}`,
      `${workers}/${worker}/previews/${name}`,
      { method: "DELETE" },
      { isMissingAllowed: true },
    );
  }
}

/**
 * Uploads the pull request's preview of each app it built and opens each as a phone does.
 * @param {object} options
 * @param {string[]} options.apps
 * @param {string} options.pullRequest
 * @param {string} options.commit
 * @param {string} options.folder
 * @param {typeof runWrangler} options.wrangler
 * @param {typeof placeBundle} options.place
 * @param {typeof checkPageAt} options.checkPage
 * @param {NodeJS.ProcessEnv} options.env
 * @param {typeof console.log} options.log
 */
async function openPreviews(options) {
  const { apps, pullRequest, commit, folder, wrangler, place, checkPage, env, log } = options;
  const name = namePreview(pullRequest);
  const checks = [];
  for (const app of apps) {
    const { host, ...access } = readPreviewAccess(app, pullRequest, env);
    await uploadPreview({ app, folder, name, host, wrangler, place });
    log(`${app} preview ${name}: uploaded`);
    const check = await checkPage({ access, commit, env, attempts: 6, isLiveChecked: true });
    const reason = check.status === "drawn" ? "" : `: ${hideHost(check.reason, host)}`;
    log(`${app} preview check: ${check.status}${reason}`);
    checks.push(check);
  }
  return checks;
}

/**
 * Brings the pull request's previews in line with its build of the commit: while it asks for
 * them, one of each app it built, opened and checked, and none of any other app. Does nothing once
 * the pull request has a newer commit, whose build follows. Fails when a preview doesn't open.
 * @param {object} options
 * @param {string} options.commit the commit the build was of
 * @param {string} [options.folder]
 * @param {typeof runWrangler} [options.wrangler]
 * @param {typeof placeBundle} [options.place]
 * @param {typeof checkPageAt} [options.checkPage]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function syncPreviews({
  commit,
  folder = BUILD_FOLDER,
  wrangler = runWrangler,
  place = placeBundle,
  checkPage = checkPageAt,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  const build = readBuild(folder);
  const { pullRequest } = build;
  const repository = String(env.GITHUB_REPOSITORY);
  const github = createGitHub({ repository, fetchImpl, env });
  const pull = await github(`/pulls/${pullRequest}`);
  if (pull.head.sha !== commit) {
    log("The pull request has a newer commit, whose build follows.");
    return [];
  }
  const isWanted = isPreviewWanted(pull, repository);
  const apps = isWanted ? build.apps : [];
  const name = namePreview(pullRequest);
  const unwanted = listApps().filter((app) => !apps.includes(app));
  await deletePreviews({ apps: unwanted, name, fetchImpl, env, log });
  const checks = await openPreviews({
    apps,
    pullRequest,
    commit,
    folder,
    wrangler,
    place,
    checkPage,
    env,
    log,
  });
  const state = judgePreviews(isWanted, checks);
  await writePreviewComment({
    github,
    pullRequest,
    body: describePreview({ pullRequest, apps, state, commit }),
  });
  const unopened = apps.filter((_, index) => checks[index].status !== "drawn");
  if (unopened.length) throw new Error(`The preview didn't open for ${unopened.join(" and ")}.`);
  return apps;
}

/** @type {Record<string, (args: string[]) => Promise<unknown>>} */
const COMMANDS = {
  build: ([pullRequest, base, action]) =>
    buildPreviews({ pullRequest: checkPullRequest(pullRequest), base, action }),
  sync: ([commit]) => {
    if (!/^[0-9a-f]{40}$/.test(commit ?? "")) throw new Error("Name the commit the build was of.");
    return syncPreviews({ commit });
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      if (!Object.hasOwn(COMMANDS, command))
        throw new Error(`Name a command: ${Object.keys(COMMANDS).join(", ")}.`);
      return COMMANDS[command](args);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
