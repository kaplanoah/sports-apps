// Decides whether main needs a deploy. Only when nothing but the docs, tests, and tooling listed
// here changed since the live version does it skip one, so a new kind of file deploys until it
// is listed. A Worker's own folder, an app's or a service's, deploys only that Worker, but for a
// service's config, which deploys that service and every app, since each app's binding to it
// names it; anything outside them deploys them all.
// What the deploy runs, .github/workflows/deploy.yml and each script it runs and each module
// those import, like worker/check-page.mjs, isn't listed: only a deploy shows that a change to
// how the apps deploy still works. The beta claim's check is listed, since every push to beta
// runs it, whether or not a Worker deploys, and the production deploy never does.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isService } from "./apps.mjs";

// What only configures the repository's checks, or what nothing runs, like the license, which
// neither a deploy nor a browser test needs.
export const CONFIG_ONLY_FILES = new Set([
  "LICENSE",
  ".git-blame-ignore-revs",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "knip.json",
  "stryker.config.mjs",
  "tests/time-zone-sensitive.json",
  "tsconfig.json",
]);
const SKIPPED_FILES = new Set([
  ...CONFIG_ONLY_FILES,
  ".github/dependabot.yml",
  ".github/workflows/beta.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/conflicts.yml",
  ".github/workflows/flaky.yml",
  ".github/workflows/mutation.yml",
  ".github/workflows/publish-trusted-review.yml",
  ".github/workflows/red-approvals.yml",
  ".github/workflows/review.yml",
  ".github/workflows/trusted-review-area.yml",
  ".github/workflows/trusted-review-issuer-test.yml",
  ".github/workflows/trusted-review-lookalike-test.yml",
  ".github/workflows/trusted-codex-review.yml",
  ".github/workflows/trusted-review-publisher.yml",
  ".github/workflows/watch.yml",
  "playwright.config.mjs",
  "types/globals.d.ts",
  "worker/beta-claim.mjs",
  "worker/browser-scope.mjs",
  "worker/burn-in-specs.mjs",
  "worker/check-pr-title.mjs",
  "worker/find-trusted-review.mjs",
  "worker/flag-conflicts.mjs",
  "worker/judge-burn-in.mjs",
  "worker/judge-review.mjs",
  "worker/labeling.mjs",
  "worker/mutation-targets.mjs",
  "worker/mutation-tests.mjs",
  "worker/node-tests.mjs",
  "worker/package-imports.mjs",
  "worker/plan-review.mjs",
  "worker/post-review.mjs",
  "worker/publish-trusted-review.mjs",
  "worker/pull-merge.mjs",
  "worker/red-approval.mjs",
  "worker/red-change-styles.mjs",
  "worker/red-change.mjs",
  "worker/report-flaky-tests.mjs",
  "worker/review-artifact.mjs",
  "worker/review-context.mjs",
  "worker/review-codex.mjs",
  "worker/review-evaluation.mjs",
  "worker/review-provider.mjs",
  "worker/review-supplied.mjs",
  "worker/review-data.mjs",
  "worker/review-diagnostics.mjs",
  "worker/review-git.mjs",
  "worker/review-json.mjs",
  "worker/review-publication.mjs",
  "worker/review-repository.mjs",
  "worker/review-run.mjs",
  "worker/review-state.mjs",
  "worker/rework.mjs",
  "worker/rollback.mjs",
  "worker/rule-files.mjs",
  "worker/set-access-code.mjs",
  "worker/set-app-key.mjs",
  "worker/set-email-key.mjs",
  "worker/set-page-host.mjs",
  "worker/set-rp-id.mjs",
  "worker/test-time-zone.mjs",
  "worker/test-review-issuer.mjs",
  "worker/time-zone-scope.mjs",
  "worker/trusted-review.mjs",
  "worker/watch-apps.mjs",
  "worker/worker-secrets.mjs",
]);
const TEST_FOLDERS = [/^tests\//, /^(?:apps|services)\/[^/]+\/tests\//];

/**
 * Whether a path holds settings, hooks, rules, or skills that only sessions run.
 * @param {string} path
 */
export const isSessionPath = (path) => path.startsWith(".claude/");

/**
 * Whether a path is in the root's tests or a Worker's.
 * @param {string} path
 */
export const isTestPath = (path) => TEST_FOLDERS.some((folder) => folder.test(path));

/**
 * Whether a path is a document, which nothing runs.
 * @param {string} path
 */
export const isDocument = (path) => path.endsWith(".md");

/** @param {string} path */
const isSkipped = (path) =>
  isDocument(path) || SKIPPED_FILES.has(path) || isTestPath(path) || isSessionPath(path);

/**
 * The Worker whose folder a path is in, an app's or a service's, or null for a path outside every
 * Worker's.
 * @param {string} path
 */
const readWorkerFolder = (path) => path.match(/^(?:apps|services)\/([^/]+)\//)?.[1] ?? null;

// Adding, renaming, or removing a service changes the bindings every app uploads, and no other
// service's.
const SERVICE_CONFIG = /^services\/[^/]+\/worker\/wrangler\.toml$/;

/**
 * @param {string} path
 * @param {string} [worker] with none, whether the path deploys any Worker
 */
const isForWorker = (path, worker) => {
  const folder = readWorkerFolder(path);
  return (
    !worker || !folder || folder === worker || (SERVICE_CONFIG.test(path) && !isService(worker))
  );
};

/**
 * @param {string[]} paths
 * @param {string} [worker]
 */
export const findDeployedChanges = (paths, worker) =>
  paths.filter((path) => !isSkipped(path) && isForWorker(path, worker));

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
 * @param {string} [worker]
 */
export function decideDeploy(changedFiles, worker) {
  if (changedFiles === null)
    return {
      isNeeded: true,
      reason: "Couldn't list the changes since the live version, so deploying.",
    };
  const deployed = findDeployedChanges(changedFiles, worker);
  if (deployed.length) return { isNeeded: true, reason: `Deploying for ${deployed.join(", ")}.` };
  return {
    isNeeded: false,
    reason: `Nothing the Worker runs changed since the live version, so nothing was deployed. Changed: ${changedFiles.join(", ") || "none"}.`,
  };
}
