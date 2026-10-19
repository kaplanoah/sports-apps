import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const REPO_ROOT = new URL("../", import.meta.url);

/**
 * Every file git tracks, by its path from the repo's root.
 * @returns {string[]}
 */
export const listTrackedFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

/**
 * A file's text, by its path from the repo's root.
 * @param {string} path
 */
export const readRepoFile = (path) => readFileSync(new URL(path, REPO_ROOT), "utf8");

// Only the PNG images and fonts the repo holds on purpose go unread, so the secrets check reads a
// binary of any other kind, and the plain-ASCII check fails on one outside the tests' folders.
const BINARY_FILES = /\.(?:png|woff2)$/;

/**
 * Every tracked file but the repo's PNG images and fonts, with its text.
 * @returns {{ path: string, text: string }[]}
 */
export const readTextFiles = () =>
  listTrackedFiles()
    .filter((path) => !BINARY_FILES.test(path))
    .map((path) => ({ path, text: readRepoFile(path) }));

/**
 * The name of the skill a path holds, or none when it holds no skill.
 * @param {string} path
 */
export const readSkillName = (path) => path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
