import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateRequestTokens,
  createProviderFeedback,
  createRequestEstimator,
} from "../worker/codex-rate-estimate.mjs";

const policy = { outputReserveTokens: 100, overheadTokens: 20, headroom: 0.2 };
test("a pinned established encoder estimates actual Unicode/code requests without claiming a verified model tokenizer", () => {
  const estimate = createRequestEstimator({ ...policy, encodingName: "o200k_base" });
  const result = estimate({
    input: "const answer = 42; caf\u00e9 \u65e5\u672c\u8a9e",
    tools: [{ type: "function", name: "example" }],
  });
  assert.equal(Number.isSafeInteger(result.estimatedInputTokens), true);
  assert.ok(result.estimatedInputTokens > 0);
  assert.ok(result.reservation > result.estimatedInputTokens + policy.outputReserveTokens);
  assert.equal(result.modelTokenizerVerified, false);
  assert.equal(result.observedTokens, null);
  assert.throws(() => createRequestEstimator(policy), /explicit/);
});
test("estimates include the full request, output reservation and headroom without calling them usage", () => {
  let input;
  const request = {
    model: "example",
    instructions: "rules",
    input: "content",
    tools: [{ name: "example" }],
    text: { format: { type: "json_schema" } },
  };
  const result = estimateRequestTokens(request, policy, (text) => {
    input = text;
    return 80;
  });
  assert.equal(input, JSON.stringify(request));
  assert.equal(result.reservation, 250);
  assert.equal(result.observedTokens, null);
  assert.equal(result.outputReserveTokens, 100);
});

test("missing tokenizer/output reserve or unusable estimates fail before admission", () => {
  /** @type {Array<[any, any]>} */
  const cases = [
    [policy, undefined],
    [{ ...policy, outputReserveTokens: null }, () => 1],
    [{ ...policy, outputReserveTokens: 0 }, () => 1],
    [{ ...policy, headroom: 1 }, () => 1],
    [policy, () => NaN],
    [policy, () => Number.MAX_SAFE_INTEGER],
  ];
  for (const [config, tokenize] of cases) {
    assert.throws(() => estimateRequestTokens({}, config, tokenize));
  }
});

test("provider feedback reacts to external token pressure and reserves each local request atomically", () => {
  let time = 0;
  const feedback = createProviderFeedback(
    { tokens: 1000, requests: 10, windowMs: 60000 },
    () => time,
  );
  feedback.observe(
    new Headers({
      "x-ratelimit-limit-tokens": "1000",
      "x-ratelimit-remaining-tokens": "100",
      "x-ratelimit-reset-tokens": "2s",
    }),
  );
  assert.deepEqual(feedback.reserve(50), { admitted: true });
  assert.deepEqual(feedback.reserve(40), { admitted: false, notBefore: 2000 });
  time = 2000;
  assert.deepEqual(feedback.reserve(40), { admitted: true });
});

test("request feedback is independent of token capacity and reset deadlines retain the later advice", () => {
  let time = 0;
  const feedback = createProviderFeedback(
    { tokens: 1000, requests: 10, windowMs: 60000, headroom: 0 },
    () => time,
  );
  feedback.observe(
    new Headers({ "x-ratelimit-remaining-requests": "1", "x-ratelimit-reset-requests": "2s" }),
  );
  assert.deepEqual(feedback.reserve(1), { admitted: true });
  feedback.observe(
    new Headers({ "x-ratelimit-remaining-requests": "8", "x-ratelimit-reset-requests": "3s" }),
  );
  assert.deepEqual(feedback.reserve(1), { admitted: false, notBefore: 3000 });
  time = 3000;
  assert.deepEqual(feedback.reserve(1), { admitted: true });
});

test("missing remaining budget is conservative, malformed feedback cannot turn into unlimited capacity", () => {
  const feedback = createProviderFeedback({ tokens: 1000, requests: 10, windowMs: 60000 }, () => 0);
  feedback.observe(new Headers({ "x-ratelimit-limit-tokens": "1000" }));
  assert.deepEqual(feedback.reserve(1), { admitted: false, notBefore: 60000 });
  for (const headers of [
    { "x-ratelimit-remaining-tokens": "-1" },
    { "x-ratelimit-remaining-tokens": "NaN" },
    { "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "garbage" },
  ]) {
    assert.throws(() => feedback.observe(new Headers(headers)));
  }
});

test("configured allowance caps provider feedback and out-of-order feedback never adds capacity", () => {
  const feedback = createProviderFeedback(
    { tokens: 100, requests: 2, windowMs: 60000, headroom: 0 },
    () => 0,
  );
  feedback.observe(
    new Headers({
      "x-ratelimit-limit-tokens": "1000",
      "x-ratelimit-remaining-tokens": "1000",
      "x-ratelimit-reset-tokens": "1s",
    }),
  );
  assert.deepEqual(feedback.reserve(80), { admitted: true });
  feedback.observe(
    new Headers({ "x-ratelimit-remaining-tokens": "900", "x-ratelimit-reset-tokens": "2s" }),
  );
  assert.equal(feedback.readSnapshot().tokens.remaining, 20);
  assert.deepEqual(feedback.reserve(21), { admitted: false, notBefore: 2000 });
});
