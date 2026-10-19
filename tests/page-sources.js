import { readdirSync } from "node:fs";
import { listApps } from "../worker/apps.mjs";

const ROOT = new URL("../", import.meta.url);

/**
 * Every file the pages are built from, shared and each app's, whose name ends in one of
 * `extensions`, as a path from the repository's root.
 * @param {string[]} extensions like ".js"
 */
export const listPageSources = (extensions) =>
  ["shared/page", ...listApps().map((app) => `apps/${app}/page`)].flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, ROOT), { recursive: true, encoding: "utf8" })
      .filter((name) => extensions.some((extension) => name.endsWith(extension)))
      .map((name) => `${folder}/${name}`),
  );
