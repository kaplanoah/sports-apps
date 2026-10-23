// Decides which apps' browser tests a change needs. A file the browser tests can't reach needs
// none: the docs, the root's .claude/ settings, hooks, rules, and skills, the other workflows,
// the files that only configure the checks, and the tooling and Node tests that no browser
// spec, helper, or the Playwright config imports. Browser setup files run every app's tests. A file in an
// app's own folder needs that app's, if it has any. Anything else needs every app's, a service's
// folder too, since every app binds every service, and a new kind of file runs them all until
// it's known.
// Usage: git diff --name-only --no-renames <base> <head> | node worker/browser-scope.mjs, which
// writes the apps to $GITHUB_OUTPUT as apps=<app> <app>.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { listAppsWithBrowserTests } from "./apps.mjs";
import { CONFIG_ONLY_FILES, isDocument, isSessionPath } from "./deploy-scope.mjs";
import { CI_WORKFLOW } from "./find-passed-ci.mjs";
import { resolvePackageImport } from "./package-imports.mjs";

const UNTESTED_FOLDERS = [/^\.github\//, /^types\//];
// Code here reaches the browser tests only by import, which the reached files list.
const IMPORTED_ONLY = [
  /^worker\/[^/]+\.mjs$/,
  /^tests\/.+\.m?js$/,
  /^(?:apps|services)\/[^/]+\/tests\/[^/]+\.test\.js$/,
];
// A static import, a re-export, a dynamic import, and an import for its side effects alone.
const IMPORT = /(?:\bfrom|\bimport\s*\(?)\s*["']([^"']+)["']/g;

/**
 * Where an import names, from the repo's root, or null for a package's.
 * @param {string} specifier
 * @param {string} importer
 */
export function resolveImport(specifier, importer) {
  if (specifier.startsWith(".")) return posix.join(posix.dirname(importer), specifier);
  return specifier.startsWith("#") ? resolvePackageImport(specifier) : null;
}

/**
 * Every file the entries reach by import, the entries too.
 * @param {string[]} entries
 * @param {(path: string) => string | null} readText null for a file that isn't there
 */
export function listReachedFiles(entries, readText) {
  const reached = new Set();
  const toRead = [...entries];
  while (toRead.length) {
    const path = String(toRead.pop());
    if (reached.has(path)) continue;
    const text = readText(path);
    if (text === null) continue;
    reached.add(path);
    for (const [, specifier] of text.matchAll(IMPORT)) {
      const target = resolveImport(specifier, path);
      if (target) toRead.push(target);
    }
  }
  return reached;
}

// Changes to how browsers install or run need the tests to show setup still works.
export const BROWSER_SETUP_FILES = new Set([CI_WORKFLOW, "worker/install-browsers.mjs"]);

/**
 * @param {string} path
 * @param {Set<string>} reached
 */
const isUntested = (path, reached) =>
  !BROWSER_SETUP_FILES.has(path) &&
  (isDocument(path) ||
    isSessionPath(path) ||
    CONFIG_ONLY_FILES.has(path) ||
    UNTESTED_FOLDERS.some((folder) => folder.test(path)) ||
    (IMPORTED_ONLY.some((pattern) => pattern.test(path)) && !reached.has(path)));

/** @param {string} path */
const readAppFolder = (path) => path.match(/^apps\/([^/]+)\//)?.[1] ?? null;

/**
 * The apps whose browser tests the changed files need, in order.
 * @param {string[]} paths
 * @param {{ apps: string[], reached: Set<string> }} repo the apps with browser tests
 */
export function listTestedApps(paths, { apps, reached }) {
  const tested = new Set();
  for (const path of paths.filter((changed) => !isUntested(changed, reached))) {
    const app = readAppFolder(path);
    for (const each of app ? [app] : apps) tested.add(each);
  }
  return apps.filter((app) => tested.has(app));
}

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * @param {string} path from the repo's root
 * @param {URL} [folder]
 */
export const readRepoText = (path, folder = new URL("../", import.meta.url)) => {
  const file = new URL(path, folder);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

/** Every script in the root's browser test helpers and each app's browser tests. */
const listBrowserTestFiles = () =>
  [
    "tests/browser",
    ...listAppsWithBrowserTests().map((app) => `apps/${app}/tests/browser`),
  ].flatMap((folder) =>
    readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })
      .filter((path) => /\.m?js$/.test(path))
      .map((path) => posix.join(folder, path)),
  );

/** Every file in the repo that the browser specs, their helpers, or the Playwright config reach. */
export const listBrowserTestReach = () =>
  listReachedFiles(["playwright.config.mjs", ...listBrowserTestFiles()], readRepoText);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const apps = listTestedApps(paths, {
    apps: listAppsWithBrowserTests(),
    reached: listBrowserTestReach(),
  });
  console.log(
    apps.length
      ? `Browser tests for ${apps.join(" and ")}.`
      : "No browser test reaches what changed, so none runs.",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `apps=${apps.join(" ")}\n`);
}
