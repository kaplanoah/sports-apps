import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_MARKER,
  selectReviewProvider,
  verifyReviewProvider,
} from "../worker/review-provider.mjs";
import { readLastReview } from "../worker/plan-review.mjs";
import { writeReviewedHead, SUMMARY_MARKER } from "../worker/review-state.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewDecisionEnvironment, readStepScript } from "./workflow-step.js";
import { readRepoFile } from "./repo-files.js";

/** @param {string} provider @param {string} selection */
const createComment = (provider, selection) => ({
  user: { login: "github-actions[bot]" },
  body: `${PROVIDER_MARKER}${JSON.stringify({ provider, selection })} -->\nProvider choice.`,
});
/** @param {number} id @param {string} provider @param {string} [actor] */
const createEvent = (id, provider, actor = "example") => ({
  id,
  event: "labeled",
  actor: { login: actor },
  label: { name: `review-provider:${provider}` },
});

test("Claude starts by default and the initial choice survives repository default changes", () => {
  const initial = selectReviewProvider({ comments: [], events: [], owner: "example" });
  assert.deepEqual(initial, { provider: "claude", selection: "initial" });
  assert.deepEqual(
    selectReviewProvider({
      comments: [createComment("claude", "initial")],
      events: [],
      owner: "example",
      defaultProvider: "codex",
    }),
    initial,
  );
  assert.throws(() =>
    selectReviewProvider({ comments: [], events: [], owner: "example", defaultProvider: "other" }),
  );
});

test("only the owner's explicit selection changes provider and a switch back has a fresh epoch", () => {
  const context = { comments: [createComment("claude", "initial")], owner: "example" };
  assert.deepEqual(
    selectReviewProvider({ ...context, events: [createEvent(1, "codex", "collaborator")] }),
    { provider: "claude", selection: "initial" },
  );
  assert.deepEqual(
    selectReviewProvider({
      ...context,
      events: [createEvent(8, "codex"), createEvent(9, "claude", "collaborator")],
    }),
    { provider: "codex", selection: "8" },
  );
  const events = [
    createEvent(10, "claude"),
    createEvent(8, "codex"),
    { ...createEvent(11, "claude"), event: "unlabeled" },
  ];
  assert.deepEqual(selectReviewProvider({ ...context, events }), {
    provider: "claude",
    selection: "10",
  });
});

test("forged, duplicate and malformed state cannot select a provider", () => {
  const forged = { ...createComment("codex", "99"), user: { login: "someone" } };
  assert.equal(
    selectReviewProvider({ comments: [forged], events: [], owner: "example" }).provider,
    "claude",
  );
  for (const comments of [
    [createComment("codex", "bad")],
    [createComment("other", "initial")],
    [createComment("claude", "initial"), createComment("codex", "3")],
  ])
    assert.throws(() => selectReviewProvider({ comments, events: [], owner: "example" }));
});

test("publication rechecks the live provider and rejects a same-code switch, including away and back", async () => {
  const env = {
    GITHUB_REPOSITORY: "example/repository",
    PR: "1",
    REVIEW_PROVIDER: "claude",
    REVIEW_SELECTION: "initial",
  };
  let events = [];
  const readGitHub = async (path) =>
    path.includes("/timeline?") ? events : [createComment("claude", "initial")];
  await verifyReviewProvider(env, readGitHub);
  events = [createEvent(2, "codex")];
  await assert.rejects(verifyReviewProvider(env, readGitHub), /complete new review/);
  events.push(createEvent(3, "claude"));
  await assert.rejects(verifyReviewProvider(env, readGitHub), /complete new review/);
  await verifyReviewProvider({ ...env, REVIEW_SELECTION: "3" }, readGitHub);
});

test("the live workflow routes exactly one provider with no fallback and keeps Codex gated", () => {
  const workflow = readRepoFile(".github/workflows/review.yml");
  assert.match(workflow, /outputs.provider == 'claude' && needs.review-plan.outputs.count > 0/);
  assert.match(workflow, /outputs.provider == 'codex' && needs.review-plan.outputs.count > 0/);
  assert.match(workflow, /CODEX_ENABLED.*!=.*true/);
  assert.match(workflow, /No provider fallback is allowed/);
  assert.match(workflow, /github.event.sender.login == github.repository_owner/);
  assert.doesNotMatch(workflow, /% 2|parity/);
});

test("credential gates execute only the selected provider and never fall back", () => {
  const script = readStepScript(
    readRepoFile(".github/workflows/review.yml"),
    "Decide whether to review",
  );
  for (const [provider, enabled, codexKey, claudeKey, expected] of [
    ["claude", "", "", "example", 0],
    ["codex", "true", "example", "", 0],
    ["codex", "", "example", "example", 1],
    ["codex", "true", "", "example", 1],
    ["claude", "true", "example", "", 1],
  ]) {
    const output = join(mkdtempSync(join(tmpdir(), "provider-gate-")), "output");
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: createReviewDecisionEnvironment({
        PATH: process.env.PATH,
        GITHUB_OUTPUT: output,
        EVENT: "pull_request_target",
        ACTION: "opened",
        AUTHOR: "example",
        ASSOCIATION: "OWNER",
        REVIEW_PROVIDER: String(provider),
        REVIEW_SELECTION: "initial",
        REVIEW_LABEL: "review",
        CODEX_ENABLED: String(enabled),
        CODEX_API_KEY: String(codexKey),
        ANTHROPIC_API_KEY: String(claudeKey),
      }),
    });
    assert.equal(result.status, expected, result.stderr + result.stdout);
  }
});

test("switching provider or selection discards completion reuse and requires the whole change", async () => {
  const head = "a".repeat(40),
    base = "b".repeat(40);
  const comments = [
    {
      user: { login: "github-actions[bot]" },
      body: `${SUMMARY_MARKER}\n${writeReviewedHead(head, base, "claude", "initial")}\nReview.`,
    },
  ];
  const readGitHub = async () => comments;
  const env = {
    GITHUB_REPOSITORY: "example/repository",
    PR: "1",
    REVIEW_PROVIDER: "claude",
    REVIEW_SELECTION: "initial",
  };
  assert.equal((await readLastReview(env, readGitHub)).head, head);
  assert.equal(await readLastReview({ ...env, REVIEW_PROVIDER: "codex" }, readGitHub), null);
  assert.equal(await readLastReview({ ...env, REVIEW_SELECTION: "8" }, readGitHub), null);
  comments[0].body = `${SUMMARY_MARKER}\n${writeReviewedHead(head, base)}\nLegacy review.`;
  assert.equal((await readLastReview(env, readGitHub)).head, head);
  assert.equal(await readLastReview({ ...env, REVIEW_PROVIDER: "codex" }, readGitHub), null);
  assert.equal(await readLastReview({ ...env, REVIEW_SELECTION: "8" }, readGitHub), null);
});
