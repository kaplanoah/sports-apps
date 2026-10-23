import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, readRepoFile } from "./repo-files.js";

const SECRET = "PRIVATE_PAYLOAD_credential_prompt_tool_error_url";
const SCRIPT = new URL("worker/review-diagnostics.mjs", REPO_ROOT).pathname;
const SUCCESS = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 6,
  duration_ms: 18400,
};

/** @param {unknown} messages @param {NodeJS.ProcessEnv} [overrides] @param {string} [fileMode] */
function inspectAttempt(messages, overrides = {}, fileMode = "json") {
  const folder = mkdtempSync(join(tmpdir(), "review-diagnostics-"));
  const execution = join(folder, `${SECRET}.json`);
  const summary = join(folder, "summary");
  if (fileMode === "json") writeFileSync(execution, JSON.stringify(messages));
  if (fileMode === "invalid") writeFileSync(execution, `{${SECRET}`);
  if (fileMode === "directory") mkdirSync(execution);
  if (fileMode === "symlink") symlinkSync(SCRIPT, execution);
  if (fileMode === "oversized") {
    writeFileSync(execution, "");
    truncateSync(execution, 64 * 1024 * 1024 + 1);
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: folder,
    env: {
      PATH: process.env.PATH,
      EXECUTION_FILE: execution,
      CLAUDE_OUTPUT_PRESENT: "true",
      REVIEW_ATTEMPT: "find",
      CLAUDE_OUTCOME: "success",
      GITHUB_STEP_SUMMARY: summary,
      ...overrides,
    },
    encoding: "utf8",
  });
  const summaryText = existsSync(summary) ? readFileSync(summary, "utf8") : "";
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(!(result.stdout + summaryText).includes(SECRET), "private payload must never escape");
  return {
    data: JSON.parse(result.stdout.split("\n")[0]),
    summary: summaryText,
    stdout: result.stdout,
  };
}

test("real CLI reports SDK success and output types without validating the review answer", () => {
  const { data, summary } = inspectAttempt([
    { ...SUCCESS, structured_output: { arbitrary: SECRET } },
  ]);
  assert.equal(data.execution_status, "succeeded");
  assert.equal(data.execution_file, "loaded");
  assert.equal(data.result_subtype, "success");
  assert.equal(data.result_is_error, false);
  assert.equal(data.num_turns, 6);
  assert.equal(data.duration_ms, 18400);
  assert.equal(data.action_output_present, true);
  assert.equal(data.result_structured_output, "object");
  assert.match(summary, /Existing review validation decides/);
});

test("is_error wins over success subtype and missing output does not hide execution failure", () => {
  const { data, summary } = inspectAttempt(
    [{ ...SUCCESS, is_error: true, result: SECRET, errors: [SECRET] }],
    { CLAUDE_OUTCOME: "failure", CLAUDE_OUTPUT_PRESENT: "false", REVIEW_ATTEMPT: "across" },
  );
  assert.equal(data.execution_status, "failed");
  assert.equal(data.result_subtype, "success");
  assert.equal(data.result_is_error, true);
  assert.equal(data.action_output_present, false);
  assert.deepEqual(data.assistant_error_codes, []);
  assert.match(summary, /SDK execution: failed/);
  assert.match(summary, /unknown means the cause is not established/);
});

test("known SDK assistant error codes and result failure subtypes remain fixed enums", () => {
  const codes = [
    "authentication_failed",
    "oauth_org_not_allowed",
    "account_on_hold",
    "verification_required",
    "billing_error",
    "rate_limit",
    "overloaded",
    "invalid_request",
    "model_not_found",
    "server_error",
    "unknown",
    "max_output_tokens",
    "cloud_credential_error",
  ];
  for (const subtype of [
    "error_during_execution",
    "error_max_turns",
    "error_max_budget_usd",
    "error_max_structured_output_retries",
  ]) {
    const { data } = inspectAttempt(
      [
        ...codes.map((error) => ({ type: "assistant", error, message: { content: SECRET } })),
        { ...SUCCESS, subtype, is_error: false, errors: [SECRET] },
      ],
      { CLAUDE_OUTCOME: "failure" },
    );
    assert.equal(data.execution_status, "failed");
    assert.equal(data.result_subtype, subtype);
    assert.deepEqual(data.assistant_error_codes, codes.toSorted());
  }
});

test("recovered assistant errors are observations, and the last result decides execution status", () => {
  const { data } = inspectAttempt([
    { type: "assistant", error: "rate_limit" },
    { ...SUCCESS, is_error: true },
    SUCCESS,
  ]);
  assert.equal(data.execution_status, "succeeded");
  assert.deepEqual(data.assistant_error_codes, ["rate_limit"]);
});

