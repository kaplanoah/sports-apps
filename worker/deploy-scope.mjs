// Decides whether main needs a deploy. Only when nothing but the docs, tests, and tooling listed
// here changed since the live version does it skip one, so a new kind of file deploys until it
// is listed. An app's own folder deploys only that app; anything outside apps/ deploys them all.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKIPPED_FILES = new Set([
  "LICENSE",
  ".claude/hooks/one-command.mjs",
  ".claude/settings.json",
  ".git-blame-ignore-revs",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/conflicts.yml",
  ".github/workflows/flaky.yml",
  ".github/workflows/watch.yml",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "knip.json",
  "playwright.config.mjs",
  "tsconfig.json",
  "types/globals.d.ts",
  "worker/check-page.mjs",
  "worker/check-pr-title.mjs",
  "worker/find-passed-ci.mjs",
  "worker/flag-conflicts.mjs",
  "worker/github-api.mjs",
  "worker/judge-burn-in.mjs",
  "worker/judge-review.mjs",
  "worker/plan-review.mjs",
  "worker/red-change.mjs",
  "worker/report-flaky-tests.mjs",
  "worker/rollback.mjs",
  "worker/set-access-code.mjs",
  "worker/set-app-key.mjs",
  "worker/set-page-host.mjs",
  "worker/watch-apps.mjs",
  "worker/worker-secrets.mjs",
]);
const SKIPPED_FOLDERS = [/^tests\//, /^apps\/[^/]+\/tests\//];

const isSkipped = (path) =>
  path.endsWith(".md") ||
  SKIPPED_FILES.has(path) ||
  SKIPPED_FOLDERS.some((folder) => folder.test(path));

const readAppFolder = (path) => path.match(/^apps\/([^/]+)\//)?.[1] ?? null;

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
