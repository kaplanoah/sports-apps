import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_MARKER,
  findSummary,
  listFindingMarks,
  pluralize,
  readReviewComments,
  readReviewedHead,
  removeFindingMarks,
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

test("a comment reads without the marks on lines of their own, as the review posts each", () => {
  const mark = writeFindingMark("0".repeat(16), HEAD);
  assert.equal(
    removeFindingMarks(`**Nit** one\n\n${mark}\n- [ ] two\n  ${mark}\n- [ ] three\n  ${mark}`),
    "**Nit** one\n\n- [ ] two\n- [ ] three",
  );
});

test("a count names its noun once or many times", () => {
  assert.equal(pluralize(1, "finding"), "1 finding");
  assert.equal(pluralize(0, "minute"), "0 minutes");
});
