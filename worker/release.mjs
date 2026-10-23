// Names each Worker's releases, an app's or a service's, with semantic versions. Each squash
// merge's title starts with a type that says how far it moves the version, so main's history alone
// gives every commit's version: no tags, and nothing written back to the repo. A merge that changes
// nothing a Worker's deploy counts, such as only its tests or other Workers' folders, leaves that
// Worker's version where it was, so its version moves only for a merge that would deploy it. A
// major change counts for every Worker the merge deploys, unless its title names the one Worker it
// breaks, as in feat(mlb)!:.
import { findWorkerFolder, listWorkers } from "./apps.mjs";
import { findDeployedChanges } from "./deploy-scope.mjs";

// Each Worker's version at the commit its count starts from, so a change to how merges count never
// moves a version that already shipped. A Worker not listed counts from FIRST_VERSION at the merge
// that added its folder.
const BASELINES = {
  mlb: { commit: "3cf716ccf7c056c3e598a7e4ce82c0c591ac210c", version: "2.32.2" },
  wnba: { commit: "3cf716ccf7c056c3e598a7e4ce82c0c591ac210c", version: "1.14.1" },
};
const FIRST_VERSION = "1.0.0";
export const RECORD_SEPARATOR = "\x1e";

/** @typedef {"major" | "minor" | "patch" | null} Bump */

/** @type {Record<string, Bump>} */
const BUMPS = {
  feat: "minor",
  fix: "patch",
  refactor: "patch",
  build: "patch",
  docs: null,
  test: null,
  ci: null,
  chore: null,
};

const TITLE_PATTERN = /^([a-z]+)(?:\(([a-z0-9-]+)\))?(!?): \S/;

/** @param {string} type */
const isReleasingType = (type) => BUMPS[type] !== null;

/** @param {boolean} isReleasing */
const listTypes = (isReleasing) =>
  Object.keys(BUMPS)
    .filter((type) => isReleasingType(type) === isReleasing)
    .map((type) => `${type}:`)
    .join(", ");

/** @typedef {{ type: string, scope: string | undefined, isBreaking: boolean }} TitleType */

/**
 * @param {string} title
 * @returns {TitleType | null} null when the title has no known type
 */
export function readTitleType(title) {
  const [, type, scope, breakingMark] = title.match(TITLE_PATTERN) ?? [];
  if (!type || !Object.hasOwn(BUMPS, type)) return null;
  return { type, scope, isBreaking: breakingMark === "!" };
}

/**
 * What's wrong with the Worker a major change names, or null when nothing is.
 * @param {TitleType} titleType
 * @param {string[]} changedFiles
 * @param {string[]} workers
 */
function findScopeProblem({ scope, isBreaking }, changedFiles, workers) {
  if (!scope) return null;
  if (!isBreaking)
    return `A scope only names the one Worker a major change breaks, as in feat(${workers[0]})!:. Drop (${scope}).`;
  if (!workers.includes(scope))
    return `There's no Worker named ${scope}. The Workers are: ${workers.join(", ")}.`;
  if (!findDeployedChanges(changedFiles, scope).length)
    return `This doesn't change what ${scope}'s deploy runs, so it can't break ${scope}.`;
  return null;
}

/**
 * What's wrong with a type that doesn't release, or null when nothing is. It may only change what
 * the deploy skips, so every deploy carries a new version.
 * @param {TitleType} titleType
 * @param {string[]} changedFiles
 */
function findTypeProblem({ type, isBreaking }, changedFiles) {
  if (isReleasingType(type)) return null;
  if (isBreaking)
    return `${type}: doesn't release, so it can't mark a major change. Drop the !, or use ${listTypes(true)}.`;
  const deployed = findDeployedChanges(changedFiles);
  if (deployed.length)
    return `${type}: doesn't release, but this changes what the Worker runs: ${deployed.join(", ")}. Use ${listTypes(true)}.`;
  return null;
}

/**
 * Says what's wrong with a pull request's title, or null when nothing is.
 * @param {string} title
 * @param {string[]} changedFiles
 * @param {string[]} [workers]
 */
export function findTitleProblem(title, changedFiles, workers = listWorkers()) {
  const titleType = readTitleType(title);
  if (!titleType)
    return `Start the title with a type: ${listTypes(true)}, ${listTypes(false)}. A ! after the type, as in feat!:, marks a major change.`;
  return (
    findTypeProblem(titleType, changedFiles) ?? findScopeProblem(titleType, changedFiles, workers)
  );
}

/**
 * @param {string} version
 * @param {Bump} bump
 */
function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return version;
}

// A title without a known type still shipped something, so it counts as a fix.
/**
 * @param {string} subject
 * @param {string} worker
 * @returns {Bump}
 */
function readBump(subject, worker) {
  const titleType = readTitleType(subject);
  if (!titleType) return "patch";
  const { type, scope, isBreaking } = titleType;
  const isBreakingWorker = isBreaking && (!scope || scope === worker);
  return isBreakingWorker ? "major" : BUMPS[type];
}

/**
 * @param {string} worker
 * @param {(args: string[]) => string} git
 * @param {URL} [servicesRoot]
 */
function findBaseline(worker, git, servicesRoot) {
  if (BASELINES[worker]) return BASELINES[worker];
  const [commit] = git([
    "log",
    "--first-parent",
    "--reverse",
    "--format=%H",
    "--",
    findWorkerFolder(worker, servicesRoot),
  ])
    .split("\n")
    .filter(Boolean);
  return commit ? { commit, version: FIRST_VERSION } : null;
}

/** @param {string} log each merge's subject, then the files it changed */
const readMerges = (log) =>
  log
    .split(RECORD_SEPARATOR)
    .filter((record) => record.trim())
    .map((record) => {
      const [subject, ...files] = record.split("\n").filter(Boolean);
      return { subject, files };
    });

// Without --diff-merges=first-parent, older Git lists no files for a merge commit; without
// --no-renames, a file moved out of an app's page/ lists only where it went.
/**
 * The Worker's version at HEAD, from the merges on main's first-parent history since its baseline
 * that change what the Worker's deploy counts, or at the commit `head` names.
 * @param {string} worker
 * @param {(args: string[]) => string} git
 * @param {{ head?: string, servicesRoot?: URL }} [options] the commit to read the version at, and
 *   the folder that holds every service's
 * @returns {string | null} null when HEAD's history doesn't reach the baseline
 */
export function readVersion(worker, git, { head = "HEAD", servicesRoot } = {}) {
  let baseline;
  let log;
  try {
    baseline = findBaseline(worker, git, servicesRoot);
    if (!baseline) return null;
    git(["merge-base", "--is-ancestor", baseline.commit, head]);
    log = git([
      "log",
      "--first-parent",
      "--reverse",
      `--format=${RECORD_SEPARATOR}%s`,
      "--name-only",
      "--diff-merges=first-parent",
      "--no-renames",
      `${baseline.commit}..${head}`,
    ]);
  } catch {
    return null;
  }
  return readMerges(log)
    .filter(({ files }) => findDeployedChanges(files, worker).length > 0)
    .reduce(
      (version, { subject }) => bumpVersion(version, readBump(subject, worker)),
      baseline.version,
    );
}
