// Makes the Git environment and runner CI's review uses, which inherit no credentials or executable
// Git configuration, and Git helpers that use that runner or one the caller passes.
import { execFileSync } from "node:child_process";
import { isGitObjectId } from "./git-object.mjs";

/** @param {NodeJS.ProcessEnv} [env] */
export function createReviewGitEnvironment(env = process.env) {
  const needsTrustedAttributes = env.REVIEW_BASE !== undefined || env.REVIEW_TRUSTED !== undefined;
  if (needsTrustedAttributes && !isGitObjectId(env.REVIEW_TRUSTED))
    throw new Error("Review attributes require an immutable trusted revision.");
  return {
    PATH: env.PATH,
    LANG: "C.UTF-8",
    HTTP_PROXY: env.HTTP_PROXY,
    HTTPS_PROXY: env.HTTPS_PROXY,
    ALL_PROXY: env.ALL_PROXY,
    NO_PROXY: env.NO_PROXY,
    http_proxy: env.http_proxy,
    https_proxy: env.https_proxy,
    all_proxy: env.all_proxy,
    no_proxy: env.no_proxy,
    SSL_CERT_FILE: env.SSL_CERT_FILE,
    SSL_CERT_DIR: env.SSL_CERT_DIR,
    GIT_SSL_CAINFO: env.GIT_SSL_CAINFO,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    ...(env.REVIEW_TRUSTED ? { GIT_ATTR_SOURCE: env.REVIEW_TRUSTED } : {}),
  };
}

/** @typedef {{ environment?: NodeJS.ProcessEnv, maxBuffer?: number }} ReviewGitOptions */

/** @overload @param {string} cwd @param {string[]} args @returns {string} */
/** @overload @param {string} cwd @param {string[]} args @param {"buffer"} encoding @param {ReviewGitOptions} [options] @returns {Buffer} */
/** @overload @param {string} cwd @param {string[]} args @param {"utf8"} encoding @param {ReviewGitOptions} [options] @returns {string} */
/** @param {string} cwd @param {string[]} args @param {"utf8" | "buffer"} [encoding] @param {ReviewGitOptions} [options] @returns {string | Buffer} */
export function readReviewGit(cwd, args, encoding = "utf8", options = {}) {
  const command = ["-c", "core.hooksPath=/dev/null", "-c", "core.quotePath=false", ...args];
  const settings = {
    cwd,
    env: createReviewGitEnvironment(options.environment),
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  };
  if (encoding === "buffer") return execFileSync("git", command, settings);
  return execFileSync("git", command, { ...settings, encoding: "utf8" });
}

/** @param {string} cwd @param {string[]} args @param {ReviewGitOptions} [options] */
export function runReviewGit(cwd, args, options = {}) {
  return readReviewGit(cwd, args, "utf8", {
    ...options,
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
  }).trim();
}

/**
 * Fetches a revision with all of its history, which a shallow checkout lacks for ancestry and
 * merge bases.
 * @param {string} cwd @param {string} revision @param {ReviewGitOptions} [options]
 */
export function fetchReviewHistory(cwd, revision, options = {}) {
  const shallow = runReviewGit(cwd, ["rev-parse", "--is-shallow-repository"], options);
  runReviewGit(
    cwd,
    ["fetch", "--no-tags", ...(shallow === "true" ? ["--unshallow"] : []), "origin", revision],
    options,
  );
}

/**
 * @param {string} cwd @param {string} ancestor @param {string} descendant
 * @param {ReviewGitOptions} [options]
 */
export function isReviewAncestor(cwd, ancestor, descendant, options = {}) {
  try {
    runReviewGit(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], options);
    return true;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 1) return false;
    throw error;
  }
}

/** @param {string} cwd @param {string} revision @param {ReviewGitOptions} [options] */
export function hasReviewCommit(cwd, revision, options = {}) {
  try {
    runReviewGit(cwd, ["cat-file", "-e", `${revision}^{commit}`], options);
    return true;
  } catch {
    return false;
  }
}

// git merge-tree's exit status when the merge conflicts, having still written the merged tree;
// any other failure is git's own error.
export const MERGE_TREE_CONFLICT = 1;

/**
 * The tree git makes merging two commits, or null when they conflict.
 * @param {(args: string[]) => string} readGit throws as execFileSync does where git exits with an error
 * @param {string} first @param {string} second
 */
export function readMergeTree(readGit, first, second) {
  try {
    return readGit([
      "-c",
      "merge.renormalize=false",
      "merge-tree",
      "--write-tree",
      first,
      second,
    ]).trim();
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === MERGE_TREE_CONFLICT) return null;
    throw error;
  }
}
