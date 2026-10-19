// Each league's app lives in apps/<name>/: its page, its Worker, and its tests.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APPS_ROOT = new URL("../apps/", import.meta.url);

/**
 * @param {string} app
 * @param {URL} [appsRoot] the folder that holds every app's
 */
export const findAppRoot = (app, appsRoot = APPS_ROOT) => new URL(`${app}/`, appsRoot);

// An app is a folder whose Worker has a wrangler.toml.
/** @param {URL} [appsRoot] the folder that holds every app's */
export const listApps = (appsRoot = APPS_ROOT) =>
  readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((app) => existsSync(new URL("worker/wrangler.toml", findAppRoot(app, appsRoot))))
    .sort();

// The apps with browser tests, each of which Playwright runs as its own project.
/** @param {URL} [appsRoot] the folder that holds every app's */
export const listAppsWithBrowserTests = (appsRoot = APPS_ROOT) =>
  listApps(appsRoot).filter((app) =>
    existsSync(new URL("tests/browser/", findAppRoot(app, appsRoot))),
  );

/**
 * The app a command names, or an error that lists the ones there are.
 * @param {string | undefined} app
 * @param {string[]} apps
 */
export function checkAppName(app, apps = listApps()) {
  if (app && apps.includes(app)) return app;
  const named = app ? `There's no app named ${app}. ` : "Name an app. ";
  throw new Error(`${named}The apps are: ${apps.join(", ")}.`);
}

// A command with an app named runs for that one, and with none, for them all.
/** @param {string | undefined} named */
export const listNamedApps = (named, apps = listApps()) =>
  named ? [checkAppName(named, apps)] : apps;

/**
 * For a command line: the apps it names, or a clean message and a failed exit when it names one
 * there isn't.
 * @param {string | undefined} named
 * @param {{ apps?: string[], log?: (message: string) => void, exit?: (code: number) => void }} [options]
 * @returns {string[]}
 */
export function listAppsOrExit(
  named,
  { apps = listApps(), log = console.error, exit = (code) => process.exit(code) } = {},
) {
  try {
    return listNamedApps(named, apps);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    exit(1);
    return [];
  }
}

/** @param {string} app */
export const findPageRoot = (app) => fileURLToPath(new URL("page/", findAppRoot(app)));