test("missing and malformed execution data report unknown and fail soft", () => {
  /** @type {[string, unknown, string][]} */
  const cases = [
    ["missing", [], "missing"],
    ["invalid", [], "invalid_json"],
    ["json", { messages: [] }, "invalid_shape"],
    ["json", [null], "invalid_shape"],
    ["directory", [], "invalid_file"],
    ["symlink", [], "unreadable"],
    ["oversized", [], "oversized"],
    ["json", [], "loaded"],
  ];
  for (const [mode, messages, status] of cases) {
    const { data } = inspectAttempt(messages, { CLAUDE_OUTCOME: "failure" }, mode);
    assert.equal(data.execution_file, status);
    assert.equal(data.execution_status, "unknown");
    assert.equal(data.result_subtype, "unknown");
  }
});

test("result output presence and JSON types stay separate from SDK execution", () => {
  for (const [output, type] of [
    [undefined, "missing"],
    [null, "null"],
    [[], "array"],
    [SECRET, "string"],
    [42, "number"],
    [true, "boolean"],
    [{ arbitrary: SECRET }, "object"],
  ]) {
    const { data } = inspectAttempt([{ ...SUCCESS, structured_output: output }], {
      CLAUDE_OUTPUT_PRESENT: "false",
    });
    assert.equal(data.execution_status, "succeeded");
    assert.equal(data.action_output_present, false);
    assert.equal(data.result_structured_output, type);
  }
});

test("hostile unknown fields and malformed metadata cannot leak through logs or summary", () => {
  const { data } = inspectAttempt(
    [
      { type: "user", message: { content: SECRET } },
      {
        type: "assistant",
        error: SECRET,
        message: { content: [{ type: "tool_result", content: SECRET }] },
      },
      {
        ...SUCCESS,
        subtype: SECRET,
        is_error: SECRET,
        num_turns: SECRET,
        duration_ms: -1,
        structured_output: SECRET,
        result: SECRET,
        errors: [SECRET],
        session_id: SECRET,
        modelUsage: { [SECRET]: SECRET },
      },
    ],
    { REVIEW_ATTEMPT: SECRET, CLAUDE_OUTCOME: SECRET, CLAUDE_OUTPUT_PRESENT: SECRET },
  );
  assert.equal(data.attempt, "unknown");
  assert.equal(data.action_outcome, "unknown");
  assert.equal(data.action_output_present, null);
  assert.equal(data.execution_status, "unknown");
  assert.equal(data.result_subtype, "unknown");
  assert.equal(data.result_is_error, null);
  assert.equal(data.num_turns, null);
  assert.equal(data.duration_ms, null);
  assert.deepEqual(data.assistant_error_codes, ["unknown"]);
  assert.equal(data.result_structured_output, "string");
});

test("an unavailable step summary cannot fail the review and emits only a safe status", () => {
  const { stdout } = inspectAttempt([SUCCESS], { GITHUB_STEP_SUMMARY: "/missing-parent/summary" });
  assert.equal(JSON.parse(stdout.trim().split("\n")[1]).status, "unavailable");
});

test("counts accept bounded whole numbers only", () => {
  for (const value of [-1, 0.5, 1_000_000_001, "6", null]) {
    const { data } = inspectAttempt([{ ...SUCCESS, num_turns: value, duration_ms: value }]);
    assert.equal(data.num_turns, null);
    assert.equal(data.duration_ms, null);
  }
  const { data } = inspectAttempt([{ ...SUCCESS, num_turns: 0, duration_ms: 1_000_000_000 }]);
  assert.equal(data.num_turns, 0);
  assert.equal(data.duration_ms, 1_000_000_000);
});

test("each Claude attempt is immediately followed by always-run trusted diagnostics", () => {
  let attempts = 0;
  for (const file of [
    ".github/workflows/review.yml",
    ".github/workflows/trusted-review-area.yml",
  ]) {
    const steps = readRepoFile(file).split(/^ {6}- /m);
    for (const [index, step] of steps.entries()) {
      if (!step.includes("uses: anthropics/claude-code-action@")) continue;
      attempts++;
      const id = step.match(/^ {8}id: (\w+)$/m)[1];
      const next = steps[index + 1];
      assert.ok(
        next.includes(
          `always() && (steps.${id}.outcome == 'success' || steps.${id}.outcome == 'failure' || steps.${id}.outcome == 'cancelled')`,
        ),
      );
      assert.ok(next.includes("EXECUTION_FILE: ${{ steps." + id + ".outputs.execution_file }}"));
      assert.ok(
        next.includes(
          "CLAUDE_OUTPUT_PRESENT: ${{ steps." + id + ".outputs.structured_output != '' }}",
        ),
      );
      assert.doesNotMatch(next, /STRUCTURED_OUTPUT:/);
      assert.match(next, /continue-on-error: true/);
      assert.match(next, /run: node "\$RUNNER_TEMP\/trusted\/worker\/review-diagnostics\.mjs"/);
      assert.doesNotMatch(next, /GITHUB_OUTPUT|upload-artifact|tee |cat /);
    }
  }
  assert.equal(attempts, 3);
  assert.doesNotMatch(readRepoFile("worker/review-diagnostics.mjs"), /from "(?!node:)/);
});
