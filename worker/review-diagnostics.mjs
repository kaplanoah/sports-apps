import { appendFileSync, closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

const ASSISTANT_ERRORS = [
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
const RESULT_SUBTYPES = [
  "success",
  "error_during_execution",
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
];

/** @param {unknown} value @param {string[]} choices */
const selectValue = (value, choices) => choices.find((choice) => choice === value) ?? "unknown";

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
function nameValueType(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return selectValue(typeof value, ["object", "string", "number", "boolean"]);
}

/** @param {unknown} value */
const readSafeCount = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000
    ? value
    : null;

/** @param {string | undefined} path */
function readExecutionData(path) {
  if (!path) return { status: "missing", messages: [] };
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) return { status: "invalid_file", messages: [] };
    if (stat.size > 64 * 1024 * 1024) return { status: "oversized", messages: [] };
    const text = readFileSync(descriptor, "utf8");
    let messages;
    try {
      messages = JSON.parse(text);
    } catch {
      return { status: "invalid_json", messages: [] };
    }
    if (!Array.isArray(messages) || !messages.every(isObject))
      return { status: "invalid_shape", messages: [] };
    return { status: "loaded", messages };
  } catch (error) {
    return {
      status:
        error && typeof error === "object" && "code" in error && error.code === "ENOENT"
          ? "missing"
          : "unreadable",
      messages: [],
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** @param {any} result */
function nameExecutionStatus(result) {
  if (!result) return "unknown";
  if (result.is_error === true || RESULT_SUBTYPES.slice(1).includes(result.subtype))
    return "failed";
  if (result.subtype === "success" && result.is_error === false) return "succeeded";
  return "unknown";
}

/** @param {NodeJS.ProcessEnv} env */
function collectDiagnostics(env) {
  const execution = readExecutionData(env.EXECUTION_FILE);
  const result = execution.messages.findLast((message) => message.type === "result");
  const assistantErrors = execution.messages
    .filter((message) => message.type === "assistant" && Object.hasOwn(message, "error"))
    .map((message) => selectValue(message.error, ASSISTANT_ERRORS));
  return {
    event: "claude_review_diagnostics",
    version: 1,
    attempt: selectValue(env.REVIEW_ATTEMPT, ["find", "retry", "across"]),
    action_outcome: selectValue(env.CLAUDE_OUTCOME, ["success", "failure", "cancelled", "skipped"]),
    execution_file: execution.status,
    execution_status: nameExecutionStatus(result),
    result_subtype: selectValue(result?.subtype, RESULT_SUBTYPES),
    result_is_error: typeof result?.is_error === "boolean" ? result.is_error : null,
    assistant_error_codes: [...new Set(assistantErrors)].sort(),
    num_turns: readSafeCount(result?.num_turns),
    duration_ms: readSafeCount(result?.duration_ms),
    action_output_present:
      env.CLAUDE_OUTPUT_PRESENT === "true"
        ? true
        : env.CLAUDE_OUTPUT_PRESENT === "false"
          ? false
          : null,
    result_structured_output: nameValueType(result?.structured_output),
  };
}

const diagnostics = collectDiagnostics(process.env);
console.log(JSON.stringify(diagnostics));
try {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Claude review diagnostics: ${diagnostics.attempt}\n\n` +
        `Action: ${diagnostics.action_outcome}; SDK execution: ${diagnostics.execution_status}; ` +
        `result: ${diagnostics.result_subtype}; is_error: ${diagnostics.result_is_error}.\n\n` +
        `Assistant error codes observed: ${diagnostics.assistant_error_codes.join(", ") || "none"}. ` +
        `Execution data: ${diagnostics.execution_file}; ` +
        `Action exported structured output: ${diagnostics.action_output_present}; ` +
        `result structured output type: ${diagnostics.result_structured_output}.\n\n` +
        "Only allowlisted metadata is shown. Error codes observed may have been recovered; " +
        "unknown means the cause is not established. Existing review validation decides whether the answer is valid.\n\n",
    );
} catch {
  console.log('{"event":"claude_review_diagnostics_summary","status":"unavailable"}');
}
