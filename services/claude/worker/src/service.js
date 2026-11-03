import { MISSING_CLAUDE_KEY } from "../../../../shared/worker/claude.js";
import { abortAfter } from "../../../../shared/worker/timeout.js";

// Asking Claude, with the service's own API key, for an answer in the shape a JSON schema sets,
// which the API holds Claude's answer to, so no answer has to be picked out of its prose. Each app
// asks it by its CLAUDE binding (the shared claude.js).

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** @typedef {import("../../../../shared/worker/claude.js").ClaudeRequest} ClaudeRequest */
/** @typedef {import("../../../../shared/worker/claude.js").ClaudeResult} ClaudeResult */

/** @param {any} env */
const readKey = (env) =>
  typeof env.ANTHROPIC_API_KEY === "string" ? env.ANTHROPIC_API_KEY.trim() : "";

/**
 * The text of Claude's answer, once it finished it. An answer cut short or refused may not match
 * the schema.
 * @param {any} answer
 */
function readFinishedText(answer) {
  if (answer?.stop_reason !== "end_turn")
    throw new Error(`Claude stopped without finishing: ${answer?.stop_reason ?? "no reason"}`);
  return (answer.content ?? [])
    .filter((/** @type {any} */ block) => block.type === "text")
    .map((/** @type {any} */ block) => block.text)
    .join("");
}

/**
 * @param {string} apiKey
 * @param {typeof fetch} fetchImpl
 * @param {ClaudeRequest} options
 * @returns {Promise<ClaudeResult>}
 */
const askMessages = (apiKey, fetchImpl, { timeoutMs, request, schema }) =>
  abortAfter(timeoutMs, async (signal) => {
    const response = await fetchImpl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        ...request,
        output_config: { ...request.output_config, format: { type: "json_schema", schema } },
      }),
      signal,
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok)
      return {
        problem: `Claude answered ${response.status}: ${answer?.error?.message ?? ""}`,
        status: response.status,
      };
    return { answer: JSON.parse(readFinishedText(answer)), usage: answer.usage ?? {} };
  });

/**
 * A problem's text with the key taken out, should anything along the way have repeated it.
 * @param {string} text
 * @param {string} apiKey
 */
const hideKey = (text, apiKey) => text.replaceAll(apiKey, "<key>");

/**
 * @param {any} env
 * @param {typeof fetch} [fetchImpl]
 */
export function createClaudeService(env, fetchImpl = fetch) {
  async function readHealth() {
    const release = env.VERSION?.tag ?? null;
    return readKey(env)
      ? { ok: true, release }
      : { ok: false, release, problem: MISSING_CLAUDE_KEY };
  }

  const readConfig = async () => ({ configured: Boolean(readKey(env)) });

  /**
   * @param {ClaudeRequest} options
   * @returns {Promise<ClaudeResult>}
   */
  async function requestClaude(options) {
    const apiKey = readKey(env);
    if (!apiKey) return { problem: `The claude service has ${MISSING_CLAUDE_KEY}` };
    try {
      const result = await askMessages(apiKey, fetchImpl, options);
      return "problem" in result ? { ...result, problem: hideKey(result.problem, apiKey) } : result;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      return { problem: hideKey(text, apiKey) };
    }
  }

  return { readHealth, readConfig, requestClaude };
}
