import { spawnSync } from "node:child_process";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { listReachedFiles, readRepoText } from "./browser-scope.mjs";
import { buildNodeTestArgs, listNodeTests } from "./node-tests.mjs";
import { readMutationTarget } from "./mutation-targets.mjs";

const root = new URL("../", import.meta.url);

/**
 * The Node test files that reach any mutated module, directly or through another import.
 * @param {string[]} modules paths from the repo's root
 * @param {URL} [folder]
 */
export function listMutationTests(modules, folder = root) {
  const targets = new Set(modules);
  const readText = (path) => readRepoText(path, folder);
  const tests = listNodeTests(folder);
  return tests
    .filter((path) =>
      [...listReachedFiles([path], readText)].some((reached) => targets.has(reached)),
    )
    .sort();
}

/** @param {string[]} tests */
export function buildMutationTestArgs(tests) {
  if (!tests.length) throw new Error("No Node tests reach the mutated modules.");
  return buildNodeTestArgs(tests);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: process.env.MUTATION_TARGET },
      root: { type: "string" },
    },
  });
  const target = readMutationTarget(values.target);
  const folder = values.root ? pathToFileURL(`${resolve(values.root)}${sep}`) : root;
  const tests = listMutationTests([target], folder);
  const result = spawnSync(process.execPath, buildMutationTestArgs(tests), {
    cwd: folder,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
