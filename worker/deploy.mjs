// Uses Cloudflare's REST API, not wrangler, so it works when a proxy adds the token:
// wrangler refuses to start without CLOUDFLARE_API_TOKEN in the environment.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findAppRoot, listAppsOrExit } from "./apps.mjs";
import { buildWorker } from "./build.mjs";
import { findChannel, readCommandLine } from "./channels.mjs";
import { checkAppPage } from "./check-page.mjs";
import { decideDeploy, listChangedFiles } from "./deploy-scope.mjs";
import { createGitHub } from "./github-api.mjs";

export const API = "https://api.cloudflare.com/client/v4";
const root = new URL("../", import.meta.url);

// A channel's environment names its own Worker, which keeps the top level's other settings.
/**
 * @param {string} toml
 * @param {string} [channel]
 */
export function readWorkerConfig(toml, channel = "production") {
  const { environment } = findChannel(channel);
  const [topLevel, ...sections] = toml.split(/^(?=\[)/m);
  const readSetting = (text, key) =>
    (text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m")) || [])[1];
  const section = environment
    ? (sections.find((text) => text.startsWith(`[env.${environment}]\n`)) ?? "")
    : topLevel;
  const name = readSetting(section, "name");
  const compatibilityDate = readSetting(topLevel, "compatibility_date");
  if (!name || !compatibilityDate)
    throw new Error(
      environment
        ? `wrangler.toml needs compatibility_date, and an [env.${environment}] with a name`
        : "wrangler.toml needs name and compatibility_date",
    );
  return { name, compatibilityDate };
}

/**
 * @param {string} app
 * @param {string} [channel]
 */
export const readAppWorkerConfig = (app, channel) =>
  readWorkerConfig(
    readFileSync(new URL("worker/wrangler.toml", findAppRoot(app)), "utf8"),
    channel,
  );

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/** @typedef {(args: string[]) => string} Git */

/** @type {Git} */
export const runGit = (args) =>
  execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim();

/**
 * Whether `commit` is `of` or comes before it in its history, and false when git doesn't know
 * either one.
 * @param {Git} git
 * @param {string} commit
 * @param {string} of
 */
export function isAncestor(git, commit, of) {
  try {
    git(["merge-base", "--is-ancestor", commit, of]);
    return true;
  } catch {
    return false;
  }
}

// A commit its channel's branch has since moved past is a release a newer one may cover. A branch
// each push replaces, as beta's force pushes do, can move past a commit without building on it,
// so there a commit the push that started this run brought is one the branch held.
/**
 * @param {Git} [git]
 * @param {string} [channel]
 * @param {string} [pushedCommit] the commit the push that started this run brought, in Actions
 * @returns {{ commit: string, newer: string | null }}
 */
export function checkRelease(
  git = runGit,
  channel = "production",
  pushedCommit = process.env.GITHUB_SHA,
) {
  const { branch, howToShip, isForcePushed } = findChannel(channel);
  if (git(["status", "--porcelain"]))
    throw new Error(`There are uncommitted changes. Deploy only what is on ${branch}.`);
  git(["fetch", "--quiet", "origin", branch]);
  const local = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", `origin/${branch}`]);
  if (local === remote) return { commit: local, newer: null };
  const wasHeld = (isForcePushed && local === pushedCommit) || isAncestor(git, local, remote);
  if (wasHeld) return { commit: local, newer: remote };
  const checkout = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  throw new Error(
    `This checkout (${checkout} at ${local.slice(0, 7)}) isn't ${branch} as GitHub has it (${remote.slice(0, 7)}). ${howToShip}, or check out origin/${branch}, and try again.`,
  );
}

const NO_CREDENTIALS = new Set([9106, 1001]);

const STORE_BINDING = {
  type: "durable_object_namespace",
  name: "STORE",
  class_name: "SeasonStore",
};
// Counts each phone's tries at the access code. The namespace is the account's own number for
// these counts, and each Worker keys its counts by its own address.
const ACCESS_LIMIT_BINDING = {
  type: "ratelimit",
  name: "ACCESS_LIMIT",
  namespace_id: "2701",
  simple: { limit: 10, period: 60 },
};
// Cloudflare records the last tag applied and rejects an upload that repeats one.
export const MIGRATIONS = [{ tag: "v1", new_sqlite_classes: ["SeasonStore"] }];

export function listPendingMigrations(appliedTag) {
  const pending = MIGRATIONS.slice(MIGRATIONS.findIndex(({ tag }) => tag === appliedTag) + 1);
  if (!pending.length) return null;
  return {
    old_tag: appliedTag,
    new_tag: pending.at(-1).tag,
    steps: pending.map(({ tag, ...step }) => step),
  };
}

export function readAccount(env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID)
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID (Cloudflare dashboard > Workers & Pages > Account ID).",
    );
  return env.CLOUDFLARE_ACCOUNT_ID;
}

