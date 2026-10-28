// Uses Cloudflare's REST API, not wrangler, so it works when a proxy adds the token:
// wrangler refuses to start without CLOUDFLARE_API_TOKEN in the environment.
import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nameServiceBinding } from "../shared/worker/services.js";
import {
  findWorkerRoot,
  isService,
  listApps,
  listServices,
  listWorkers,
  listWorkersOrExit,
} from "./apps.mjs";
import { buildWorker } from "./build.mjs";
import { findChannel, readCommandLine } from "./channels.mjs";
import { checkAppPage } from "./check-page.mjs";
import { checkService } from "./check-service.mjs";
import { CHECK_INTERVAL_MS, CHECK_TIMEOUT_MS, waitFor } from "./check-timing.mjs";
import { decideDeploy, listChangedFiles } from "./deploy-scope.mjs";
import { createGitHub } from "./github-api.mjs";
import { isAncestor, isGitObjectId } from "./git-object.mjs";
import { readDeployedMain } from "./production-coverage.mjs";

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
  const storeClass = readSetting(toml, "class_name");
  if (!name || !compatibilityDate || !storeClass)
    throw new Error(
      environment
        ? `wrangler.toml needs compatibility_date, its store's class_name, and an [env.${environment}] with a name`
        : "wrangler.toml needs name, compatibility_date, and its store's class_name",
    );
  return { name, compatibilityDate, storeClass };
}

/**
 * The config of a Worker, an app's or a service's, on a channel.
 * @param {string} worker
 * @param {string} [channel]
 * @param {import("./apps.mjs").WorkerRoots} [roots]
 */
export const loadWorkerConfig = (worker, channel, roots) =>
  readWorkerConfig(
    readFileSync(new URL("worker/wrangler.toml", findWorkerRoot(worker, roots)), "utf8"),
    channel,
  );

/** @typedef {(args: string[]) => string} Git */

/** @type {Git} */
export const runGit = (args) =>
  execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim();

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

// Limits each phone's tries at the access code and its daily count's sends, each apart. The
// namespace is the account's own number for these limits, and each Worker keys them by purpose,
// its own address, and the phone's.
const ACCESS_LIMIT_BINDING = {
  type: "ratelimit",
  name: "ACCESS_LIMIT",
  namespace_id: "2701",
  simple: { limit: 10, period: 60 },
};
// The version a service runs, as its upload's tag names it, which its health reports.
const VERSION_BINDING = { type: "version_metadata", name: "VERSION" };
// Each browser's or Home Screen app's one count a day (shared/worker/daily-count.js). Only
// production's apps count, so testing on beta adds nothing to the counts.
const DAILY_OPENS_BINDING = {
  type: "analytics_engine",
  name: "DAILY_OPENS",
  dataset: "daily_opens",
};

/**
 * An app's binding to each service, named for it, to its Worker on the app's own channel.
 * @param {string} channel
 * @param {import("./apps.mjs").WorkerRoots} [roots]
 */
const listServiceBindings = (channel, roots) =>
  listServices(roots?.servicesRoot).map((service) => ({
    type: "service",
    name: nameServiceBinding(service),
    service: loadWorkerConfig(service, channel, roots).name,
  }));

/**
 * @param {{ storeClass: string, isPageless: boolean, channel: string, roots?: import("./apps.mjs").WorkerRoots }} worker
 */
export function listBindings({ storeClass, isPageless, channel, roots }) {
  const store = { type: "durable_object_namespace", name: "STORE", class_name: storeClass };
  if (isPageless) return [store, VERSION_BINDING];
  const counts = channel === "production" ? [DAILY_OPENS_BINDING] : [];
  return [store, ACCESS_LIMIT_BINDING, ...counts, ...listServiceBindings(channel, roots)];
}

// Cloudflare records the last tag applied and rejects an upload that repeats one.
/** @param {string} storeClass the Worker's Durable Object */
export const listMigrations = (storeClass) => [{ tag: "v1", new_sqlite_classes: [storeClass] }];

/**
 * @param {string | undefined} appliedTag
 * @param {string} storeClass
 */
