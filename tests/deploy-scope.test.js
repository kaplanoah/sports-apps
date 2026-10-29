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

// Every push to beta runs the claim's check, and every production deploy its report, whether or
// not a Worker deploys, and no Worker runs either, so a change to one needs no deploy to show it
// works.
const BETA_CLAIM_CHECK = "worker/beta-claim.mjs";
const DEPLOY_REPORT = "worker/report-deploy.mjs";

test("rate-control tooling changes do not deploy Workers while unknown root code still does", () => {
  for (const name of [
    "access",
    "source",
    "handoff",
    "lifecycle",
    "policy",
    "runtime",
    "budget",
    "controller",
    "estimate",
    "gateway",
    "isolation-access",
    "isolation-holder",
    "isolation-probe",
    "namespaces",
    "probe-output",
  ]) {
    assert.equal(decideDeploy([`worker/codex-rate-${name}.mjs`]).isNeeded, false, name);
  }
  assert.equal(decideDeploy(["worker/prove-codex-rate-isolation.mjs"]).isNeeded, false);
  assert.equal(decideDeploy(["worker/prepare-codex-rate.mjs"]).isNeeded, false);
  assert.equal(decideDeploy(["worker/example-runtime.mjs"]).isNeeded, true);
});

test("every script the deploy runs, and every module those import, deploys when it changes, but the beta claim's check and the deploy's report", () => {
  const workflow = readRepoFile(".github/workflows/deploy.yml");
  const scripts = [...workflow.matchAll(/node (worker\/[\w-]+\.mjs)/g)]
    .map(([, path]) => path)
    .filter((path) => path !== BETA_CLAIM_CHECK && path !== DEPLOY_REPORT);
  assert.ok(scripts.includes("worker/deploy.mjs"));
  assert.match(
    workflow,
    /if: env\.CHANNEL == 'beta'\n.*\n.*\n\s+run: node worker\/beta-claim\.mjs/,
  );
  assert.equal(
    decideDeploy([BETA_CLAIM_CHECK, "worker/labeling.mjs", DEPLOY_REPORT, "worker/issues.mjs"])
      .isNeeded,
    false,
  );
  const run = [".github/workflows/deploy.yml", ...new Set(scripts.flatMap(listImported))];
  assert.deepEqual(
    run.filter((path) => !findDeployedChanges([path]).length),
    [],
  );
});

test("a merge of only docs, tests, and tooling skips the deploy", () => {
  const decision = decideDeploy([
    ".claude/hooks/context-limit.mjs",
    ".claude/rules/page-look.md",
    ".claude/settings.json",
    ".githooks/pre-push",
    ".githooks/check-push.mjs",
    ".agents/skills/add-league/SKILL.md",
    ".agents/skills/ship/SKILL.md",
    ".github/workflows/beta.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/codex-validation-proof.yml",
    ".github/workflows/flaky.yml",
    ".github/workflows/mutation.yml",
    ".github/workflows/phone-ready.yml",
    ".github/workflows/provider-review-trial.yml",
    ".github/workflows/provider-review-session.yml",
    ".github/workflows/publish-trusted-review.yml",
    ".github/workflows/review.yml",
    ".github/workflows/trusted-review-area.yml",
    ".github/workflows/trusted-review-issuer-test.yml",
    ".github/workflows/trusted-review-lookalike-test.yml",
    ".github/workflows/trusted-review-publisher.yml",
    "AGENTS.md",
    "README.md",
    "apps/mlb/tests/browser/page.spec.mjs",
    "apps/mlb/tests/store.test.js",
    "eslint.config.mjs",
    "stryker.config.mjs",
    "tests/deploy.test.js",
    "tests/time-zone-sensitive.json",
    "worker/browser-scope.mjs",
    "worker/browser-test-calls.mjs",
    "worker/burn-in-specs.mjs",
    "worker/find-trusted-review.mjs",
    "worker/issues.mjs",
    "worker/mutation-targets.mjs",
    "worker/phone-ready.mjs",
    "worker/review-trial.mjs",
    "worker/review-trial-authority.mjs",
    "worker/review-trial-evidence.mjs",
    "worker/mutation-tests.mjs",
    "worker/node-tests.mjs",
    "worker/package-imports.mjs",
    "worker/post-review.mjs",
    "worker/prove-review-validation.mjs",
    "worker/publish-trusted-review.mjs",
    "worker/pull-merge.mjs",
    "worker/red-change-styles.mjs",
    "worker/red-change.mjs",
    "worker/report-deploy.mjs",
    "worker/report-flaky-tests.mjs",
    "worker/review-artifact.mjs",
    "worker/review-context.mjs",
    "worker/review-data.mjs",
    "worker/review-diagnostics.mjs",
    "worker/review-git.mjs",
    "worker/review-json.mjs",
    "worker/review-publication.mjs",
    "worker/review-repository.mjs",
    "worker/review-run.mjs",
    "worker/review-state.mjs",
    "worker/rework.mjs",
    "worker/rule-files.mjs",
    "worker/set-app-key.mjs",
    "worker/test-time-zone.mjs",
    "worker/test-review-issuer.mjs",
    "worker/time-zone-scope.mjs",
    "worker/trusted-review.mjs",
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

test("a change in a service's folder deploys that service alone, and its tests deploy nothing", () => {
  const serviceChange = ["services/accounts/worker/src/index.js"];
  assert.equal(decideDeploy(serviceChange, "accounts").isNeeded, true);
  assert.equal(decideDeploy(serviceChange, "mlb").isNeeded, false);
  assert.equal(decideDeploy(["services/accounts/tests/a.test.js"]).isNeeded, false);
});

test("adding, renaming, or removing a service deploys every app, which binds it by its config", () => {
  const added = ["services/profiles/worker/wrangler.toml", "services/profiles/worker/src/index.js"];
  for (const worker of ["mlb", "wnba", "profiles"])
    assert.equal(decideDeploy(added, worker).isNeeded, true, worker);
  assert.equal(decideDeploy(added, "accounts").isNeeded, false);
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

test("executable agent files and unlisted Git hooks still deploy", () => {
  for (const path of [
    ".agents/skills/scripts/check.mjs",
    ".agents/shared.js",
    ".githooks/future.mjs",
  ])
    assert.equal(decideDeploy([path]).isNeeded, true, path);
});
