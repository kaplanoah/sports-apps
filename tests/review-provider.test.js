import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_MARKER,
  selectReviewProvider,
  readReviewProvider,
  verifyReviewProvider,
  writeReviewModelQueue,
} from "../worker/review-provider.mjs";
import { readLastReview } from "../worker/plan-review.mjs";
import { writeReviewedHead, SUMMARY_MARKER } from "../worker/review-state.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewDecisionEnvironment, readStepScript } from "./workflow-step.js";
import { readRepoFile } from "./repo-files.js";
import { readReviewIdentity } from "../worker/review-data.mjs";

test("native model jobs share a non-cancelling queued API slot while trial Claude jobs keep separate slots", () => {
  for (const [path, dependency, command] of [
    [
      ".github/workflows/trusted-codex-review.yml",
      "request",
      'review-codex.mjs" request "$PORTION"',
    ],
    [
      ".github/workflows/provider-review-session.yml",
      "request",
      'review-trial.mjs request "$PORTION"',
    ],
    [".github/workflows/codex-runner-proof.yml", "prepare", "prove-codex-runner.mjs prepare"],
  ]) {
    const workflow = readRepoFile(path);
    const model = workflow.split(/^ {2}model:\n/m)[1].split(/^ {2}[\w-]+:\n/m)[0];
    assert.match(
      model,
      new RegExp(
        `concurrency:\\n {6}group: \\$\\{\\{ needs\\.${dependency}\\.outputs\\.model-queue \\}\\}\\n {6}cancel-in-progress: false\\n {6}queue: max`,
      ),
    );
    const producer = workflow.split(`\n  ${dependency}:\n`)[1].split(/^ {2}[\w-]+:\n/m)[0];
    assert.match(producer, /model-queue: \$\{\{ steps\.request\.outputs\.model-queue \}\}/);
    const request = producer.split(/^ {6}- /m).find((step) => /^ {8}id: request$/m.test(step));
    assert.ok(request);
    assert.ok(request.includes(command));
  }
});

