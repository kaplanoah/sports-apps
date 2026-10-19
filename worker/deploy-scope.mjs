// Decides whether main needs a deploy. Only when nothing but the docs, tests, and tooling listed
// here changed since the live version does it skip one, so a new kind of file deploys until it
// is listed. An app's own folder deploys only that app; anything outside apps/ deploys them all.
// What the deploy runs, .github/workflows/deploy.yml and each script it runs and each module
// those import, like worker/check-page.mjs, isn't listed: only a deploy shows that a change to
// how the apps deploy still works.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// What only configures the repository's checks, or what nothing runs, like the license, which
// neither a deploy nor a browser test needs.
export const CONFIG_ONLY_FILES = new Set([
  "LICENSE",
  ".git-blame-ignore-revs",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "knip.json",
  "tsconfig.json",
]);
const SKIPPED_FILES = new Set([
  ...CONFIG_ONLY_FILES,
  ".claude/hooks/one-command.mjs",
  ".claude/settings.json",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/conflicts.yml",
  ".github/workflows/flaky.yml",
  ".github/workflows/review-area.yml",
  ".github/workflows/watch.yml",
  "playwright.config.mjs",
  "types/globals.d.ts",
  "worker/browser-scope.mjs",
  "worker/burn-in-specs.mjs",
  "worker/check-pr-title.mjs",
  "worker/flag-conflicts.mjs",
  "worker/judge-burn-in.mjs",
  "worker/judge-review.mjs",
  "worker/package-imports.mjs",
  "worker/plan-review.mjs",
  "worker/post-review.mjs",
  "worker/red-change.mjs",
  "worker/red-change-styles.mjs",
  "worker/report-flaky-tests.mjs",
  "worker/review-context.mjs",
  "worker/review-state.mjs",
  "worker/rollback.mjs",
  "worker/set-access-code.mjs",
  "worker/set-app-key.mjs",
  "worker/set-page-host.mjs",
  "worker/wait-for-review.mjs",
  "worker/watch-apps.mjs",
  "worker/worker-secrets.mjs",
]);
const TEST_FOLDERS = [/^tests\//, /^apps\/[^/]+\/tests\//];

/**
 * Whether a path is in the root's tests or an app's.
 * @param {string} path
 */
export const isTestPath = (path) => TEST_FOLDERS.some((folder) => folder.test(path));

/**
 * Whether a path is a document, which nothing runs.
 * @param {string} path
 */
export const isDocument = (path) => path.endsWith(".md");

/** @param {string} path */
const isSkipped = (path) => isDocument(path) || SKIPPED_FILES.has(path) || isTestPath(path);

/**
 * The app whose folder a path is in, or null for a path outside every app's.
 * @param {string} path
 */
export const readAppFolder = (path) => path.match(/^apps\/([^/]+)\//)?.[1] ?? null;

/**
 * @param {string} path
 * @param {string} [app] with none, whether the path deploys any app
 */
const isForApp = (path, app) => {
  const folder = readAppFolder(path);
  return !app || !folder || folder === app;
};

/**
 * @param {string[]} paths
 * @param {string} [app]
 */
export const findDeployedChanges = (paths, app) =>
  paths.filter((path) => !isSkipped(path) && isForApp(path, app));

const root = fileURLToPath(new URL("../", import.meta.url));
const runGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Without --no-renames, a file moved out of an app's page/ would list only where it went.
/** @param {string} since the live version's commit */
export function listChangedFiles(since, git = runGit) {
  try {
    return git(["diff", "--name-only", "--no-renames", since, "HEAD"]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * @param {string[] | null} changedFiles null when they couldn't be listed
 * @param {string} [app]
 */
export function decideDeploy(changedFiles, app) {
  if (changedFiles === null)
    return {
      isNeeded: true,
      reason: "Couldn't list the changes since the live version, so deploying.",
    };
  const deployed = findDeployedChanges(changedFiles, app);
  if (deployed.length) return { isNeeded: true, reason: `Deploying for ${deployed.join(", ")}.` };
  return {
    isNeeded: false,
    reason: `Nothing the Worker runs changed since the live version, so nothing was deployed. Changed: ${changedFiles.join(", ") || "none"}.`,
  };
}
