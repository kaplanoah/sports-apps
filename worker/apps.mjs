// Each league's app lives in apps/<name>/: its page, its Worker, and its tests. A service lives in
// services/<name>/ the same way, but with no page: a Worker the apps reach by a binding, which
// never faces the public. The tooling builds, deploys, and rolls back both kinds of Worker.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APPS_ROOT = new URL("../apps/", import.meta.url);
const SERVICES_ROOT = new URL("../services/", import.meta.url);

/** @typedef {{ appsRoot?: URL, servicesRoot?: URL }} WorkerRoots the folders that hold each kind */

/**
 * @param {string} app
 * @param {URL} [appsRoot] the folder that holds every app's
 */
export const findAppRoot = (app, appsRoot = APPS_ROOT) => new URL(`${app}/`, appsRoot);

// A Worker is a folder whose Worker has a wrangler.toml.
/** @param {URL} root the folder that holds every one of a kind */
const listWorkerFolders = (root) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => existsSync(new URL(`${name}/worker/wrangler.toml`, root)))
        .sort()
    : [];

/** @param {URL} [appsRoot] the folder that holds every app's */
export const listApps = (appsRoot = APPS_ROOT) => listWorkerFolders(appsRoot);

/** @param {URL} [servicesRoot] the folder that holds every service's */
export const listServices = (servicesRoot = SERVICES_ROOT) => listWorkerFolders(servicesRoot);

// Services come first, since an app's binding to a service needs the service to exist.
/** @param {WorkerRoots} [roots] */
export const listWorkers = ({ appsRoot, servicesRoot } = {}) => [
  ...listServices(servicesRoot),
  ...listApps(appsRoot),
];

/**
 * Whether a Worker is a service, with no page, rather than an app.
 * @param {string} worker
 * @param {URL} [servicesRoot]
 */
export const isService = (worker, servicesRoot = SERVICES_ROOT) =>
  listServices(servicesRoot).includes(worker);

/**
 * The folder that holds a Worker, an app's or a service's.
 * @param {string} worker
 * @param {WorkerRoots} [roots]
 */
export const findWorkerRoot = (
  worker,
  { appsRoot = APPS_ROOT, servicesRoot = SERVICES_ROOT } = {},
) => new URL(`${worker}/`, isService(worker, servicesRoot) ? servicesRoot : appsRoot);

/**
 * A Worker's folder from the repo's root, as git names it, like apps/mlb/.
 * @param {string} worker
 * @param {URL} [servicesRoot]
 */
export const findWorkerFolder = (worker, servicesRoot = SERVICES_ROOT) =>
  `${isService(worker, servicesRoot) ? "services" : "apps"}/${worker}/`;

// The apps with browser tests, each of which Playwright runs as its own project.
/** @param {URL} [appsRoot] the folder that holds every app's */
export const listAppsWithBrowserTests = (appsRoot = APPS_ROOT) =>
  listApps(appsRoot).filter((app) =>
    existsSync(new URL("tests/browser/", findAppRoot(app, appsRoot))),
  );

/**
 * The name a command gives, or an error that lists the ones there are.
 * @param {string | undefined} name
 * @param {string[]} names
 * @param {{ kind: string, article: string }} noun what each name is, as "app", with its article
 */
function checkName(name, names, { kind, article }) {
  if (name && names.includes(name)) return name;
  const named = name ? `There's no ${kind} named ${name}. ` : `Name ${article} ${kind}. `;
  throw new Error(`${named}The ${kind}s are: ${names.join(", ")}.`);
}

/**
 * The app a command names, or an error that lists the ones there are.
 * @param {string | undefined} app
 * @param {string[]} apps
 */
export const checkAppName = (app, apps = listApps()) =>
  checkName(app, apps, { kind: "app", article: "an" });

/**
 * The Worker a command names, an app's or a service's, or an error that lists the ones there are.
 * @param {string | undefined} worker
 * @param {string[]} workers
 */
export const checkWorkerName = (worker, workers = listWorkers()) =>
  checkName(worker, workers, { kind: "Worker", article: "a" });

// A command with a Worker named runs for that one, and with none, for them all.
/** @param {string | undefined} named */
export const listNamedWorkers = (named, workers = listWorkers()) =>
  named ? [checkWorkerName(named, workers)] : workers;

/**
 * For a command line: the Workers it names, or a clean message and a failed exit when it names
 * one there isn't.
 * @param {string | undefined} named
 * @param {{ workers?: string[], log?: (message: string) => void, exit?: (code: number) => void }} [options]
 * @returns {string[]}
 */
export function listWorkersOrExit(
  named,
  { workers = listWorkers(), log = console.error, exit = (code) => process.exit(code) } = {},
) {
  try {
    return listNamedWorkers(named, workers);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    exit(1);
    return [];
  }
}

/**
 * @param {string} app
 * @param {URL} [appsRoot] the folder that holds every app's
 */
export const findPageRoot = (app, appsRoot) =>
  fileURLToPath(new URL("page/", findAppRoot(app, appsRoot)));
