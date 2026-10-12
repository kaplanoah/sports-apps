import { requestClaude } from "./claude.js";

// Asking Claude for an answer that is a JSON array. The prompt stays the same from call to call,
// so it's kept in Claude's cache for an hour, which the news reads more often than that by day.

export const NEWS_MODEL = "claude-opus-5-5";
const MAX_ANSWER_TOKENS = 8192;
// A batch of stories takes Claude up to a minute; a call twice that long has stalled.
const CLAUDE_TIMEOUT_MS = 120e3;

/**
 * Claude's answer, as the JSON array in its text.
 * @param {string} text
 * @returns {any[]}
 */
export function readJsonArray(text) {
  const found = text.match(/\[[\s\S]*\]/);
  if (!found) throw new Error("Claude's answer had no JSON array");
  const parsed = JSON.parse(found[0]);
  if (!Array.isArray(parsed)) throw new Error("Claude's answer wasn't a JSON array");
  return parsed;
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string} options.prompt what stays the same from call to call
 * @param {string} options.content this call's stories
 * @returns {Promise<{ answers: any[], usage: Record<string, number> }>}
 */
export async function askClaude({ apiKey, fetchImpl, prompt, content }) {
  const { text, usage } = await requestClaude({
    apiKey,
    fetchImpl,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    request: {
      model: NEWS_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content }],
    },
  });
  return { answers: readJsonArray(text), usage };
}
