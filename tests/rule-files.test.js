import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RULES_FOLDER,
  isRuleFile,
  listRulesFor,
  matchesGlob,
  readRuleFiles,
  readRulePaths,
} from "../worker/rule-files.mjs";
import { listTrackedFiles } from "./tracked-files.js";

const ROOT = new URL("../", import.meta.url);

const repoFiles = listTrackedFiles();
const ruleFiles = repoFiles.filter(isRuleFile);

/** @param {string} path */
const readRule = (path) => readFileSync(new URL(path, ROOT), "utf8");

test("the repo holds rule files", () => {
  assert.ok(ruleFiles.length > 0);
});

// A rule file with no paths loads into every session, which AGENTS.md is for.
test("each rule file lists the paths it loads for", () => {
  const unscoped = ruleFiles.filter((path) => !readRulePaths(readRule(path)).length);
  assert.deepEqual(unscoped, []);
});

// An item the reader drops would leave its files without the rule in CI's review, though Claude
// Code loads it for them.
test("each item a rule file's frontmatter lists is read as a path", () => {
  const unread = ruleFiles.filter((path) => {
    const frontmatter = readRule(path).split("\n---\n")[0];
    const items = frontmatter.split("\n").filter((line) => /^\s+-/.test(line));
    return items.length !== readRulePaths(readRule(path)).length;
  });
  assert.deepEqual(unread, []);
});

// A glob that matches no file never loads its rules, as one left behind by a moved folder.
test("each rule file's paths each match a file in the repo", () => {
  const stale = ruleFiles.flatMap((path) =>
    readRulePaths(readRule(path))
      .filter((glob) => !repoFiles.some((file) => matchesGlob(file, glob)))
      .map((glob) => `${path}: ${glob}`),
  );
  assert.deepEqual(stale, []);
});

// A session learns from AGENTS.md where the rest of the guidance is before it opens a file.
test("AGENTS.md names each rule file and skill", () => {
  const agents = readRule("AGENTS.md");
  const skills = repoFiles.flatMap(
    (path) => path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)?.[1] ?? [],
  );
  const unnamed = [
    ...ruleFiles.filter((path) => !agents.includes(`\`${path.slice(RULES_FOLDER.length)}\``)),
    ...skills.filter((name) => !agents.includes(`\`${name}\` skill`)),
  ];
  assert.deepEqual(unnamed, []);
});

test("a rule file's paths are the items its frontmatter lists, quoted or not", () => {
  assert.deepEqual(
    readRulePaths(
      "---\npaths:\n  - \"apps/*/page/**\"\n  - 'shared/**'\n  - playwright.config.mjs\n---\n\n- A rule",
    ),
    ["apps/*/page/**", "shared/**", "playwright.config.mjs"],
  );
  assert.deepEqual(readRulePaths('---\r\npaths:\r\n  - "tests/**"\r\n---\r\n'), ["tests/**"]);
  assert.deepEqual(readRulePaths('# No frontmatter\n\n  - "apps/**"\n'), []);
});

test("a glob's ** matches across folders, or none before a slash, its * within one, and braces either, a comma or a stray } outside them being literal, and an unclosed { an error", () => {
  assert.ok(matchesGlob("apps/mlb/page/js/app.js", "apps/*/page/**"));
  assert.ok(!matchesGlob("apps/mlb/worker/src/index.js", "apps/*/page/**"));
  assert.ok(!matchesGlob("apps/mlb/extra/page/app.js", "apps/*/page/**"));
  assert.ok(matchesGlob("README.md", "**/*.md"));
  assert.ok(matchesGlob("apps/mlb/README.md", "**/*.md"));
  assert.ok(matchesGlob("apps/x.js", "apps/**/x.js"));
  assert.ok(matchesGlob("apps/mlb/page/x.js", "apps/**/x.js"));
  assert.ok(matchesGlob("worker/deploy.mjs", "worker/*.{js,mjs}"));
  assert.ok(!matchesGlob("worker/deploy.ts", "worker/*.{js,mjs}"));
  assert.ok(matchesGlob("playwright.config.mjs", "playwright.config.mjs"));
  assert.ok(!matchesGlob("playwrightXconfig.mjs", "playwright.config.mjs"));
  assert.ok(matchesGlob(".github/workflows/ci.yml", ".github/**"));
  assert.ok(matchesGlob("a,b.md", "a,b.md"));
  assert.ok(!matchesGlob("a/x.md", "a,b.md"));
  assert.ok(matchesGlob("a}b.md", "a}b.md"));
  assert.throws(() => matchesGlob("a.js", "a.{js"), /opens a brace it never closes/);
});

test("the repo's rule files are read with their text, and no other file is", () => {
  const files = [".claude/rules/page.md", "AGENTS.md", ".claude/skills/x/SKILL.md"];
  assert.deepEqual(
    readRuleFiles(files, (path) => `text of ${path}`),
    [{ path: ".claude/rules/page.md", text: "text of .claude/rules/page.md" }],
  );
});

test("an area's rules are those whose paths match any of its files", () => {
  const page = { name: "page", paths: ["shared/page/**"] };
  const tooling = { name: "tooling", paths: ["worker/**", ".github/**"] };
  assert.deepEqual(listRulesFor(["shared/page/sheet.js", "README.md"], [page, tooling]), [page]);
  assert.deepEqual(listRulesFor(["README.md"], [page, tooling]), []);
});
