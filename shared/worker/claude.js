import { abortAfter } from "./timeout.js";

// Asking Claude, with the Worker's own API key, and reading the text of its answer.

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {number} options.timeoutMs how long a call takes before it has stalled
 * @param {object} options.request the Messages API's request body
 * @returns {Promise<{ text: string, usage: Record<string, number> }>}
 */
export const requestClaude = ({ apiKey, fetchImpl, timeoutMs, request }) =>
  abortAfter(timeoutMs, async (signal) => {
    const response = await fetchImpl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(request),
      signal,
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(`Claude answered ${response.status}: ${answer?.error?.message ?? ""}`);
    const text = (answer?.content ?? [])
      .filter((/** @type {any} */ block) => block.type === "text")
      .map((/** @type {any} */ block) => block.text)
      .join("");
    return { text, usage: answer?.usage ?? {} };
  });
