import { spawnSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import config from "../stryker.config.mjs";
import { listReachedFiles } from "./browser-scope.mjs";

const root = new URL("../", import.meta.url);

/**
 * The Node test files that reach any mutated module, directly or through another import.
 * @param {string[]} modules paths from the repo's root
 * @param {URL} [folder]
 */
export function listMutationTests(modules, folder = root) {
  const targets = new Set(modules);
  const tests = globSync(
    ["tests/*.test.js", "apps/*/tests/*.test.js", "services/*/tests/*.test.js"],
    { cwd: folder },
  );
  const readText = (path) => {
    const file = new URL(path, folder);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  return tests
    .filter((path) =>
      [...listReachedFiles([path], readText)].some((reached) => targets.has(reached)),
    )
    .sort();
}

/** @param {string[]} tests */
export function buildMutationTestArgs(tests) {
  if (!tests.length) throw new Error("No Node tests reach the mutated modules.");
  return ["--import", "./tests/no-network.js", "--test", ...tests];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tests = listMutationTests(config.mutate);
  const result = spawnSync(process.execPath, buildMutationTestArgs(tests), {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
