// Gives a pull request labeled preview a preview of each app's beta Worker it changes, named for
// the pull request, which serves the pull request's page on beta's data, so a design round runs on
// the real app without holding beta. A preview answers only at its name under its app's preview
// host, which, like a page host, never shows in the repo, a log, or a comment.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { listApps } from "./apps.mjs";
import { writeWorker } from "./build.mjs";
import { checkPageAt } from "./check-page.mjs";
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
const COMMENT_MARKER = "<!-- preview -->";

/** @param {number | string} pullRequest */
export const namePreview = (pullRequest) => `pr-${pullRequest}`;

/** @param {string} app */
export const nameHostSecret = (app) => `${app.toUpperCase()}_PREVIEW_HOST`;

/** @param {string} app */
export const nameKeySecret = (app) => `${app.toUpperCase()}_BETA_APP_KEY`;

/**
 * Where a pull request's preview of an app opens, under beta's key and signed in with beta's
 * access code, since beta's Worker answers the preview's access and data.
 * @param {string} app
 * @param {number | string} pullRequest
 * @param {NodeJS.ProcessEnv} env
 */
export function readPreviewAccess(app, pullRequest, env) {
  const missing = [nameHostSecret(app), nameKeySecret(app)].filter((secret) => !env[secret]);
  if (missing.length) throw new Error(`Set the preview environment's ${missing.join(" and ")}.`);
  const host = String(env[nameHostSecret(app)]);
  return {
    host,
    pageUrl: `https://${namePreview(pullRequest)}.${host}/${env[nameKeySecret(app)]}/`,
    accessCode: env.ACCESS_CODE || undefined,
  };
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
 * Builds the app as beta, so the preview has beta's tag and tuning panel, and uploads it as the
 * pull request's preview of beta's Worker.
 * @param {object} options
 * @param {string} options.app
 * @param {string} options.name
 * @param {string} options.host
 * @param {typeof writeWorker} options.buildApp
 * @param {typeof runWrangler} options.wrangler
 */
async function uploadPreview({ app, name, host, buildApp, wrangler }) {
  await buildApp(app, { channel: CHANNEL });
  const config = `apps/${app}/worker/wrangler.toml`;
  try {
    await wrangler(["preview", "--config", config, "--env", CHANNEL, "--name", name, "--json"]);
  } catch (error) {
    throw new Error(`${app} preview failed: ${describeWranglerError(error, host)}`, {
      cause: error,
    });
  }
}

/**
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {string[]} options.apps
 * @param {"up" | "unchanged" | "broken" | "deleted"} options.state
 * @param {string} [options.commit]
 */
export function describePreview({ pullRequest, apps, state, commit }) {
  const name = `\`${namePreview(pullRequest)}\``;
  const lines = {
    up: `Preview ${name} is up for ${apps.join(" and ")} at ${commit?.slice(0, 7)}, at its name under each app's preview host. The session gives the link in chat.`,
    unchanged: `No app's Worker changes in this pull request, so there's no preview ${name}.`,
    broken: `Preview ${name} didn't open at ${commit?.slice(0, 7)}. The Preview workflow's log says why.`,
    deleted: `Preview ${name} is deleted.`,
  };
  return `${COMMENT_MARKER}\n${lines[state]}`;
}

/**
 * Puts the text in the pull request's one preview comment, adding it the first time.
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {string} options.body
 * @param {typeof fetch} options.fetchImpl
 * @param {NodeJS.ProcessEnv} options.env
 */
async function writePreviewComment({ pullRequest, body, fetchImpl, env }) {
  const github = createGitHub({ repository: String(env.GITHUB_REPOSITORY), fetchImpl, env });
  const comments = await readAllPages(github, `/issues/${pullRequest}/comments`);
  const comment = comments.find((each) => each.body?.startsWith(COMMENT_MARKER));
  if (comment) await github(`/issues/comments/${comment.id}`, { method: "PATCH", body: { body } });
  else await github(`/issues/${pullRequest}/comments`, { method: "POST", body: { body } });
}

/**
 * Makes or replaces the pull request's preview of each app it changes, opens each as a phone does,
 * and says so on the pull request. Fails when a preview doesn't open.
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {string} options.base the base branch's commit
 * @param {import("./deploy.mjs").Git} [options.git]
 * @param {typeof writeWorker} [options.buildApp]
 * @param {typeof runWrangler} [options.wrangler]
 * @param {typeof checkPageAt} [options.checkPage]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function deployPreviews({
  pullRequest,
  base,
  git = runGit,
  buildApp = writeWorker,
  wrangler = runWrangler,
  checkPage = checkPageAt,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  const apps = listPreviewedApps(listPullRequestChanges(base, git));
  const commit = git(["rev-parse", "HEAD"]);
  /** @param {"up" | "unchanged" | "broken"} state */
  const comment = (state) =>
    writePreviewComment({
      pullRequest,
      body: describePreview({ pullRequest, apps, state, commit }),
      fetchImpl,
      env,
    });
  if (!apps.length) {
    log("No app's Worker changes, so there's no preview.");
    await comment("unchanged");
    return [];
  }
  const name = namePreview(pullRequest);
  const broken = [];
  for (const app of apps) {
    const { host, ...access } = readPreviewAccess(app, pullRequest, env);
    await uploadPreview({ app, name, host, buildApp, wrangler });
    log(`${app} preview ${name}: uploaded`);
    const check = await checkPage({ access, commit, env, attempts: 6, isLiveChecked: true });
    const reason = check.status === "drawn" ? "" : `: ${hideHost(check.reason, host)}`;
    log(`${app} preview check: ${check.status}${reason}`);
    if (check.status === "broken") broken.push(app);
  }
  await comment(broken.length ? "broken" : "up");
  if (broken.length) throw new Error(`The preview didn't open for ${broken.join(" and ")}.`);
  return apps;
}

/**
 * Deletes the pull request's preview of every app.
 * @param {object} options
 * @param {number | string} options.pullRequest
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function deletePreviews({
  pullRequest,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const workers = `${findWorkersApi(readAccount(env))}/workers`;
  const name = namePreview(pullRequest);
  for (const app of listApps()) {
    const worker = loadWorkerConfig(app, CHANNEL).name;
    await callCloudflare(
      `${app} preview ${name}`,
      `${workers}/${worker}/previews/${name}`,
      { method: "DELETE" },
      { isMissingAllowed: true },
    );
  }
  await writePreviewComment({
    pullRequest,
    body: describePreview({ pullRequest, apps: [], state: "deleted" }),
    fetchImpl,
    env,
  });
}

/** @param {string | undefined} text */
function checkPullRequest(text) {
  if (!/^\d+$/.test(text ?? "")) throw new Error("Name the pull request by its number.");
  return String(text);
}

/** @type {Record<string, (args: string[]) => Promise<unknown>>} */
const COMMANDS = {
  deploy: ([pullRequest, base]) =>
    deployPreviews({ pullRequest: checkPullRequest(pullRequest), base }),
  delete: ([pullRequest]) => deletePreviews({ pullRequest: checkPullRequest(pullRequest) }),
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
