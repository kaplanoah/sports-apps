import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ESLint } from "eslint";
import config from "../stryker.config.mjs";
import { buildMutationTestArgs, listMutationTests } from "../worker/mutation-tests.mjs";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

test("mutation testing changes exactly three shared page modules through Node's command runner", () => {
  assert.deepEqual(config.mutate, [
    "shared/page/search-reading.js",
    "shared/page/series-text.js",
    "shared/page/season-days.js",
  ]);
  assert.equal(config.testRunner, "command");
  assert.equal(config.coverageAnalysis, "off");
  assert.deepEqual(config.ignorePatterns, ["tsconfig.json"]);
  assert.equal(config.commandRunner.command, "node worker/mutation-tests.mjs");
  assert.equal(Object.hasOwn(config, "thresholds"), false);
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  assert.equal(scripts["test:mutation"], "stryker run");
});

test("mutation discovery follows shared, transitive, cyclic, and dynamic imports for future tests", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "mutation-tests-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const files = {
    "shared/page/target.js": "export const value = 1;",
    "tests/direct.test.js": 'import "../shared/page/target.js";',
    "tests/helper.js": 'export { value } from "#shared/target.js"; import "./cycle.js";',
    "tests/cycle.js": 'import "./helper.js";',
    "apps/future/tests/new.test.js": 'import "../../../tests/helper.js";',
    "services/future/tests/new.test.js": 'await import("../../../tests/cycle.js");',
    "tests/unrelated.test.js": 'import "node:assert"; import "./missing.js";',
    "apps/future/tests/browser/not-node.test.js": 'import "../../../../tests/helper.js";',
  };
  for (const [path, source] of Object.entries(files)) {
    const file = join(folder, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const root = pathToFileURL(`${folder}/`);
  const modules = ["shared/page/target.js"];
  assert.deepEqual(listMutationTests(modules, root), [
    "apps/future/tests/new.test.js",
    "services/future/tests/new.test.js",
    "tests/direct.test.js",
  ]);
  writeFileSync(join(folder, "tests/later.test.js"), 'import "./helper.js";');
  assert.ok(listMutationTests(modules, root).includes("tests/later.test.js"));
  assert.deepEqual(listMutationTests(["shared/page/unreached.js"], root), []);
});

test("mutation discovery includes both typing sweeps and the focused module tests", () => {
  const tests = listMutationTests(config.mutate);
  for (const file of [
    "apps/mlb/tests/search-typing.test.js",
    "apps/wnba/tests/search-typing.test.js",
    "apps/mlb/tests/page.test.js",
    "apps/wnba/tests/page.test.js",
    "apps/wnba/tests/game-sheet.test.js",
    "tests/game-search.test.js",
    "tests/series-text.test.js",
    "tests/season-days.test.js",
  ]) {
    assert.ok(tests.includes(file), file);
  }
  assert.ok(!tests.includes("tests/mutation-testing.test.js"));
});

test("mutation runner passes discovered paths as arguments and refuses an empty full-suite fallback", () => {
  const tests = ["tests/one.test.js", "apps/future/tests/two words.test.js"];
  assert.deepEqual(buildMutationTestArgs(tests), [
    "--import",
    "./tests/no-network.js",
    "--test",
    ...tests,
  ]);
  assert.throws(() => buildMutationTestArgs([]), /No Node tests reach the mutated modules/);
});

test("ESLint ignores abandoned mutation sandboxes while still linting normal source", async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(REPO_ROOT) });
  assert.equal(await eslint.isPathIgnored(".stryker-tmp/sandbox123/shared/page/example.js"), true);
  assert.equal(await eslint.isPathIgnored("shared/page/search-reading.js"), false);
  const [result] = await eslint.lintText("notDefined();", {
    filePath: "shared/page/search-reading.js",
  });
  assert.ok(result.messages.some(({ ruleId }) => ruleId === "no-undef"));
});
