import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  SUMMARY_MARKER,
  findSummary,
  listFindingMarks,
  readReviewComments,
  readReviewedHead,
  writeFindingMark,
  writeReviewedHead,
} from "../worker/review-state.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

test("the reviewed head the summary carries reads back as written", () => {
  assert.equal(
    readReviewedHead(`${SUMMARY_MARKER}\n${writeReviewedHead(HEAD)}\nClaude reviewed`),
    HEAD,
  );
});

test("reviewed heads follow the shared object validator's acceptance and rejection", () => {
  const script = `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    mock.module(${JSON.stringify(new URL("../worker/git-object.mjs", import.meta.url).href)}, {
      exports: { isGitObjectId: value => value === "shared-validator-head" },
    });
    const { readReviewedHead, writeReviewedHead } = await import(${JSON.stringify(new URL("../worker/review-state.mjs", import.meta.url).href)});
    assert.equal(readReviewedHead(writeReviewedHead("shared-validator-head")), "shared-validator-head");
    assert.equal(readReviewedHead(writeReviewedHead(${JSON.stringify(HEAD)})), null);
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--input-type=module", "-e", script],
    {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});

test("a summary that carries no head, or a broken one, names none", () => {
  assert.equal(readReviewedHead(undefined), null);
  assert.equal(readReviewedHead(`${SUMMARY_MARKER}\nClaude reviewed abc in 2 shares`), null);
  assert.equal(readReviewedHead('<!-- claude-review-state {"head": "main"} -->'), null);
  assert.equal(readReviewedHead("<!-- claude-review-state {broken} -->"), null);
});

test("the summary is the review's own, never another's comment that starts the same way", () => {
  const comments = [
    { id: 1, user: { login: "someone" }, body: `${SUMMARY_MARKER}\nnot the review's` },
    { id: 2, user: { login: "claude[bot]" }, body: "Claude reviewed an older commit" },
    { id: 3, user: { login: "github-actions[bot]" }, body: `${SUMMARY_MARKER}\nold` },
  ];
  assert.equal(findSummary(comments)?.id, 3);
  assert.equal(findSummary(comments.slice(0, 2)), null);
});

test("a comment's finding marks read back as written, however many it holds", () => {
  const body = `- one ${writeFindingMark("0123456789abcdef", HEAD)}\n- two ${writeFindingMark("fedcba9876543210", HEAD)}`;
  assert.deepEqual(listFindingMarks(body), [
    { key: "0123456789abcdef", head: HEAD },
    { key: "fedcba9876543210", head: HEAD },
  ]);
  assert.deepEqual(listFindingMarks(undefined), []);
  assert.deepEqual(listFindingMarks("<!-- claude-finding 0123456789abcdef -->"), []);
});

test("the review's comments are its own from every page of the review comments, then the conversation's", async () => {
  const bot = { login: "github-actions[bot]" };
  const others = Array.from({ length: 99 }, () => ({ user: { login: "someone" }, body: "ok" }));
  /** @type {Record<string, any[]>} */
  const pages = {
    "/pulls/7/comments?per_page=100&page=1": [{ user: bot, body: "one" }, ...others],
    "/pulls/7/comments?per_page=100&page=2": [{ user: bot, body: "two" }],
    "/issues/7/comments?per_page=100&page=1": [{ user: bot, body: "three" }, { body: "no one" }],
  };
  const comments = await readReviewComments(async (path) => pages[path] ?? [], "7");
  assert.deepEqual(
    comments.map((comment) => comment.body),
    ["one", "two", "three"],
  );
});
