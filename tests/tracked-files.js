import { execFileSync } from "node:child_process";

/**
 * Every file git tracks, by its path from the repo's root.
 * @returns {string[]}
 */
export const listTrackedFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: new URL("../", import.meta.url), encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
