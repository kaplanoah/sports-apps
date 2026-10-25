import test from "node:test";
import assert from "node:assert/strict";
import { measureReviewTokens, measureReviewTrial } from "../worker/review-evaluation.mjs";

const CODEX = [
  { type: "turn.started" },
  {
    type: "turn.completed",
    usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30 },
  },
  {
    type: "turn.completed",
    usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 },
  },
]
  .map((event) => JSON.stringify(event))
  .join("\n");
const CLAUDE = JSON.stringify([
  { type: "assistant", usage: { input_tokens: 999 } },
  {
    type: "result",
    usage: {
      input_tokens: 100,
      output_tokens: 30,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
    },
  },
]);
const TRIAL = {
  case: "case-1",
  head: "950a11002a35bab3d2671c2d858615ff86587fd7",
  fix: "1b90fd34f64459f960ff0e735c1eb1f1266fcc11",
  provider: "codex",
  model: "example-model",
  toolVersion: "example-version",
  status: "completed",
  elapsedSeconds: 120,
  adjudications: [
    {
      verdict: "confirmed-target",
      reason: "The reported path throws for the reproduced unknown frame.",
    },
    { verdict: "false", reason: "This caller cannot pass that input." },
  ],
};

test("evaluation counts native provider usage separately without counting intermediate Claude messages twice", () => {
  assert.deepEqual(measureReviewTokens(CODEX, "codex"), {
    input: 150,
    output: 35,
    cached: 30,
    cacheWrite: 0,
  });
  assert.deepEqual(measureReviewTokens(CLAUDE, "claude"), {
    input: 100,
    output: 30,
    cached: 20,
    cacheWrite: 5,
  });
  for (const [text, provider] of [
    ["", "codex"],
    ["[]", "claude"],
    ["{}", "claude"],
    [CODEX, "other"],
  ])
    assert.throws(() => measureReviewTokens(text, provider));
});

test("detection, false findings, completion, tokens and elapsed time require an adjudicated exact historical trial", () => {
  const measurement = measureReviewTrial(TRIAL, CODEX);
  assert.equal(measurement.detected, true);
  assert.equal(measurement.falseFindings, 1);
  assert.equal(measurement.completed, true);
  assert.equal(measurement.elapsedSeconds, 120);
  assert.equal(measurement.tokens.output, 35);
  assert.equal(measureReviewTrial({ ...TRIAL, status: "interrupted" }, CODEX).completed, false);
  for (const change of [
    { head: "a".repeat(40) },
    { fix: "b".repeat(40) },
    { elapsedSeconds: 0 },
    { status: "unknown" },
    { model: "" },
    { adjudications: [{ verdict: "confirmed-target", reason: "" }] },
  ])
    assert.throws(() => measureReviewTrial({ ...TRIAL, ...change }, CODEX));
});
