import { appendFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { listAppsWithBrowserTests } from "./apps.mjs";

export const WEBKIT_TEST_MATCH = "at-rest.spec.mjs";

/** @param {{ project?: string, tests?: string }} selection */
export function listRequiredBrowsers({ project = "", tests = "" } = {}) {
  const apps = listAppsWithBrowserTests();
  if (apps.includes(project)) return ["chromium"];
  if (apps.some((app) => `${app}-webkit` === project)) return ["webkit"];
  if (project || !tests.trim()) return ["chromium", "webkit"];
  const paths = tests
    .trim()
    .split(/\s+/)
    .map((path) => path.replace(/:\d+(?::\d+)?$/, ""));
  const onlyChromium = paths.every(
    (path) =>
      /^apps\/[a-z-]+\/tests\/browser\/[\w/.-]+\.spec\.mjs$/.test(path) &&
      existsSync(new URL(`../${path}`, import.meta.url)) &&
      basename(path) !== WEBKIT_TEST_MATCH,
  );
  return onlyChromium ? ["chromium"] : ["chromium", "webkit"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browsers = listRequiredBrowsers({ project: process.env.PROJECT, tests: process.env.TESTS });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required to publish the selected browsers.");
  appendFileSync(outputPath, `browsers=${browsers.join(" ")}\n`);
}
