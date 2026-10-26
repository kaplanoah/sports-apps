import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { readRepoFile } from "./repo-files.js";
import { readStepScript } from "./workflow-step.js";

const WORKFLOW = readRepoFile(".github/workflows/trusted-review-publisher.yml");
const CANARY_JOB = WORKFLOW.split("  access-canary:\n")[1].split("\n  discover:")[0];
const SCRIPT = readStepScript(WORKFLOW, "Check environment access");

/** @param {Record<string, string>} overrides */
function checkCanaryScript(overrides = {}) {
  return spawnSync("bash", ["--noprofile", "--norc", "-c", SCRIPT], {
    encoding: "utf8",
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "a".repeat(40),
      GITHUB_WORKFLOW_REF:
        "kaplanoah/sports-apps/.github/workflows/trusted-review-publisher.yml@refs/heads/main",
      GITHUB_RUN_ID: "1",
      GITHUB_RUN_ATTEMPT: "1",
      CANARY_PRESENT: "true",
      ...overrides,
    },
  });
}

test("the access canary has no write token, actions, model calls, or real key reference", () => {
  assert.match(CANARY_JOB, /^ {4}permissions: \{\}$/m);
  assert.match(CANARY_JOB, /^ {4}timeout-minutes: 5$/m);
  assert.match(CANARY_JOB, /^ {4}environment: trusted-review-publisher$/m);
  assert.doesNotMatch(
    CANARY_JOB,
    /uses:|GH_TOKEN|APP_TOKEN|CLAUDE|ANTHROPIC|PRIVATE_KEY|curl |gh |npm |git /,
  );
  assert.deepEqual(
    [...CANARY_JOB.matchAll(/secrets\.([A-Z_]+)/g)].map(([, name]) => name),
    ["TRUSTED_REVIEW_SETUP_CANARY"],
  );
  assert.match(CANARY_JOB, /CANARY_PRESENT: .*TRUSTED_REVIEW_SETUP_CANARY != ''/);
  assert.match(
    WORKFLOW,
    /pull_request:\n {4}branches: \[issue-809-proof-base\]\n {4}types: \[opened\]/,
  );
});

test("canary events cannot enter publisher discovery even when its flag is true", () => {
  const expression = WORKFLOW.match(/^ {2}discover:\n {4}if: (.*)/m)?.[1];
  assert.ok(expression);
  for (const event of ["workflow_dispatch", "pull_request", "pull_request_target", "workflow_run"])
    for (const enabled of ["false", "true"]) {
      const actual = runInNewContext(expression, {
        vars: { TRUSTED_REVIEW_PUBLISHER_ENABLED: enabled },
        github: { event_name: event },
      });
      assert.equal(
        actual,
        enabled === "true" && ["pull_request_target", "workflow_run"].includes(event),
        event + "/" + enabled,
      );
    }
});

test("main succeeds only when the harmless canary is available", () => {
  const passed = checkCanaryScript();
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /Main received the harmless environment canary/);
  const missing = checkCanaryScript({ CANARY_PRESENT: "false" });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /canary is unavailable/);
});

test("unexpected branch, tag, or pull request access fails even with a canary present", () => {
  for (const ref of [
    "refs/heads/issue-809-proof-head",
    "refs/tags/issue-809-proof-tag",
    "refs/pull/1/merge",
  ]) {
    const result = checkCanaryScript({ GITHUB_REF: ref });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /environment isolation failed/);
  }
});

test("the canary cannot claim success with a foreign native workflow ref", () => {
  const result = checkCanaryScript({
    GITHUB_WORKFLOW_REF:
      "example/repository/.github/workflows/trusted-review-publisher.yml@refs/heads/main",
  });
  assert.equal(result.status, 1);
});
