import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";

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
export const readRepoFile = (path) => {
  const file = new URL(path, REPO_ROOT);
  return lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file, "utf8");
};

/**
 * Whether a path is one of the PNG images or fonts the repo holds on purpose, which alone go
 * unread, so any other binary is read and checked.
 * @param {string} path
 */
export const isKeptBinary = (path) => /\.(?:png|woff2)$/.test(path);

/**
 * Every tracked file but the repo's PNG images and fonts, with its text.
 * @returns {{ path: string, text: string }[]}
 */
export const readTextFiles = () =>
  listTrackedFiles()
    .filter((path) => !isKeptBinary(path))
    .map((path) => ({ path, text: readRepoFile(path) }));

/**
 * The name of the skill a path holds, or none when it holds no skill.
 * @param {string} path
 */
export const readSkillName = (path) => path.match(/^\.agents\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