test("one repository Codex slot spans runs and phases without serializing unrelated Claude trials", (context) => {
  const root = mkdtempSync(join(tmpdir(), "review-model-queue-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    GITHUB_REPOSITORY: "example/repository",
    GITHUB_RUN_ID: "1",
    GITHUB_OUTPUT: join(root, "output"),
  };
  const groups = [];
  for (const [provider, run, portion, repository] of [
    ["codex", "1", 1, env.GITHUB_REPOSITORY],
    ["codex", "2", "integration", env.GITHUB_REPOSITORY],
    ["codex", "3", "proof", env.GITHUB_REPOSITORY],
    ["codex", "1", 1, "example/another"],
    ["claude", "1", 1, env.GITHUB_REPOSITORY],
    ["claude", "1", 2, env.GITHUB_REPOSITORY],
    ["claude", "2", 1, env.GITHUB_REPOSITORY],
  ]) {
    writeReviewModelQueue(
      { ...env, GITHUB_RUN_ID: String(run), GITHUB_REPOSITORY: String(repository) },
      String(provider),
      portion,
    );
    groups.push(readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").at(-1));
  }
  assert.equal(groups[0], groups[1]);
  assert.equal(groups[1], groups[2]);
  assert.notEqual(groups[0], groups[3]);
  assert.equal(new Set(groups.slice(3)).size, 4);
  for (const { provider, change } of [
    { provider: "unknown", change: {} },
    { provider: "codex", change: { GITHUB_REPOSITORY: "private\nvalue" } },
    { provider: "claude", change: { GITHUB_RUN_ID: "private" } },
  ])
    assert.throws(
      () => writeReviewModelQueue({ ...env, ...change }, provider, 1),
      /Invalid review model queue identity/,
    );
});

/** @param {string} provider @param {string} selection */
const createComment = (provider, selection) => ({
  user: { login: "github-actions[bot]" },
  body: `${PROVIDER_MARKER}${JSON.stringify({ provider, selection })} -->\nProvider choice.`,
});
/** @param {string | number} id @param {string} provider @param {string} [actor] */
const createEvent = (id, provider, actor = "example") => ({
  id,
  event: "labeled",
  actor: { login: actor },
  label: { name: `review-provider:${provider}` },
});

/** @param {() => any[]} readEvents */
function createTimelineFetch(readEvents) {
  return async (url) => {
    assert.equal(url, "https://api.github.com/graphql");
    return Response.json({
      data: {
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: readEvents().map((event) => ({
                ...event,
                __typename: event.event === "unlabeled" ? "UnlabeledEvent" : "LabeledEvent",
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
  };
}

test("authoritative label history preserves a newer choice omitted by REST timeline", async () => {
  const env = { GITHUB_REPOSITORY: "example/repository", PR: "1" };
  let timelineReads = 0;
  const readGitHub = async (path) => {
    if (path.startsWith("/issues/1/comments?")) return [createComment("codex", "11")];
    if (path.startsWith("/issues/1/timeline?")) {
      timelineReads += 1;
      return [createEvent("LE_10", "claude")];
    }
    assert.equal(path, "/issues/events/11");
    return {
      ...createEvent(11, "codex"),
      node_id: "LE_new",
      issue: { number: 1, url: "https://api.github.com/repos/example/repository/issues/1" },
    };
  };
  const fetchImpl = async (url) => {
    assert.equal(url, "https://api.github.com/graphql");
    return new Response(
      JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              timelineItems: {
                nodes: [
                  { ...createEvent("LE_old", "claude"), __typename: "LabeledEvent" },
                  { ...createEvent("LE_new", "codex"), __typename: "LabeledEvent" },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
    );
  };
  const result = await readReviewProvider(env, readGitHub, fetchImpl);
  assert.deepEqual(result.choice, { provider: "codex", selection: "11" });
  assert.equal(timelineReads, 0);
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
    selectReviewProvider({ ...context, events: [createEvent("LE_1", "codex", "collaborator")] }),
    { provider: "claude", selection: "initial" },
  );
  assert.deepEqual(
    selectReviewProvider({
      ...context,
      events: [createEvent("LE_8", "codex"), createEvent("LE_9", "claude", "collaborator")],
    }),
    { provider: "codex", selection: "node:LE_8" },
  );
  const events = [
    createEvent("LE_8", "codex"),
    createEvent("LE_10", "claude"),
    { ...createEvent("LE_11", "claude"), event: "unlabeled" },
  ];
  assert.deepEqual(selectReviewProvider({ ...context, events }), {
    provider: "claude",
    selection: "node:LE_10",
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

test("a saved event must remain authenticated before a later event can replace it", () => {
  const context = { comments: [createComment("codex", "node:LE_anchor")], owner: "example" };
  const anchor = createEvent("LE_anchor", "codex");
  assert.deepEqual(selectReviewProvider({ ...context, events: [anchor] }), {
    provider: "codex",
    selection: "node:LE_anchor",
  });
  assert.deepEqual(
    selectReviewProvider({ ...context, events: [anchor, createEvent("LE_new", "codex")] }),
    {
      provider: "codex",
      selection: "node:LE_new",
    },
  );
  for (const events of [
    [],
    [createEvent("LE_old", "claude")],
    [createEvent("LE_anchor", "claude")],
    [createEvent("LE_anchor", "codex", "other")],
    [anchor, anchor],
    [{ ...anchor, id: undefined }],
  ])
    assert.throws(() => selectReviewProvider({ ...context, events }));
});

test("connection order distinguishes rapid switches without comparing opaque IDs or timestamps", () => {
  const events = [
    createEvent("LE_z", "codex"),
    createEvent("LE_a", "claude"),
    createEvent("LE_b", "codex"),
  ].map((event) => ({ ...event, created_at: "2026-01-01T00:00:00Z" }));
  assert.deepEqual(selectReviewProvider({ comments: [], events, owner: "example" }), {
    provider: "codex",
    selection: "node:LE_b",
  });
  assert.deepEqual(
    selectReviewProvider({
      comments: [createComment("codex", "12")],
      events,
      owner: "example",
      legacySelectionNode: "LE_z",
    }),
    { provider: "codex", selection: "node:LE_b" },
  );
});

test("legacy epochs require the exact owner event and this PR before keeping sealed results reusable", async () => {
  const env = { GITHUB_REPOSITORY: "example/repository", PR: "1" };
  const legacy = {
    ...createEvent(12, "codex"),
    node_id: "LE_anchor",
    issue: { number: 1, url: "https://api.github.com/repos/example/repository/issues/1" },
  };
  const readChoice = (event) =>
    readReviewProvider(
      env,
      async (path) => (path.includes("/comments?") ? [createComment("codex", "12")] : event),
      createTimelineFetch(() => [createEvent("LE_anchor", "codex")]),
    );
  assert.deepEqual((await readChoice(legacy)).choice, { provider: "codex", selection: "12" });
  for (const change of [
    { id: 13 },
    { node_id: "LE_other" },
    { node_id: undefined },
    { event: "unlabeled" },
    { actor: { login: "other" } },
    { label: { name: "review-provider:claude" } },
    { issue: { number: 2, url: legacy.issue.url } },
    { issue: { number: 1, url: "https://example.com" } },
  ])
    await assert.rejects(readChoice({ ...legacy, ...change }));
});

test("all GraphQL pages are required and a missing or nonadvancing page holds provider selection", async () => {
  const cursors = [];
  const env = { GITHUB_REPOSITORY: "example/repository", PR: "1" };
  const readGitHub = async () => [createComment("codex", "node:LE_last")];
  const fetchImpl = async (url, request) => {
    assert.equal(url, "https://api.github.com/graphql");
    const { variables, query } = JSON.parse(request.body);
    assert.match(query, /on LabeledEvent \{ id /);
    cursors.push(variables.after);
    return Response.json({
      data: {
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                {
                  ...createEvent(
                    variables.after ? "LE_last" : "LE_first",
                    variables.after ? "codex" : "claude",
                  ),
                  __typename: "LabeledEvent",
                },
              ],
              pageInfo: { hasNextPage: !variables.after, endCursor: "cursor" },
            },
          },
        },
      },
    });
  };
  assert.equal(
    (await readReviewProvider(env, readGitHub, fetchImpl)).choice.selection,
    "node:LE_last",
  );
  assert.deepEqual(cursors, [null, "cursor"]);
  for (const response of [
    { data: {} },
    { errors: [{ message: "Unavailable" }] },
    {
      data: {
        repository: {
          pullRequest: {
            timelineItems: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor" } },
          },
        },
      },
    },
  ])
    await assert.rejects(readReviewProvider(env, readGitHub, async () => Response.json(response)));
});

test("summary and sealed identity accept the same epochs and never reuse a different one", async () => {
  const head = "a".repeat(40),
    base = "b".repeat(40);
  const env = {
    GITHUB_REPOSITORY: "example/repository",
    PR: "1",
    GITHUB_RUN_ID: "1",
    REVIEW_HEAD: head,
    REVIEW_BASE: base,
    REVIEW_MERGE: head,
    REVIEW_TRUSTED: base,
    GITHUB_WORKFLOW_REF: "example/repository/.github/workflows/review.yml@refs/heads/main",
    REVIEW_PROVIDER: "codex",
    REVIEW_SELECTION: "node:LE_anchor",
  };
  const readGitHub = async () => [
    {
      user: { login: "github-actions[bot]" },
      body: `${SUMMARY_MARKER}\n${writeReviewedHead(head, base, "codex", env.REVIEW_SELECTION)}\nReview.`,
    },
  ];
  assert.doesNotThrow(() => readReviewIdentity(env));
  assert.equal(readReviewIdentity(env).selection, env.REVIEW_SELECTION);
  assert.equal((await readLastReview(env, readGitHub)).head, head);
  assert.equal(await readLastReview({ ...env, REVIEW_SELECTION: "node:LE_new" }, readGitHub), null);
  for (const selection of ["0", "01", "9007199254740992", "node:", "node:bad\nvalue", "other"])
    assert.throws(() => readReviewIdentity({ ...env, REVIEW_SELECTION: selection }));
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
  const fetchImpl = createTimelineFetch(() => events);
  await verifyReviewProvider(env, readGitHub, fetchImpl);
  events = [createEvent("LE_2", "codex")];
  await assert.rejects(verifyReviewProvider(env, readGitHub, fetchImpl), /complete new review/);
  events.push(createEvent("LE_3", "claude"));
  await assert.rejects(verifyReviewProvider(env, readGitHub, fetchImpl), /complete new review/);
  await verifyReviewProvider({ ...env, REVIEW_SELECTION: "node:LE_3" }, readGitHub, fetchImpl);
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
    ["", "true", "example", "example", 1],
    ["other", "true", "example", "example", 1],
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