export const findWorkersApi = (account) => `${API}/accounts/${account}/workers`;

// A call Cloudflare never answers would otherwise hold the deploy, and every deploy after it.
const CLOUDFLARE_TIMEOUT_MS = 60 * 1000;

export function createCloudflareCaller({ fetchImpl, env, log }) {
  const auth = env.CLOUDFLARE_API_TOKEN
    ? { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
    : {};

  return async function callCloudflare(what, url, init, { isMissingAllowed = false } = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...auth, ...(init.headers || {}) },
      signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
    });
    if (isMissingAllowed && response.status === 404) {
      log(`${what}: none`);
      return null;
    }
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON: shown raw below */
    }
    if (!response.ok || body.success === false) {
      const errors = body.errors || [];
      // A refusal from a proxy or firewall explains itself only in its raw body.
      const raw = text.trim()
        ? `HTTP ${response.status} (server: ${response.headers.get("server") || "?"}): ${text.trim().slice(0, 500)}`
        : `HTTP ${response.status}`;
      const why = errors.map((error) => `${error.code}: ${error.message}`).join("; ") || raw;
      const hint =
        !env.CLOUDFLARE_API_TOKEN && errors.some((error) => NO_CREDENTIALS.has(error.code))
          ? `\nNo token reached Cloudflare. In a cloud session the proxy adds it, but only to requests sent through the proxy: ` +
            `run this through its npm script, which sets NODE_USE_ENV_PROXY=1 (needs Node 22.21 or later; this is ${process.version}). ` +
            `Anywhere else, set CLOUDFLARE_API_TOKEN.`
          : "";
      throw new Error(`${what} failed: ${why}${hint}`);
    }
    log(`${what}: ok`);
    return body.result;
  };
}

// The version with the most traffic, which is all of it outside a rollout.
/** @param {{ version_id: string, percentage: number }[]} versions */
export const findMainVersion = (versions) =>
  [...versions].sort((first, second) => second.percentage - first.percentage)[0];

/** @param {{ created_on: string }} first @param {{ created_on: string }} second */
const compareNewestFirst = (first, second) =>
  Number(first.created_on < second.created_on) - Number(first.created_on > second.created_on);

/**
 * A Worker's deployments, the commit each version records, and putting versions live.
 * @param {{ base: string, name: string, callCloudflare: ReturnType<typeof createCloudflareCaller> }} options
 */
