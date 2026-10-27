import { appendFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { listAppsWithBrowserTests } from "../../worker/apps.mjs";

export const WEBKIT_TEST_MATCH = ["at-rest.spec.mjs", "notification-layout.spec.mjs"];

/** @param {string} app */
export const nameWebKitProject = (app) => `${app}-webkit`;

/** @param {string} path */
export const isBrowserSpec = (path) => /^apps\/[^/]+\/tests\/browser\/.+\.spec\.mjs$/.test(path);

/** @param {{ project?: string, tests?: string }} selection */
export function listRequiredBrowsers({ project = "", tests = "" } = {}) {
  const apps = listAppsWithBrowserTests();
  if (apps.includes(project)) return ["chromium"];
  if (apps.some((app) => nameWebKitProject(app) === project)) return ["webkit"];
  if (project || !tests.trim()) return ["chromium", "webkit"];
  const paths = tests
    .trim()
    .split(/\s+/)
    .map((path) => path.replace(/:\d+(?::\d+)?$/, ""));
  const onlyChromium = paths.every(
    (path) =>
      isBrowserSpec(path) &&
      !/[*+?^${}()|[\]\\]/.test(path) &&
      existsSync(new URL(`../../${path}`, import.meta.url)) &&
      !WEBKIT_TEST_MATCH.includes(basename(path)),
  );
  return onlyChromium ? ["chromium"] : ["chromium", "webkit"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browsers = listRequiredBrowsers({ project: process.env.PROJECT, tests: process.env.TESTS });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required to publish the selected browsers.");
  appendFileSync(outputPath, `browsers=${browsers.join(" ")}\n`);
}
