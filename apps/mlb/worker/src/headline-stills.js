import { requestClaude } from "../../../../shared/worker/claude.js";
import { describeError } from "../../../../shared/worker/responses.js";
import { isSameJson } from "../../../../shared/page/compare.js";

// Which of MLB's stills for a game's plays have a headline laid over them, like "WAVE IT
// GOODBYE!", which the sheet shows in place of the moment. Claude looks at each still once, and
// the store keeps its answers for the game, so a game read again asks only about a still that's
// new. A read asks about only a few stills, since Cloudflare caps the requests a Worker makes in
// one run and a game has dozens, so a game with more isn't finished, and the store's job reads it
// again next run for the next few. A still Claude doesn't answer for shows as MLB's own until it
// does, and is asked about again a few minutes later, as the job tries again a read that failed,
// until it has gone unanswered a few times, when it counts as clean. Without the Worker's API key, each still counts as clean. The
// answers are kept for the current season's games only, since the job reads no other season's.

export const STILL_MODEL = "claude-haiku-5-5";
const MAX_ANSWER_TOKENS = 1024;
export const STILLS_PER_READ = 5;
// One small picture and a one-field answer; a call this long has stalled.
const CLAUDE_TIMEOUT_MS = 30e3;
const PROMPT = `You judge baseball highlight thumbnails. Has a headline or title graphic been added on top of the picture by an editor, such as big words like "WAVE IT GOODBYE!" or "HOW DID HE DO THAT!?", a player's name in large type, a stat card, or a designed title card? Answer with headline set to true or false.

Set headline to false when the only words are part of the scene itself: ballpark signs and ads, uniforms, scoreboards in the stadium, or a small TV score box in a corner.`;
export const STILL_SCHEMA = {
  type: "object",
  properties: { headline: { type: "boolean" } },
  required: ["headline"],
  additionalProperties: false,
};

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */

// How many reads a still may go unanswered before it counts as clean.
export const MAX_STILL_TRIES = 3;
const CHECKS_PREFIX = "headline-stills:";
const MISSES_PREFIX = "headline-still-misses:";
// The season whose games' answers are kept.
const SEASON_KEY = "headline-stills-season";

/** @param {string} id */
const nameChecksKey = (id) => `${CHECKS_PREFIX}${id}`;
/** @param {string} id */
const nameMissesKey = (id) => `${MISSES_PREFIX}${id}`;

/**
 * Whether Claude finds a headline on the still.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string} options.still the still's address
 */
export async function hasHeadline({ apiKey, fetchImpl, still }) {
  const { answer } = await requestClaude({
    apiKey,
    fetchImpl,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    schema: STILL_SCHEMA,
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
  return answer.headline;
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
 * The first few stills without an answer of those that have gone unanswered least often, so each
 * is asked about once a round.
 * @param {string[]} stills
 * @param {Record<string, boolean>} kept
 * @param {Record<string, number>} missed
 */
function chooseStillsToAsk(stills, kept, missed) {
  const unanswered = stills.filter((still) => !Object.hasOwn(kept, still));
  const fewest = Math.min(...unanswered.map((still) => missed[still] ?? 0));
  return unanswered.filter((still) => (missed[still] ?? 0) === fewest).slice(0, STILLS_PER_READ);
}

/**
 * How many reads each still without an answer has gone unanswered, counting this one.
 * @param {string[]} stills
 * @param {{ answered: Record<string, boolean>, missed: Record<string, number>, asked: string[] }} read
 * @returns {Record<string, number>}
 */
const countMisses = (stills, { answered, missed, asked }) =>
  Object.fromEntries(
    stills
      .filter((still) => !Object.hasOwn(answered, still))
      .map(
        (still) =>
          /** @type {const} */ ([still, (missed[still] ?? 0) + (asked.includes(still) ? 1 : 0)]),
      )
      .filter(([, count]) => count > 0),
  );

/**
 * Whether every still without an answer has gone unanswered as often as each other one, and at
 * least once, so none is still waiting to be asked about this time round.
 * @param {string[]} stills
 * @param {{ checks: Record<string, boolean>, misses: Record<string, number> }} answers
 */
function isRoundAsked(stills, { checks, misses }) {
  const counts = new Set(
    stills.filter((still) => !Object.hasOwn(checks, still)).map((still) => misses[still] ?? 0),
  );
  return counts.size === 0 || (counts.size === 1 && !counts.has(0));
}

/**
 * @param {JobContext["storage"]} storage
 * @param {string} key
 * @param {{ before: Record<string, any>, after: Record<string, any> }} change
 */
async function saveWhenChanged(storage, key, { before, after }) {
  if (isSameJson(before, after)) return;
  if (Object.keys(after).length) await storage.put(key, after);
  else await storage.delete(key);
}

/**
 * The game's stills that have a headline on them, asking Claude only about the first few it hasn't
 * answered for, and keeping its answers for the game's stills of now, with whether every still has
 * been asked about this round, and whether any went unanswered. A still that has gone unanswered
 * too often is kept as clean.
 * @param {JobContext} context
 * @param {string} id the game's
 * @param {string[]} stills
 * @returns {Promise<{ withHeadlines: Set<string>, isFinished: boolean, hasMisses: boolean }>}
 */
export async function findHeadlineStills(context, id, stills) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { withHeadlines: new Set(), isFinished: true, hasMisses: false };
  /** @type {Record<string, boolean>} */
  const kept = (await context.storage.get(nameChecksKey(id))) ?? {};
  /** @type {Record<string, number>} */
  const missed = (await context.storage.get(nameMissesKey(id))) ?? {};
  const asked = chooseStillsToAsk(stills, kept, missed);
  const answered = {
    ...kept,
    ...(await checkStills({ apiKey, fetchImpl: context.fetchImpl }, id, asked)),
  };
  const counted = countMisses(stills, { answered, missed, asked });
  const isGivenUp = (/** @type {string} */ still) => counted[still] >= MAX_STILL_TRIES;
  const checks = Object.fromEntries(
    stills
      .filter((still) => Object.hasOwn(answered, still) || isGivenUp(still))
      .map((still) => [still, answered[still] ?? false]),
  );
  const misses = Object.fromEntries(Object.entries(counted).filter(([still]) => !isGivenUp(still)));
  await saveWhenChanged(context.storage, nameChecksKey(id), { before: kept, after: checks });
  await saveWhenChanged(context.storage, nameMissesKey(id), { before: missed, after: misses });
  return {
    withHeadlines: new Set(stills.filter((still) => checks[still])),
    isFinished: isRoundAsked(stills, { checks, misses }),
    hasMisses: Object.keys(misses).length > 0,
  };
}

/**
 * Forgets the answers kept for any game but the current season's finals, once the season changes.
 * @param {JobContext} context
 * @param {{ season: number, games: { id: string }[] }} finals the current season's
 */
export async function forgetOtherSeasonsStills({ storage }, { season, games }) {
  if ((await storage.get(SEASON_KEY)) === season) return;
  const ids = new Set(games.map((game) => String(game.id)));
  for (const prefix of [CHECKS_PREFIX, MISSES_PREFIX])
    for (const key of (await storage.list(prefix)).keys())
      if (!ids.has(key.slice(prefix.length))) await storage.delete(key);
  await storage.put(SEASON_KEY, season);
}
