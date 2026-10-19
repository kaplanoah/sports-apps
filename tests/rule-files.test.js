import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isRuleFile, listRulesFor, matchesGlob, readRulePaths } from "../worker/rule-files.mjs";

const ROOT = new URL("../", import.meta.url);

const listRepoFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

const repoFiles = listRepoFiles();
const ruleFiles = repoFiles.filter(isRuleFile);

test("the repo holds rule files", () => {
  assert.ok(ruleFiles.length > 0);
});

// A rule file with no paths loads into every session, which AGENTS.md is for.
test("each rule file lists the paths it loads for", () => {
  const unscoped = ruleFiles.filter(
    (path) => !readRulePaths(readFileSync(new URL(path, ROOT), "utf8")).length,
  );
  assert.deepEqual(unscoped, []);
});

// A glob that matches no file never loads its rules, as one left behind by a moved folder.
test("each rule file's paths each match a file in the repo", () => {
  const stale = ruleFiles.flatMap((path) =>
    readRulePaths(readFileSync(new URL(path, ROOT), "utf8"))
      .filter((glob) => !repoFiles.some((file) => matchesGlob(file, glob)))
      .map((glob) => `${path}: ${glob}`),
  );
  assert.deepEqual(stale, []);
});

test("a rule file's paths are the quoted items its frontmatter lists", () => {
  assert.deepEqual(
    readRulePaths(
      '---\npaths:\n  - "apps/*/page/**"\n  - "playwright.config.mjs"\n---\n\n- A rule',
    ),
    ["apps/*/page/**", "playwright.config.mjs"],
  );
  assert.deepEqual(readRulePaths('# No frontmatter\n\n  - "apps/**"\n'), []);
});

test("a glob's ** matches across folders and its * within one", () => {
  assert.ok(matchesGlob("apps/mlb/page/js/app.js", "apps/*/page/**"));
  assert.ok(!matchesGlob("apps/mlb/worker/src/index.js", "apps/*/page/**"));
  assert.ok(!matchesGlob("apps/mlb/extra/page/app.js", "apps/*/page/**"));
  assert.ok(matchesGlob("playwright.config.mjs", "playwright.config.mjs"));
  assert.ok(!matchesGlob("playwrightXconfig.mjs", "playwright.config.mjs"));
  assert.ok(matchesGlob(".github/workflows/ci.yml", ".github/**"));
});

test("an area's rules are those whose paths match any of its files", () => {
  const page = { name: "page", paths: ["shared/page/**"] };
  const tooling = { name: "tooling", paths: ["worker/**", ".github/**"] };
  assert.deepEqual(listRulesFor(["shared/page/sheet.js", "README.md"], [page, tooling]), [page]);
  assert.deepEqual(listRulesFor(["README.md"], [page, tooling]), []);
});
