// Decides which apps' browser tests a change needs. A file the browser tests can't reach needs
// none: the docs, the other workflows, and the tooling and Node tests that no browser spec, helper,
// or the Playwright config imports. A file in an app's own folder needs that app's. Anything else
// needs every app's, so a new kind of file runs them all until it's known.
// Usage: git diff --name-only --no-renames <base> <head> | node worker/browser-scope.mjs, which
// writes the apps to $GITHUB_OUTPUT as apps=<app> <app>.
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { listApps } from "./apps.mjs";

const UNTESTED_FILES = new Set([
  "LICENSE",
  ".git-blame-ignore-revs",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "knip.json",
  "tsconfig.json",
]);
// CI's own workflow runs the browser tests, so a change to it runs them to show they still do.
const UNTESTED_FOLDERS = [/^\.claude\//, /^\.github\/(?!workflows\/ci\.yml$)/, /^types\//];
// Code here reaches the browser tests only by import, which the reached files list.
const IMPORTED_ONLY = [
  /^worker\/[^/]+\.mjs$/,
  /^tests\/.+\.m?js$/,
  /^apps\/[^/]+\/tests\/[^/]+\.test\.js$/,
];
const BROWSER_TEST_FOLDERS = [
  "tests/browser",
  ...listApps().map((app) => `apps/${app}/tests/browser`),
];
const IMPORT = /(?:\bfrom|\bimport\()\s*["']([^"']+)["']/g;

/**
 * Where an import names, from the repo's root, or null for a package's.
 * @param {string} specifier
 * @param {string} importer
 */
export function resolveImport(specifier, importer) {
  if (specifier.startsWith(".")) return posix.join(posix.dirname(importer), specifier);
  if (specifier.startsWith("#shared/")) return `shared/page/${specifier.slice("#shared/".length)}`;
  if (specifier.startsWith("#page-files/"))
    return `apps/${specifier.slice("#page-files/".length)}/worker/page-files.mjs`;
  return null;
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

/**
 * @param {string} path
 * @param {Set<string>} reached
 */
const isUntested = (path, reached) =>
  path.endsWith(".md") ||
  UNTESTED_FILES.has(path) ||
  UNTESTED_FOLDERS.some((folder) => folder.test(path)) ||
  (IMPORTED_ONLY.some((pattern) => pattern.test(path)) && !reached.has(path));

/**
 * The apps whose browser tests the changed files need, in order.
 * @param {string[]} paths
 * @param {{ apps: string[], reached: Set<string> }} repo
 */
export function listTestedApps(paths, { apps, reached }) {
  const tested = new Set();
  for (const path of paths.filter((changed) => !isUntested(changed, reached))) {
    const app = path.match(/^apps\/([^/]+)\//)?.[1];
    for (const each of app && apps.includes(app) ? [app] : apps) tested.add(each);
  }
  return apps.filter((app) => tested.has(app));
}

const root = fileURLToPath(new URL("../", import.meta.url));

/** @param {string} path from the repo's root */
const readRepoText = (path) => {
  const file = join(root, path);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
};

const listBrowserTestFiles = () =>
  BROWSER_TEST_FOLDERS.flatMap((folder) =>
    existsSync(join(root, folder))
      ? readdirSync(join(root, folder), { recursive: true, encoding: "utf8" })
          .filter((path) => /\.m?js$/.test(path))
          .map((path) => posix.join(folder, path))
      : [],
  );

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const reached = listReachedFiles(
    ["playwright.config.mjs", ...listBrowserTestFiles()],
    readRepoText,
  );
  const apps = listTestedApps(paths, { apps: listApps(), reached });
  console.log(
    apps.length
      ? `Browser tests for ${apps.join(" and ")}.`
      : "No browser test reaches what changed, so none runs.",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `apps=${apps.join(" ")}\n`);
}
