import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);

/**
 * Every file git tracks, by its path from the repo's root.
 * @returns {string[]}
 */
export const listTrackedFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/**
 * A file's text, by its path from the repo's root.
 * @param {string} path
 */
export const readRepoFile = (path) => readFileSync(new URL(path, ROOT), "utf8");

/**
 * The name of the skill a path holds, or none when it holds no skill.
 * @param {string} path
 */
export const readSkillName = (path) => path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
