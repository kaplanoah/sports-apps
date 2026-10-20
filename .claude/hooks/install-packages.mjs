// Installs the repo's packages as a session starts, since a fresh clone has none and AGENTS.md's
// checks need them. npm writes node_modules/.package-lock.json on every install, so one older than
// package-lock.json means the lockfile changed since.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * When a file was last changed, in milliseconds, or null when it's missing.
 * @param {string} path
 */
const readModifiedTime = (path) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null;

/**
 * Whether a folder's packages need installing: it has a lockfile, and its node_modules is missing
 * or was installed before the lockfile last changed.
 * @param {string} folder
 */
export function isInstallNeeded(folder) {
  const lockfileTime = readModifiedTime(join(folder, "package-lock.json"));
  if (lockfileTime === null) return false;
  const installedTime = readModifiedTime(join(folder, "node_modules", ".package-lock.json"));
  return installedTime === null || installedTime < lockfileTime;
}

/** Runs `npm ci` in the project's folder when its packages need installing, and says so. */
function installPackages() {
  const folder = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  try {
    if (!isInstallNeeded(folder)) return;
    execFileSync("npm", ["ci"], { cwd: folder, stdio: "ignore" });
    process.stdout.write("Installed packages with npm ci, since node_modules was out of date.\n");
  } catch {
    // The hook never stops a session: any error lets it start.
    process.stdout.write("npm ci failed; run it before AGENTS.md's checks.\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) installPackages();