export function createDeploymentsClient({ base, name, callCloudflare }) {
  const deploymentsUrl = `${base}/scripts/${name}/deployments`;
  return {
    /**
     * Each deployment's versions, newest first, and none for a Worker never deployed.
     * @returns {Promise<{ version_id: string, percentage: number }[][]>}
     */
    async listDeployments() {
      const result = await callCloudflare(
        "live version",
        deploymentsUrl,
        { method: "GET" },
        { isMissingAllowed: true },
      );
      return [...(result?.deployments || [])]
        .sort(compareNewestFirst)
        .map(({ versions }) =>
          versions.map(({ version_id, percentage }) => ({ version_id, percentage })),
        );
    },
    /**
     * @param {{ version_id: string, percentage: number }[]} versions
     * @param {string} what
     * @returns {Promise<string | null>}
     */
    async readCommit(versions, what) {
      const version = await callCloudflare(
        what,
        `${base}/scripts/${name}/versions/${findMainVersion(versions).version_id}`,
        { method: "GET" },
      );
      const recorded = version?.annotations?.["workers/message"];
      return COMMIT_PATTERN.test(recorded || "") ? recorded : null;
    },
    /** @param {{ version_id: string, percentage: number }[]} versions */
    async putLive(versions) {
      await callCloudflare("rollback", deploymentsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ strategy: "percentage", versions }),
      });
    },
  };
}

/**
 * @param {object} options
 * @param {string} options.app The app whose Worker this is.
 * @param {string} [options.channel] The channel whose Worker this is.
 * @param {string} options.script The bundled Worker to upload.
 * @param {string} [options.commit] The commit the bundle was built from, recorded on the version.
 * @param {(since: string) => string[] | null} [options.findChanges] Files changed since a commit.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {(milliseconds: number) => Promise<unknown>} [options.pause]
 * @param {typeof checkAppPage} [options.checkPage] Opens the new version's page.
 * @param {(commit: string, of: string) => boolean} [options.isEarlier] Whether a commit comes
 *   before another in main's history.
 * @returns {Promise<string | null>} the Worker's address, or null when nothing needed deploying
 */
