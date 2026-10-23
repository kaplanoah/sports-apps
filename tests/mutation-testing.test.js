import test from "node:test";
import assert from "node:assert/strict";
import config from "../stryker.config.mjs";
import { readRepoFile } from "./repo-files.js";

test("mutation testing changes exactly three shared page modules through Node's command runner", () => {
  assert.deepEqual(config.mutate, [
    "shared/page/search-reading.js",
    "shared/page/series-text.js",
    "shared/page/season-days.js",
  ]);
  assert.equal(config.testRunner, "command");
  assert.equal(config.coverageAnalysis, "off");
  assert.deepEqual(config.ignorePatterns, ["tsconfig.json"]);
  assert.equal(
    config.commandRunner.command,
    "node --import ./tests/no-network.js --test tests/game-search.test.js tests/series-text.test.js tests/season-days.test.js apps/mlb/tests/page.test.js apps/wnba/tests/page.test.js apps/wnba/tests/game-sheet.test.js",
  );
  const { scripts } = JSON.parse(readRepoFile("package.json"));
  assert.equal(scripts["test:mutation"], "stryker run");
});
