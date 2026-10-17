import { abortAfter } from "./timeout.js";

// Asking Claude, with the Worker's own API key, for an answer in the shape a JSON schema sets,
// which the API holds Claude's answer to, so no answer has to be picked out of its prose.

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

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
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {number} options.timeoutMs how long a call takes before it has stalled
 * @param {{ output_config?: object } & Record<string, unknown>} options.request the Messages API's request body
 * @param {object} options.schema the JSON schema Claude's answer follows
 * @returns {Promise<{ answer: any, usage: Record<string, number> }>}
 */
export const requestClaude = ({ apiKey, fetchImpl, timeoutMs, request, schema }) =>
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
      throw Object.assign(
        new Error(`Claude answered ${response.status}: ${answer?.error?.message ?? ""}`),
        { status: response.status },
      );
    return { answer: JSON.parse(readFinishedText(answer)), usage: answer.usage ?? {} };
  });
