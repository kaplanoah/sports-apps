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

// Git's own test for a binary file, like a font or an image: a NUL byte in its first 8000.
const isBinary = (/** @type {Buffer} */ bytes) => bytes.subarray(0, 8000).includes(0);

/**
 * Every tracked file that isn't binary, with its text.
 * @returns {{ path: string, text: string }[]}
 */
export const readTextFiles = () =>
  listTrackedFiles().flatMap((path) => {
    const bytes = readFileSync(new URL(path, REPO_ROOT));
    return isBinary(bytes) ? [] : [{ path, text: bytes.toString("utf8") }];
  });

/**
 * The name of the skill a path holds, or none when it holds no skill.
 * @param {string} path
 */
export const readSkillName = (path) => path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
