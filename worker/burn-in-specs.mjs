// Burn-in selects edited specs and those importing an edited helper that declares tests. Earlier
// successful runs are reused only while their specs and setup remain unchanged. Changes to
// imported helpers, dependencies, Node or browser setup invalidate that reuse. Page or Worker
// changes use ordinary browser and nightly checks because the test source already burned in.
// Usage: node worker/burn-in-specs.mjs, in a full checkout of the pull request's merge commit,
// with GH_TOKEN, GITHUB_REPOSITORY, and BRANCH (the pull request's head branch) set. It
// writes the specs to $GITHUB_OUTPUT as specs=<spec> <spec>.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_SETUP_FILES,
  listBrowserTestFiles,
  listBrowserTestReach,
  listReachedFiles,
  readRepoText,
} from "./browser-scope.mjs";
import { CI_WORKFLOW, isPullRequestRun } from "./find-passed-ci.mjs";
import { createGitHub, readAllPages } from "./github-api.mjs";
import { isBrowserSpec } from "../tests/browser/projects.mjs";
import { findTestLines } from "./browser-test-calls.mjs";

// What every spec runs with beyond what it imports: the dependencies, the Node version every job
// runs them on, and browser setup, which says how burn-in installs and runs each spec.
const RUN_SETUP = new Set(["package.json", "package-lock.json", ".nvmrc", ...BROWSER_SETUP_FILES]);
// What a spec tests rather than runs with.
const TESTED_CODE = /^(?:apps\/[^/]+\/(?:page|worker)|shared\/(?:page|worker))\//;
// A branch's last thirty completed runs reach past the label changes, cancelled runs, and pushes
// that burned nothing in since its last burn-in. Past those, every changed spec burns in again,
// which costs only time.
const RUNS_READ = 30;

/**
 * Whether a changed file is one every spec runs with: a helper or config the specs reach, a
 * dependency, the Node version, or browser setup.
 * @param {string} path
 * @param {Set<string>} reached every file the browser specs, their helpers, and the config reach
 */
const isSharedBySpecs = (path, reached) =>
  !isBrowserSpec(path) && (RUN_SETUP.has(path) || (reached.has(path) && !TESTED_CODE.test(path)));

/** @param {string} path @param {(path: string) => string | null} readText @param {Set<string>} browserFiles */
const declaresBrowserTests = (path, readText, browserFiles) =>
  !isBrowserSpec(path) && browserFiles.has(path) && findTestLines(readText(path) ?? "").length > 0;

/**
 * Changed specs and those importing a changed helper that declares tests, at any depth.
 * @param {string[]} paths
 * @param {{browserFiles: string[], readText: (path: string) => string | null}} options
 */
export function listBrowserSpecs(paths, { browserFiles, readText }) {
  const selected = new Set(paths.filter(isBrowserSpec));
  const inventory = new Set(browserFiles);
  const helpers = new Set(paths.filter((path) => declaresBrowserTests(path, readText, inventory)));
  if (helpers.size)
    for (const spec of browserFiles.filter(isBrowserSpec)) {
      const reached = listReachedFiles([spec], readText);
      if ([...helpers].some((helper) => reached.has(helper))) selected.add(spec);
    }
  return [...selected];
}

/**
 * @param {string[]} changedSpecs candidates selected from spec and test-declaring helper edits
 * @param {string[] | null} sinceBurnedIn the files changed since the last head that passed burn-in,
 *   or null with no such head
 * @param {Set<string>} reached every file the browser specs, their helpers, and the config reach
 */
export function listSpecsToBurnIn(changedSpecs, sinceBurnedIn, reached) {
  if (sinceBurnedIn === null || sinceBurnedIn.some((path) => isSharedBySpecs(path, reached)))
    return changedSpecs;
  return changedSpecs.filter((spec) => sinceBurnedIn.includes(spec));
}

/**
 * Whether a run's burn-in ran and every machine of it passed.
 * @param {{ name: string, conclusion: string | null }[]} jobs
 */
export const isBurnedIn = (jobs) => {
  const burnIn = jobs.filter((job) => job.name.startsWith("burn-in ("));
  return burnIn.length > 0 && burnIn.every((job) => job.conclusion === "success");
};

/**
 * The newest head of the branch, this one too, on which burn-in passed, or null when there's none
 * or GitHub couldn't say, which burns every changed spec in.
 * @param {object} options
 * @param {(path: string) => Promise<any>} options.readJson
 * @param {string} options.branch
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<string | null>}
 */
export async function findBurnedInHead({ readJson, branch, log = console.log }) {
  try {
    const { workflow_runs: runs } = await readJson(
      `/actions/workflows/${posix.basename(CI_WORKFLOW)}/runs?event=pull_request&status=completed&branch=${encodeURIComponent(branch)}&per_page=${RUNS_READ}`,
    );
    for (const run of runs.filter(isPullRequestRun)) {
      const jobs = await readAllPages(
        readJson,
        `/actions/runs/${run.id}/jobs`,
        (answer) => answer.jobs,
      );
      if (isBurnedIn(jobs)) return run.head_sha;
    }
    return null;
  } catch (error) {
    log(
      `::warning::Couldn't read the branch's earlier burn-ins, so every changed spec burns in: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** @param {string[]} args */
const runGit = (args) => execFileSync("git", args, { encoding: "utf8" });

/** @param {string} output */
const listLines = (output) => output.split("\n").filter(Boolean);

/**
 * The files changed from a commit to the pull request's head, and those its base changed since
 * that commit's base, since the merge commit burn-in runs on holds both, or null for a commit the
 * checkout doesn't hold, as after a force push.
 * @param {string} since
 * @param {(args: string[]) => string} [git]
 */
export function listChangedSince(since, git = runGit) {
  try {
    const sinceBase = git(["merge-base", since, "HEAD^1"]).trim();
    return [
      ...new Set([
        ...listLines(git(["diff", "--name-only", "--no-renames", since, "HEAD^2"])),
        ...listLines(git(["diff", "--name-only", "--no-renames", sinceBase, "HEAD^1"])),
      ]),
    ];
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const changedSpecs = listBrowserSpecs(
    listLines(
      runGit(["diff", "--name-only", "--no-renames", "--diff-filter=AM", "HEAD^1", "HEAD"]),
    ),
    { browserFiles: listBrowserTestFiles(), readText: readRepoText },
  );
  const readJson = createGitHub({
    repository: String(process.env.GITHUB_REPOSITORY),
    fetchImpl: fetch,
    env: process.env,
  });
  const burnedIn = changedSpecs.length
    ? await findBurnedInHead({ readJson, branch: String(process.env.BRANCH) })
    : null;
  const specs = listSpecsToBurnIn(
    changedSpecs,
    burnedIn && listChangedSince(burnedIn),
    listBrowserTestReach(),
  );
  const passed = changedSpecs.filter((spec) => !specs.includes(spec));
  console.log(
    passed.length
      ? `Passed burn-in on ${burnedIn} and unchanged since: ${passed.join(", ")}.`
      : "No selected spec has passed burn-in with its current inputs.",
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `specs=${specs.join(" ")}\n`);
}
