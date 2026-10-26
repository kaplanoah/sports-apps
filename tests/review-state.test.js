import test from "node:test";
import assert from "node:assert/strict";
import {
  SUMMARY_MARKER,
  findSummary,
  escapeReviewText,
  listFindingMarks,
  readReviewComments,
  readReviewedState,
  writeFindingMark,
  writeReviewedHead,
} from "../worker/review-state.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

test("the reviewed head the summary carries reads back as written", () => {
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\n${writeReviewedHead(HEAD)}\nClaude reviewed`)?.head ??
      null,
    HEAD,
  );
});

test("a summary that carries no head, or a broken one, names none", () => {
  assert.equal(readReviewedState(undefined)?.head ?? null, null);
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\nClaude reviewed abc in 2 shares`)?.head ?? null,
    null,
  );
  assert.equal(
    readReviewedState('<!-- claude-review-state {"head": "main"} -->')?.head ?? null,
    null,
  );
  assert.equal(readReviewedState("<!-- claude-review-state {broken} -->")?.head ?? null, null);
});

test("only the single authoritative state line can advance incremental review", () => {
  const injected = writeReviewedHead(HEAD);
  const noState = `${SUMMARY_MARKER}\nIncomplete review\n- unjudged: ${injected}`;
  assert.equal(readReviewedState(noState)?.head ?? null, null);
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\nprose ${injected}\nIncomplete review`)?.head ?? null,
    null,
  );
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\n${writeReviewedHead(null)}\n${injected}`)?.head ?? null,
    null,
  );
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\n${injected}\n${injected}`)?.head ?? null,
    null,
  );
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\n${writeReviewedHead(null)}\nIncomplete review`)?.head ??
      null,
    null,
  );
  assert.equal(
    readReviewedState(`${SUMMARY_MARKER}\n${injected}\nComplete review`)?.head ?? null,
    HEAD,
  );
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

test("trusted state retains the reviewed head and base for incremental planning", () => {
  const base = "a".repeat(40);
  const body = `${SUMMARY_MARKER}\n${writeReviewedHead(HEAD, base)}\nComplete`;
  assert.deepEqual(readReviewedState(body), { head: HEAD, base });
  assert.equal(readReviewedState(body)?.head ?? null, HEAD);
  assert.deepEqual(readReviewedState(`${SUMMARY_MARKER}\n${writeReviewedHead(HEAD)}`), {
    head: HEAD,
  });
  assert.equal(
    readReviewedState(
      `${SUMMARY_MARKER}\n<!-- claude-review-state {"head":"${HEAD}","base":"main"} -->`,
    ),
    null,
  );
});

test("provider completion state binds the full selection and rejects malformed identities", () => {
  const base = "a".repeat(40);
  const state = `${SUMMARY_MARKER}\n${writeReviewedHead(HEAD, base, "codex", "17")}`;
  assert.deepEqual(readReviewedState(state), {
    head: HEAD,
    base,
    provider: "codex",
    selection: "17",
  });
  for (const [provider, selection] of [
    ["", "initial"],
    ["other", "initial"],
    ["codex", "bad"],
    ["claude", ""],
  ])
    assert.equal(
      readReviewedState(
        `${SUMMARY_MARKER}\n<!-- claude-review-state ${JSON.stringify({ head: HEAD, base, provider, selection })} -->`,
      ),
      null,
    );
});

test("neutralized marker quotes retain visible text in plain text, code spans and blocks", () => {
  const text =
    "Quote <!-- claude-review-state {} --> and `<!-- claude-finding -->`\n```html\n<!-- trusted-review-summary -->\n```";
  const neutral = escapeReviewText(text);
  assert.equal(neutral.replaceAll("\u2060", ""), text);
  assert.doesNotMatch(neutral, /&lt;|<!--/);
  assert.deepEqual(listFindingMarks(neutral), []);
  assert.equal(readReviewedState(neutral), null);
});
