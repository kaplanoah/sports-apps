import test from "node:test";
import assert from "node:assert/strict";
import { decideDeploy, findDeployedChanges, listChangedFiles } from "../worker/deploy-scope.mjs";
import { readRepoFile } from "./repo-files.js";

/**
 * The root worker/ modules a script imports, and the ones they import, with the script.
 * @param {string} script
 */
function listImported(script) {
  const found = [script];
  for (const path of found)
    for (const [, name] of readRepoFile(path).matchAll(/from "\.\/([\w-]+\.mjs)"/g))
      if (!found.includes(`worker/${name}`)) found.push(`worker/${name}`);
  return found;
}

// Every push to beta runs the claim's check whether or not a Worker deploys, and the production
// deploy never does, so a change to it needs no deploy to show it works.
const BETA_CLAIM_CHECK = "worker/beta-claim.mjs";

test("every script the deploy runs, and every module those import, deploys when it changes, but the beta claim's check", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const scripts = [...workflow.matchAll(/node (worker\/[\w-]+\.mjs)/g)]
    .map(([, path]) => path)
    .filter((path) => path !== BETA_CLAIM_CHECK);
  assert.ok(scripts.includes("worker/deploy.mjs"));
  assert.match(
    workflow,
    /if: env\.CHANNEL == 'beta'\n.*\n.*\n\s+run: node worker\/beta-claim\.mjs/,
  );
  assert.equal(decideDeploy([BETA_CLAIM_CHECK, "worker/labeling.mjs"]).isNeeded, false);
  const run = [".github/workflows/deploy.yml", ...new Set(scripts.flatMap(listImported))];
  assert.deepEqual(
    run.filter((path) => !findDeployedChanges([path]).length),
    [],
  );
});

test("a merge of only docs, tests, and tooling skips the deploy", () => {
  const decision = decideDeploy([
    "AGENTS.md",
    "README.md",
    "tests/deploy.test.js",
    "apps/mlb/tests/store.test.js",
    "apps/mlb/tests/browser/page.spec.mjs",
    ".claude/hooks/context-limit.mjs",
    ".claude/settings.json",
    ".github/workflows/beta.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/flaky.yml",
    ".github/workflows/review-area.yml",
    "eslint.config.mjs",
    "worker/browser-scope.mjs",
    "worker/burn-in-specs.mjs",
    "worker/package-imports.mjs",
    "worker/red-change.mjs",
    "worker/red-change-styles.mjs",
    "worker/post-review.mjs",
    "worker/report-flaky-tests.mjs",
    "worker/review-context.mjs",
    "worker/review-state.mjs",
    "worker/rule-files.mjs",
    "worker/set-app-key.mjs",
    ".claude/rules/page-look.md",
    ".claude/skills/add-league/SKILL.md",
  ]);
  assert.equal(decision.isNeeded, false);
  assert.match(
    decision.reason,
    /^Nothing the Worker runs changed since the live version, so nothing was deployed\./,
  );
  assert.match(decision.reason, /AGENTS\.md, README\.md/);
});

test("anything in the root's .claude/ folder skips the deploy, a hook no list names too", () => {
  for (const path of [
    ".claude/settings.json",
    ".claude/hooks/one-command.mjs",
    ".claude/hooks/install-packages.mjs",
    ".claude/hooks/a-hook-yet-to-come.mjs",
    ".claude/skills/ship/SKILL.md",
  ]) {
    assert.equal(decideDeploy([path]).isNeeded, false, path);
  }
  assert.equal(decideDeploy(["shared/page/.claude/hooks/a-hook.mjs"]).isNeeded, true);
});

test("a merge that changes what the Worker runs, or how it deploys, deploys", () => {
  for (const path of [
    "apps/mlb/page/js/app.js",
    "apps/mlb/page/styles.css",
    "apps/mlb/worker/src/store.js",
    "apps/mlb/worker/wrangler.toml",
    "worker/apps.mjs",
    "worker/build.mjs",
    "worker/deploy.mjs",
    "worker/check-page.mjs",
    "worker/find-passed-ci.mjs",
    "worker/github-api.mjs",
    "package-lock.json",
    ".nvmrc",
    ".github/workflows/deploy.yml",
  ]) {
    assert.equal(decideDeploy([path]).isNeeded, true, path);
  }
});

test("a file no list names deploys, and the reason names only what deploys", () => {
  const decision = decideDeploy(["README.md", "shared/clubs.js", "apps/mlb/page/js/app.js"]);
  assert.equal(decision.isNeeded, true);
  assert.equal(decision.reason, "Deploying for shared/clubs.js, apps/mlb/page/js/app.js.");
});

test("a change in one app's folder deploys that app, and a change outside apps/ deploys them all", () => {
  const wnbaChange = ["apps/wnba/page/js/app.js", "apps/mlb/tests/page.test.js"];
  assert.equal(decideDeploy(wnbaChange, "wnba").isNeeded, true);
  assert.equal(decideDeploy(wnbaChange, "mlb").isNeeded, false);
  assert.equal(decideDeploy(wnbaChange).isNeeded, true);
  for (const app of ["mlb", "wnba"]) {
    assert.equal(decideDeploy(["worker/build.mjs"], app).isNeeded, true, app);
  }
});

test("changes that can't be listed deploy", () => {
  const failingGit = () => {
    throw new Error("unknown revision abc1234");
  };
  assert.equal(listChangedFiles("abc1234", failingGit), null);
  assert.equal(decideDeploy(null).isNeeded, true);
});

test("changes are listed since the live version, with a moved file on both sides", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return "page/js/old.js\ntests/old.test.js\n";
  };
  assert.deepEqual(listChangedFiles("abc1234", git), ["page/js/old.js", "tests/old.test.js"]);
  assert.deepEqual(calls[0], ["diff", "--name-only", "--no-renames", "abc1234", "HEAD"]);
});