export function listPendingMigrations(appliedTag, storeClass) {
  const migrations = listMigrations(storeClass);
  const pending = migrations.slice(migrations.findIndex(({ tag }) => tag === appliedTag) + 1);
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

const WORKERS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

// A token limited to its channel's Workers can't read the account's workers.dev subdomain, so a
// secret names it. Deploy logs are public, so a wrong one is never repeated back.
export function readWorkersSubdomain(env) {
  const subdomain = env.CLOUDFLARE_WORKERS_SUBDOMAIN;
  if (!subdomain)
    throw new Error(
      "Set CLOUDFLARE_WORKERS_SUBDOMAIN to the account's workers.dev subdomain (Cloudflare dashboard > Workers & Pages, beside the Account ID).",
    );
  if (!WORKERS_SUBDOMAIN_PATTERN.test(subdomain))
    throw new Error(
      "CLOUDFLARE_WORKERS_SUBDOMAIN holds more than a subdomain: set it to just the part before .workers.dev.",
    );
  return subdomain;
}

/**
 * @param {string} name The Worker's name.
 * @param {string} subdomain The account's workers.dev subdomain.
 */
export const formatWorkerUrl = (name, subdomain) => `https://${name}.${subdomain}.workers.dev/`;

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
      return isGitObjectId(recorded) ? recorded : null;
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
 * The app Workers on a channel, each with its address, where a service's health is read.
 * @param {string} channel
 * @param {string} subdomain The account's workers.dev subdomain.
 * @param {import("./apps.mjs").WorkerRoots} [roots]
 */
export const listAppWorkers = (channel, subdomain, roots) =>
  listApps(roots?.appsRoot).map((app) => ({
    app,
    url: formatWorkerUrl(loadWorkerConfig(app, channel, roots).name, subdomain),
  }));

/**
 * @typedef {object} ServiceDeploymentOptions
 * @property {boolean} [isCheckOnly] Check the live service without uploading it.
 * @property {(confirm: () => Promise<void>) => void} [deferServiceCheck] Keep its check until apps settle.
 */

/**
 * @typedef {object} WorkerDeploymentOptions
 * @property {string} worker The app or service whose Worker this is.
 * @property {string} [channel] The channel whose Worker this is.
 * @property {import("./apps.mjs").WorkerRoots} [roots] Where the apps and services are.
 * @property {string} script The bundled Worker to upload.
 * @property {string} [commit] The commit the bundle was built from, recorded on the version.
 * @property {string | null} [checkedCommit] Previously verified production coverage.
 * @property {() => void} [onCovered] Reports fresh verification or equivalent verified runtime.
 * @property {(since: string) => string[] | null} [findChanges] Files changed since a commit.
 * @property {typeof fetch} [fetchImpl]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {typeof console.log} [log]
 * @property {(milliseconds: number) => Promise<unknown>} [pause]
 * @property {typeof checkAppPage} [checkPage] Opens the app's live page.
 * @property {(commit: string, of: string) => boolean} [isEarlier] Whether a commit comes
 *   before another in main's history.
 */

/**
 * Deploys a Worker. An app's answers at its workers.dev address, and its page has to draw. A
 * service has no address, so it answers through the apps' health.
 * @param {WorkerDeploymentOptions & ServiceDeploymentOptions} options
 * @returns {Promise<string | null>} the app's address or the service's name, or null when nothing
 *   needed deploying
 */
export async function deploy({
  worker,
  channel = "production",
  roots,
  script,
  commit,
  checkedCommit,
  onCovered,
  findChanges = listChangedFiles,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  pause = waitFor,
  checkPage = checkAppPage,
  isCheckOnly = false,
  deferServiceCheck,
  isEarlier = (earlier, of) => isAncestor(runGit, earlier, of),
}) {
  const account = readAccount(env);
  const subdomain = readWorkersSubdomain(env);
  const { name, compatibilityDate, storeClass } = loadWorkerConfig(worker, channel, roots);
  const isPageless = isService(worker, roots?.servicesRoot);
  const { isForcePushed } = findChannel(channel);
  const base = findWorkersApi(account);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const deployments = createDeploymentsClient({ base, name, callCloudflare });

  function logWorkerCheck() {
    log("worker check: ok");
  }

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
  function isDeployNeeded(liveCommit) {
    if (!liveCommit) return true;
    if (isLiveNewer(liveCommit)) {
      log(
        `::notice::The live version is at ${liveCommit.slice(0, 7)}, which already has ${commit?.slice(0, 7)}, so nothing was deployed.`,
      );
      return false;
    }
    const { isNeeded, reason } = decideDeploy(findChanges(liveCommit), worker);
    log(isNeeded ? reason : `::notice::${reason}`);
    return isNeeded;
  }

  function shouldRecheckLive(liveCommit) {
    if (!liveCommit || !commit || !(Number(env.GITHUB_RUN_ATTEMPT) > 1)) return false;
    if (liveCommit === commit) return true;
    return !isForcePushed && isEarlier(liveCommit, commit);
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
            bindings: listBindings({ storeClass, isPageless, channel, roots }),
            keep_bindings: ["secret_text"],
            ...(commit && {
              annotations: { "workers/message": commit, "workers/tag": commit.slice(0, 7) },
            }),
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

  /** @returns {Promise<never>} */
  async function restoreAfter(problem, previousVersions) {
    if (!previousVersions) throw new Error(`${problem}, and no earlier version exists.`);
    await deployments.putLive(previousVersions).catch((error) => {
      throw new Error(`${problem}, and the new version is still live: ${error.message}`);
    });
    throw new Error(`${problem}, so the earlier version is live again.`);
  }

  /** @returns {Promise<never>} */
  async function rejectFailedCheck(problem, previousVersions, isUploaded) {
    if (!isUploaded) throw new Error(`${problem}; no version was uploaded or rolled back.`);
    return restoreAfter(problem, previousVersions);
  }

  // Deploy logs are public, and the address names the account's workers.dev subdomain.
  async function confirmWorkerAnswers(url, previousVersions, isUploaded, expectedCommit) {
    if (!previousVersions) log("worker check: waiting for the new workers.dev address to resolve");
    const attempts = previousVersions ? CHECK_ATTEMPTS : FIRST_DEPLOY_CHECK_ATTEMPTS;
    if (await isWorkerAnswering(url, { fetchImpl, pause, commit: expectedCommit, attempts }))
      return;
    await rejectFailedCheck(
      isUploaded
        ? "The Worker didn't answer as the new version"
        : "The Worker didn't answer as its recorded live version",
      previousVersions,
      isUploaded,
    );
  }

  /** @returns {never} */
  function rejectUnverifiedPage(reason, isUploaded) {
    const state = isUploaded
      ? "The new version is live but unverified"
      : "The recorded live version is unverified";
    throw new Error(`${state}: ${reason}.`);
  }

  async function confirmPageDraws(previousVersions, isUploaded, expectedCommit) {
    const check = await checkPage({
      app: worker,
      channel,
      commit: expectedCommit,
      env,
      isAccessCodeRequired: true,
    }).catch((error) => ({
      status: /** @type {const} */ ("unchecked"),
      reason: `the page check failed: ${error instanceof Error ? error.message : error}`,
    }));
    if (check.status === "unchecked") rejectUnverifiedPage(check.reason, isUploaded);
    if (check.status === "drawn" && check.isOpenWithoutCode)
      rejectUnverifiedPage("the page opened without asking for its access code", isUploaded);
    if (check.status === "broken")
      await rejectFailedCheck(
        `The page didn't draw as ${isUploaded ? "the new version" : "its recorded live version"}: ${check.reason}`,
        previousVersions,
        isUploaded,
      );
    log("page check: ok");
  }

  async function confirmAppAnswers(previousVersions, isUploaded, expectedCommit) {
    await confirmWorkerAnswers(
      formatWorkerUrl(name, subdomain),
      previousVersions,
      isUploaded,
      expectedCommit,
    );
    await confirmPageDraws(previousVersions, isUploaded, expectedCommit);
    logWorkerCheck();
    onCovered?.();
  }

  // A service faces only the apps, through their bindings, so it has no address of its own.
  async function setWorkersDevRoute(previousVersions) {
    try {
      await callCloudflare("workers.dev route", `${base}/scripts/${name}/subdomain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !isPageless, previews_enabled: false }),
      });
    } catch (error) {
      await restoreAfter(error instanceof Error ? error.message : String(error), previousVersions);
    }
  }

  async function confirmServiceAnswers(previousVersions, expectedCommit, isUploaded) {
    if (!isUploaded && !expectedCommit)
      throw new Error("The service has no recorded live commit to check.");
    const check = await checkService({
      service: worker,
      apps: listAppWorkers(channel, subdomain, roots),
      commit: expectedCommit,
      attempts: SERVICE_CHECK_ATTEMPTS,
      pause,
      fetchImpl,
    });
    if (check.status === "answering") {
      const notice = check.attention ? "::notice::" : "";
      log(`${notice}health check: ok${check.attention ? `, but ${check.attention}` : ""}`);
    }
    if (check.status === "unchecked") log(`::notice::health check: skipped, ${check.reason}`);
    if (check.status === "unanswered") {
      const versionProblem = isUploaded
        ? "The service didn't answer as the new version"
        : "The service didn't answer as the live version";
      const problem = `${versionProblem}: ${check.reason}`;
      if (!isUploaded) throw new Error(problem);
      await restoreAfter(problem, previousVersions);
    }
    if (isUploaded) logWorkerCheck();
    // An unbound service is safely excluded only after every app health answered.
    if (
      isUploaded ||
      (expectedCommit && !decideDeploy(findChanges(expectedCommit), worker).isNeeded)
    )
      onCovered?.();
  }

  async function scheduleServiceCheck(previousVersions, expectedCommit, isUploaded) {
    const confirm = () => confirmServiceAnswers(previousVersions, expectedCommit, isUploaded);
    if (deferServiceCheck) deferServiceCheck(confirm);
    else await confirm();
  }

  const previousVersions = await findLiveVersions();
  const liveCommit =
    previousVersions && (await deployments.readCommit(previousVersions, "live commit"));
  if (isCheckOnly || !isDeployNeeded(liveCommit)) {
    if (isPageless) await scheduleServiceCheck(previousVersions, liveCommit, false);
    else if (shouldRecheckLive(liveCommit))
      await confirmAppAnswers(previousVersions, false, liveCommit);
    else if (
      checkedCommit &&
      !isLiveNewer(liveCommit) &&
      !decideDeploy(findChanges(checkedCommit), worker).isNeeded
    )
      onCovered?.();
    return null;
  }
  const migrations = listPendingMigrations(await readMigrationTag(), storeClass);
  await uploadWorker(migrations);
  await setWorkersDevRoute(previousVersions);
  const deployed = isPageless ? name : formatWorkerUrl(name, subdomain);
  if (isPageless) {
    await scheduleServiceCheck(previousVersions, commit, true);
  } else {
    await confirmAppAnswers(previousVersions, true, commit);
  }
  return deployed;
}

const CHECK_ATTEMPTS = 12;
// An app may keep a service's answer for a minute, as its health keeps its store's.
const SERVICE_CHECK_ATTEMPTS = 30;
// A Worker's first workers.dev address can take minutes to resolve. A redeploy's already does, so
// a slow answer there means a bad version to roll back.
const FIRST_DEPLOY_CHECK_ATTEMPTS = 60;
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

// Each line names its Worker, after any GitHub annotation that has to start it.
/** @param {string} worker */
const createWorkerLog = (worker) => (message) => {
  const [, annotation = "", text] = message.match(/^(::\w+::)?(.*)$/s);
  console.log(`${annotation}${worker}: ${text}`);
};

/**
 * Settles a group of tasks, one per Worker, and says whether each succeeded.
 * @param {string[]} workers
 * @param {(worker: string) => Promise<unknown>} deployWorker
 * @param {(line: string) => void} logError
 */
async function deployGroup(workers, deployWorker, logError) {
  const results = await Promise.allSettled(workers.map((worker) => deployWorker(worker)));
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    const { reason } = result;
    logError(`${workers[index]}: ${reason instanceof Error ? reason.message : reason}`);
  }
  return results.every((result) => result.status === "fulfilled");
}

/**
 * Deploys every service at once, then every app at once, since an app's binding to a service needs
 * the service to exist. One Worker's failed deploy doesn't hold back the others.
 * Broken versions and route failures restore earlier versions; unavailable verification leaves
 * the upload live. Services are checked only once all app deploys have settled.
 * @param {string[]} workers
 * @param {(worker: string, options: ServiceDeploymentOptions) => Promise<unknown>} deployWorker
 * @param {{ logError?: (line: string) => void, isServiceWorker?: (worker: string) => boolean, serviceWorkers?: string[] }} [options]
 * @returns {Promise<boolean>} whether every Worker deployed and every service passed its check
 */
export async function deployWorkers(
  workers,
  deployWorker,
  {
    logError = console.error,
    isServiceWorker = (worker) => isService(worker),
    serviceWorkers = [],
  } = {},
) {
  const services = [...new Set([...workers.filter(isServiceWorker), ...serviceWorkers])];
  const apps = workers.filter((worker) => !isServiceWorker(worker));
  /** @type {Map<string, () => Promise<void>>} */
  const serviceChecks = new Map();
  const prepareService = (worker) =>
    deployWorker(worker, {
      isCheckOnly: !workers.includes(worker),
      deferServiceCheck: (confirm) => serviceChecks.set(worker, confirm),
    });
  const areServicesDeployed = await deployGroup(services, prepareService, logError);
  const areAppsDeployed = await deployGroup(apps, (worker) => deployWorker(worker, {}), logError);
  const areServicesConfirmed = await deployGroup(
    [...serviceChecks.keys()],
    (worker) => serviceChecks.get(worker)(),
    logError,
  );
  return areServicesDeployed && areAppsDeployed && areServicesConfirmed;
}

/**
 * Builds the selected Workers and checks every service on their channel after apps settle.
 * @param {string[]} workers
 * @param {object} [options]
 * @param {string} [options.channel]
 * @param {string} [options.commit]
 * @param {string | null} [options.checkedCommit]
 * @param {(worker: string) => void} [options.onCovered]
 * @param {import("./apps.mjs").WorkerRoots} [options.roots]
 * @param {typeof buildWorker} [options.buildWorkerImpl]
 * @param {typeof deploy} [options.deployWorkerImpl]
 * @param {(line: string) => void} [options.logError]
 * @returns {Promise<boolean>} whether every Worker deployed and every service passed its check
 */
export async function deployRelease(
  workers,
  {
    channel = "production",
    commit,
    checkedCommit,
    onCovered,
    roots,
    buildWorkerImpl = buildWorker,
    deployWorkerImpl = deploy,
    logError = console.error,
  } = {},
) {
  /** @param {string} worker @param {ServiceDeploymentOptions} options */
  const deployWorker = async (worker, options) =>
    deployWorkerImpl({
      ...options,
      worker,
      channel,
      roots,
      script: options.isCheckOnly ? "" : await buildWorkerImpl(worker, { channel }),
      commit,
      checkedCommit,
      onCovered: () => onCovered?.(worker),
      log: createWorkerLog(worker),
    });
  return deployWorkers(workers, deployWorker, {
    serviceWorkers: listServices(roots?.servicesRoot),
    isServiceWorker: (worker) => isService(worker, roots?.servicesRoot),
    logError,
  });
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

/** @typedef {"passed" | "not passed" | "unknown"} CiState */

/**
 * Whether CI on main passed on a commit, or "unknown" when GitHub couldn't be asked: it answers
 * only a run that holds GH_TOKEN and names GITHUB_REPOSITORY, as Actions does, and a read can fail.
 * @param {string} commit
 * @param {{ fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<CiState>}
 */
export async function readMainCiState(commit, { fetchImpl = fetch, env = process.env } = {}) {
  if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY) return "unknown";
  const github = createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl, env });
  try {
    const { workflow_runs: runs } = await github(
      `/actions/workflows/ci.yml/runs?head_sha=${commit}&event=push&per_page=1`,
    );
    return runs[0]?.conclusion === "success" ? "passed" : "not passed";
  } catch {
    return "unknown";
  }
}

/**
 * Why a commit its branch has moved past deploys or not. A push to a force-pushed branch deploys at
 * once, so it covers the commit before it. A merge to main deploys only once CI passes on it, so
 * until then, or while GitHub can't say, the commit before it deploys, in case it never does.
 * @param {{ commit: string, newer: string, channel: string }} release
 * @param {(commit: string) => Promise<CiState>} readCiState
 * @returns {Promise<{ isCovered: boolean, message: string }>}
 */
export async function decideMovedOn({ commit, newer, channel }, readCiState) {
  const { branch, isForcePushed } = findChannel(channel);
  const [shortCommit, shortNewer] = [commit.slice(0, 7), newer.slice(0, 7)];
  const movedOn = `::notice::${branch} has moved on to ${shortNewer}`;
  const ciState = isForcePushed ? "passed" : await readCiState(newer);
  if (ciState === "passed")
    return {
      isCovered: true,
      message: `${movedOn}, whose deploy covers ${shortCommit}, so nothing was deployed.`,
    };
  const why =
    ciState === "unknown"
      ? `but GitHub couldn't be asked whether CI on ${branch} passed on it`
      : `but CI on ${branch} hasn't passed on it`;
  return { isCovered: false, message: `${movedOn}, ${why}, so ${shortCommit} deploys.` };
}

/** @param {NodeJS.ProcessEnv} env @param {typeof fetch} fetchImpl */
async function readPreviousCheckedCommit(env, fetchImpl) {
  if (!env.GITHUB_REPOSITORY) return null;
  try {
    return await readDeployedMain(
      createGitHub({ repository: env.GITHUB_REPOSITORY, fetchImpl, env }),
    );
  } catch {
    console.log("::notice::No previous checked production coverage could be verified.");
    return null;
  }
}

/**
 * A receipt covers every repository Worker through fresh verification or equivalent previously
 * verified runtime. A successful no-op alone proves no page was verified.
 * @param {string[]} workers
 * @param {{ channel: string, commit: string, newer: string | null }} release
 * @param {{ readCiState?: typeof readMainCiState, deploy?: typeof deployRelease, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, readCheckedCommit?: typeof readPreviousCheckedCommit, requiredWorkers?: string[] }} [options]
 */
export async function deployCheckedRelease(
  workers,
  { channel, commit, newer },
  {
    readCiState = readMainCiState,
    deploy = deployRelease,
    env = process.env,
    fetchImpl = fetch,
    readCheckedCommit = readPreviousCheckedCommit,
    requiredWorkers = listWorkers(),
  } = {},
) {
  const { branch } = findChannel(channel);
  if (newer) {
    const { isCovered, message } = await decideMovedOn({ commit, newer, channel }, readCiState);
    console.log(message);
    if (isCovered) return true;
  }
  const needsReceipt = channel === "production" && !!env.GITHUB_OUTPUT;
  const checkedCommit = needsReceipt ? await readCheckedCommit(env, fetchImpl) : null;
  const covered = new Set();
  console.log(`Deploying ${branch} at ${commit.slice(0, 7)} to ${channel}`);
  if (
    !(await deploy(workers, {
      channel,
      commit,
      checkedCommit,
      onCovered: (worker) => covered.add(worker),
    }))
  )
    return false;
  if (needsReceipt) {
    if (requiredWorkers.length && requiredWorkers.every((worker) => covered.has(worker)))
      appendFileSync(env.GITHUB_OUTPUT, `checked-commit=${commit}\n`);
    else console.log("::notice::No production receipt: some Workers lack verified coverage.");
  }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positionals, channel } = readCommandLineOrExit(process.argv.slice(2));
  const workers = listWorkersOrExit(positionals[0]);
  const release = readReleaseOrExit(channel);
  if (!(await deployCheckedRelease(workers, { ...release, channel }))) process.exit(1);
}