export async function deploy({
  app,
  channel = "production",
  script,
  commit,
  findChanges = listChangedFiles,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  pause = waitFor,
  checkPage = checkAppPage,
  isEarlier = (earlier, of) => isAncestor(runGit, earlier, of),
}) {
  const account = readAccount(env);
  const { name, compatibilityDate } = readAppWorkerConfig(app, channel);
  const { isForcePushed } = findChannel(channel);
  const base = findWorkersApi(account);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const deployments = createDeploymentsClient({ base, name, callCloudflare });

  async function findLiveVersions() {
    const [newest] = await deployments.listDeployments();
    return newest ?? null;
  }

  // A newer merge's deploy can go live before an older merge's run gets here, which would
  // otherwise put older code back. Each push to beta replaces what it held, whatever it was.
  /** @param {string} liveCommit */
  const isLiveNewer = (liveCommit) =>
    !isForcePushed && !!commit && liveCommit !== commit && isEarlier(commit, liveCommit);

  // Without a recorded commit, there's nothing to compare with, so it deploys.
  async function isDeployNeeded(previousVersions) {
    const liveCommit =
      previousVersions && (await deployments.readCommit(previousVersions, "live commit"));
    if (!liveCommit) return true;
    if (isLiveNewer(liveCommit)) {
      log(
        `::notice::The live version is at ${liveCommit.slice(0, 7)}, which already has ${commit?.slice(0, 7)}, so nothing was deployed.`,
      );
      return false;
    }
    const { isNeeded, reason } = decideDeploy(findChanges(liveCommit), app);
    log(isNeeded ? reason : `::notice::${reason}`);
    return isNeeded;
  }

  async function readMigrationTag() {
    const scripts = await callCloudflare("migration tag", `${base}/scripts`, { method: "GET" });
    return scripts.find((stored) => stored.id === name)?.migration_tag;
  }

  async function uploadWorker(migrations) {
    const form = new FormData();
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "worker.mjs",
            compatibility_date: compatibilityDate,
            observability: { enabled: true, traces: { enabled: true } },
            bindings: [STORE_BINDING, ACCESS_LIMIT_BINDING],
            keep_bindings: ["secret_text"],
            ...(commit && { annotations: { "workers/message": commit } }),
            ...(migrations && { migrations }),
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append(
      "worker.mjs",
      new Blob([script], { type: "application/javascript+module" }),
      "worker.mjs",
    );
    await callCloudflare("upload", `${base}/scripts/${name}`, { method: "PUT", body: form });
  }

  async function enableWorkersDevRoute() {
    await callCloudflare("workers.dev route", `${base}/scripts/${name}/subdomain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
  }

  async function readWorkerUrl() {
    const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, {
      method: "GET",
    });
    return `https://${name}.${subdomain}.workers.dev/`;
  }

  // The upload makes the new version live, so anything that goes wrong after it puts the
  // earlier one back.
  /** @returns {Promise<never>} */
  async function restoreAfter(problem, previousVersions) {
    if (!previousVersions) throw new Error(`${problem}, and no earlier version exists.`);
    await deployments.putLive(previousVersions).catch((error) => {
      throw new Error(`${problem}, and the new version is still live: ${error.message}`);
    });
    throw new Error(`${problem}, so the earlier version is live again.`);
  }

  // Deploy logs are public, and the address names the account's workers.dev subdomain.
  async function confirmWorkerAnswers(url, previousVersions) {
    if (!previousVersions) log("worker check: waiting for the new workers.dev address to resolve");
    const attempts = previousVersions ? CHECK_ATTEMPTS : FIRST_DEPLOY_CHECK_ATTEMPTS;
    if (await isWorkerAnswering(url, { fetchImpl, pause, commit, attempts })) return;
    await restoreAfter("The Worker didn't answer as the new version", previousVersions);
  }

  // A Worker can answer while its page throws or never draws, which a phone would show. A check
  // that itself fails is no proof the page draws.
  async function confirmPageDraws(previousVersions) {
    const check = await checkPage({ app, channel, commit, env }).catch((error) => ({
      status: /** @type {const} */ ("broken"),
      reason: `the page check failed: ${error instanceof Error ? error.message : error}`,
    }));
    if (check.status === "drawn") log("page check: ok");
    if (check.status === "unchecked") log(`::notice::page check: skipped, ${check.reason}`);
    if (check.status === "broken")
      await restoreAfter(
        `The page didn't draw as the new version: ${check.reason}`,
        previousVersions,
      );
  }

  async function findNewVersionUrl(previousVersions) {
    try {
      await enableWorkersDevRoute();
      return await readWorkerUrl();
    } catch (error) {
      return restoreAfter(error instanceof Error ? error.message : String(error), previousVersions);
    }
  }

  const previousVersions = await findLiveVersions();
  if (!(await isDeployNeeded(previousVersions))) return null;
  const migrations = listPendingMigrations(await readMigrationTag());
  await uploadWorker(migrations);
  const url = await findNewVersionUrl(previousVersions);
  await confirmWorkerAnswers(url, previousVersions);
  await confirmPageDraws(previousVersions);
  log("worker check: ok");
  return url;
}

const CHECK_ATTEMPTS = 12;
// A Worker's first workers.dev address can take minutes to resolve. A redeploy's already does, so
// a slow answer there means a bad version to roll back.
const FIRST_DEPLOY_CHECK_ATTEMPTS = 60;
const CHECK_INTERVAL_MS = 5000;
const CHECK_TIMEOUT_MS = 10000;

const waitFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// The build names its commit in short form, and a version built from no known commit names none.
/**
 * @param {Response} response
 * @param {string} [commit]
 */
function isFromCommit(response, commit) {
  if (!commit) return true;
  const served = response.headers.get("x-release-commit");
  return !!served && commit.startsWith(served);
}

// robots.txt answers without the page's key, and names the release the Worker serves.
async function isRobotsAnswered(url, fetchImpl, commit) {
  try {
    const response = await fetchImpl(new URL("robots.txt", url).href, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return response.ok && isFromCommit(response, commit);
  } catch {
    return false;
  }
}

// A new version takes a few seconds to reach every Cloudflare location, and until then the one
// before it answers.
async function isWorkerAnswering(
  url,
  { fetchImpl = fetch, pause = waitFor, commit = undefined, attempts = CHECK_ATTEMPTS },
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await pause(CHECK_INTERVAL_MS);
    if (await isRobotsAnswered(url, fetchImpl, commit)) return true;
  }
  return false;
}

// Each line names its app, after any GitHub annotation that has to start it.
/** @param {string} app */
const createAppLog = (app) => (message) => {
  const [, annotation = "", text] = message.match(/^(::\w+::)?(.*)$/s);
  console.log(`${annotation}${app}: ${text}`);
};

/**
 * Deploys every app at once. One app's failed deploy doesn't hold back the others; each puts its
 * own earlier version back.
 * @param {string[]} apps
 * @param {(app: string) => Promise<unknown>} deployApp
 * @param {(line: string) => void} [logError]
 * @returns {Promise<boolean>} whether every app deployed
 */
export async function deployApps(apps, deployApp, logError = console.error) {
  const results = await Promise.allSettled(apps.map((app) => deployApp(app)));
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const { reason } = result;
    logError(`${apps[index]}: ${reason instanceof Error ? reason.message : reason}`);
  }
  return results.every((result) => result.status === "fulfilled");
}

