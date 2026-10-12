import { requestClaude } from "../../../../shared/worker/claude.js";
import { describeError } from "../../../../shared/worker/responses.js";
import { isSameJson } from "../../../../shared/page/compare.js";

// Which of MLB's stills for a game's plays have a headline laid over them, like "WAVE IT
// GOODBYE!", which the sheet shows in place of the moment. Claude looks at each still once, and
// the store keeps its answers for the game, so a game read again asks only about a still that's
// new. When Claude doesn't answer for a still, the game's read fails, keeping the answers it got,
// so the store's job reads it again soon. Without the Worker's API key, each still counts as clean.

export const STILL_MODEL = "claude-haiku-5-5";
const MAX_ANSWER_TOKENS = 1024;
// One small picture and a one-word answer; a call this long has stalled.
const CLAUDE_TIMEOUT_MS = 30e3;
const PROMPT = `You judge baseball highlight thumbnails. Has a headline or title graphic been added on top of the picture by an editor, such as big words like "WAVE IT GOODBYE!" or "HOW DID HE DO THAT!?", a player's name in large type, a stat card, or a designed title card?

Answer "no" when the only words are part of the scene itself: ballpark signs and ads, uniforms, scoreboards in the stadium, or a small TV score box in a corner.

Answer with one word: yes or no.`;

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */

/** @param {string} id */
const nameChecksKey = (id) => `headline-stills:${id}`;

/**
 * Whether Claude finds a headline on the still.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string} options.still the still's address
 */
export async function hasHeadline({ apiKey, fetchImpl, still }) {
  const { text } = await requestClaude({
    apiKey,
    fetchImpl,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    request: {
      model: STILL_MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      output_config: { effort: "low" },
      system: PROMPT,
      messages: [
        { role: "user", content: [{ type: "image", source: { type: "url", url: still } }] },
      ],
    },
  });
  const answer = /^\W*(yes|no)\b/i.exec(text)?.[1]?.toLowerCase();
  if (!answer) throw new Error(`Claude answered neither yes nor no: ${text.slice(0, 80)}`);
  return answer === "yes";
}

/**
 * Asks Claude about each still, and leaves out a still it couldn't answer for.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string} id the game's
 * @param {string[]} stills
 * @returns {Promise<Record<string, boolean>>}
 */
async function checkStills({ apiKey, fetchImpl }, id, stills) {
  const answers = await Promise.all(
    stills.map((still) =>
      hasHeadline({ apiKey, fetchImpl, still }).catch((error) => {
        console.error(
          `Checking a still of game ${id} for a headline failed: ${describeError(error)}`,
        );
        return null;
      }),
    ),
  );
  return Object.fromEntries(
    stills.flatMap((still, index) => (answers[index] === null ? [] : [[still, answers[index]]])),
  );
}

/**
 * The game's stills that have a headline on them, asking Claude only about the ones it hasn't
 * seen, and keeping the answers for the game's stills of now. Throws when Claude didn't answer for
 * every still, once the answers it gave are kept.
 * @param {JobContext} context
 * @param {string} id the game's
 * @param {string[]} stills
 * @returns {Promise<Set<string>>}
 */
export async function findHeadlineStills(context, id, stills) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Set();
  const key = nameChecksKey(id);
  /** @type {Record<string, boolean>} */
  const kept = (await context.storage.get(key)) ?? {};
  const unchecked = stills.filter((still) => !Object.hasOwn(kept, still));
  const fresh = await checkStills({ apiKey, fetchImpl: context.fetchImpl }, id, unchecked);
  const checks = Object.fromEntries(
    stills
      .filter((still) => Object.hasOwn(kept, still) || Object.hasOwn(fresh, still))
      .map((still) => [still, fresh[still] ?? kept[still]]),
  );
  if (!isSameJson(kept, checks)) await context.storage.put(key, checks);
  const unanswered = stills.length - Object.keys(checks).length;
  if (unanswered > 0)
    throw new Error(`Claude didn't answer for ${unanswered} of game ${id}'s stills`);
  return new Set(stills.filter((still) => checks[still]));
}
