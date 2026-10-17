import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_MARKER,
  findSummary,
  listFindingMarks,
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