/** @param {string} channel */
function readReleaseOrExit(channel) {
  try {
    return checkRelease(undefined, channel);
  } catch (error) {
    console.error(`Not deploying: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/** @param {string[]} args */
function readCommandLineOrExit(args) {
  try {
    return readCommandLine(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Whether CI on main passed on a commit, which GitHub answers only to a run in Actions that holds
 * GH_TOKEN, and false when it can't tell.
 * @param {string} commit
 * @param {{ fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} [options]
 */
export async function hasMainCiPassed(commit, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY) return false;
  const github = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl, env });
  try {
    const { workflow_runs: runs } = await github(
      `/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=1`,
    );
    return runs[0]?.conclusion === "success";
  } catch {
    return false;
  }
}

/**
 * Why a commit its branch has moved past deploys or not. A push to a force-pushed branch deploys at
 * once, so it covers the commit before it. A merge to main deploys only once CI passes on it, so
 * until then the commit before it deploys, in case it never does.
 * @param {{ commit: string, newer: string, channel: string }} release
 * @param {(commit: string) => Promise<boolean>} hasCiPassed
 * @returns {Promise<{ isCovered: boolean, message: string }>}
 */
export async function decideMovedOn({ commit, newer, channel }, hasCiPassed) {
  const { branch, isForcePushed } = findChannel(channel);
  const [shortCommit, shortNewer] = [commit.slice(0, 7), newer.slice(0, 7)];
  if (isForcePushed || (await hasCiPassed(newer)))
    return {
      isCovered: true,
      message: `::notice::${branch} has moved on to ${shortNewer}, whose deploy covers ${shortCommit}, so nothing was deployed.`,
    };
  return {
    isCovered: false,
    message: `::notice::${branch} has moved on to ${shortNewer}, but CI on ${branch} hasn't passed on it, so ${shortCommit} deploys.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positionals, channel } = readCommandLineOrExit(process.argv.slice(2));
  const apps = listAppsOrExit(positionals[0]);
  const { branch } = findChannel(channel);
  const { commit, newer } = readReleaseOrExit(channel);
  if (newer) {
    const { isCovered, message } = await decideMovedOn({ commit, newer, channel }, hasMainCiPassed);
    console.log(message);
    if (isCovered) process.exit(0);
  }
  console.log(`Deploying ${branch} at ${commit.slice(0, 7)} to ${channel}`);
  const isDeployed = await deployApps(apps, async (app) =>
    deploy({
      app,
      channel,
      script: await buildWorker(app, { channel }),
      commit,
      log: createAppLog(app),
    }),
  );
  if (!isDeployed) process.exit(1);
}
