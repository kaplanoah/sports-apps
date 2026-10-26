import test from "node:test";
import assert from "node:assert/strict";
import {
  measureReviewTokens,
  measureReviewTrial,
  retainCodexUsage,
} from "../worker/review-evaluation.mjs";

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
      id: "1",
      verdict: "confirmed-target",
      reason: "The reported path throws for the reproduced unknown frame.",
    },
    { id: "2", verdict: "false", reason: "This caller cannot pass that input." },
  ],
};

test("retained Codex telemetry contains only validated native usage, with no transcript or parse-error disclosure", () => {
  const events = CODEX.split("\n").map((line) => JSON.parse(line));
  events.unshift({ type: "item.completed", item: { text: "private command and output" } });
  events[2].usage.extra = "private metadata";
  events[2].private = "private prompt";
  const raw = "stderr: private details\n" + events.map((event) => JSON.stringify(event)).join("\n");
  const retained = retainCodexUsage(raw);
  assert.equal(retained.split("\n").length, 2);
  assert.doesNotMatch(retained, /private|item.completed|turn.started|extra/);
  assert.deepEqual(measureReviewTokens(retained, "codex"), measureReviewTokens(CODEX, "codex"));
  for (const text of [
    "",
    '{"private":secret}',
    CODEX.replace('"input_tokens":100', '"input_tokens":"private"'),
  ])
    assert.throws(
      () => retainCodexUsage(text),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /private|secret/);
        return true;
      },
    );
});

test("evaluation counts native provider usage separately without counting intermediate Claude messages twice", () => {
  assert.deepEqual(measureReviewTokens(CODEX, "codex"), {
    input: 120,
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

test("cache telemetry must be observed, nonnegative and consistent with native input totals", () => {
  for (const [provider, text, field] of [
    ["codex", CODEX, "cached_input_tokens"],
    ["claude", CLAUDE, "cache_read_input_tokens"],
    ["claude", CLAUDE, "cache_creation_input_tokens"],
  ]) {
    const events =
      provider === "claude" ? JSON.parse(text) : text.split("\n").map((line) => JSON.parse(line));
    for (const value of [undefined, -1, 1.5]) {
      const changed = structuredClone(events);
      for (const event of changed)
        if (event.usage?.output_tokens !== undefined) event.usage[field] = value;
      const telemetry =
        provider === "claude"
          ? JSON.stringify(changed)
          : changed.map((event) => JSON.stringify(event)).join("\n");
      assert.throws(() => measureReviewTokens(telemetry, provider), /usage is missing/);
    }
  }
  assert.throws(() =>
    measureReviewTokens(
      CODEX.replace('"cached_input_tokens":20', '"cached_input_tokens":101'),
      "codex",
    ),
  );
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
    { adjudications: [{ verdict: "confirmed-target", reason: "Evidence without identity" }] },
    { adjudications: [{ ...TRIAL.adjudications[0], id: " " }] },
    { adjudications: [TRIAL.adjudications[0], TRIAL.adjudications[0]] },
  ])
    assert.throws(() => measureReviewTrial({ ...TRIAL, ...change }, CODEX));
});
