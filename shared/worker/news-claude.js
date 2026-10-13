import { requestClaude } from "./claude.js";

// Asking Claude to judge a batch of stories, answering for each in the shape its schema sets. The
// prompt stays the same from call to call, so it's kept in Claude's cache for an hour, which the
// news reads more often than that by day.

export const NEWS_MODEL = "claude-opus-5-5";
const MAX_ANSWER_TOKENS = 8192;
// A batch of stories takes Claude up to a minute; a call twice that long has stalled.
const CLAUDE_TIMEOUT_MS = 120e3;

export const LABELS_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer" },
          keep: { type: "boolean" },
          why: { type: "string" },
          same: { type: "integer" },
          lead: { type: "boolean" },
          teams: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
        required: ["id", "keep", "teams", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string} options.prompt what stays the same from call to call
 * @param {string} options.content this call's stories
 * @returns {Promise<{ answers: any[], usage: Record<string, number> }>}
 */
export async function askClaude({ apiKey, fetchImpl, prompt, content }) {
  const { answer, usage } = await requestClaude({
    apiKey,
    fetchImpl,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    schema: LABELS_SCHEMA,
    request: {
      model: NEWS_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      system: [{ type: "text", text: prompt, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content }],
    },
  });
  return { answers: answer.stories, usage };
}
