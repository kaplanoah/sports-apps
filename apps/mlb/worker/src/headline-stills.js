import { requestClaude } from "../../../../shared/worker/claude.js";
import { noteFailure } from "../../../../shared/worker/job-status.js";
import { isSameJson } from "../../../../shared/page/compare.js";

// Which of MLB's stills for a game's plays have a headline laid over them, like "WAVE IT
// GOODBYE!", which the sheet shows in place of the moment. Claude looks at each still once, and
// the store keeps its answers for the game, so a game read again asks only about a still that's
// new. A read asks about only a few stills, since Cloudflare caps the requests a Worker makes in
// one run and a game has dozens, so a game with more isn't finished, and the store's job reads it
// again next run for the next few. A still Claude doesn't answer for shows as MLB's own until it
// does, and is asked about again a few minutes later, as the job tries again a read that failed,
// until it has gone unanswered a few times, when it counts as clean. Claude turning the Worker's
// key away isn't a still going unanswered, so a key that stopped working never clears one. Without
// the Worker's API key, each still counts as clean. The answers are kept for the current season's
// games only, since the job reads no other season's.

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
/** @typedef {import("../../../../shared/worker/job-status.js").RunContext} RunContext */

// How many reads a still may go unanswered before it counts as clean.
export const MAX_STILL_TRIES = 3;
// Claude turning the Worker's key away, which says nothing about the still.
const REFUSED_KEY_STATUSES = new Set([401, 403]);
const CHECKS_PREFIX = "headline-stills:";
const MISSES_PREFIX = "headline-still-misses:";
// The season whose games' answers are kept.
const SEASON_KEY = "headline-stills-season";

/**
 * A game of a season, as its stills' answers are kept.
 * @typedef {{ season: number, id: string }} StillsGame
 */

/** @param {StillsGame} game */
const nameChecksKey = ({ season, id }) => `${CHECKS_PREFIX}${season}:${id}`;
/** @param {StillsGame} game */
const nameMissesKey = ({ season, id }) => `${MISSES_PREFIX}${season}:${id}`;

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
 * Claude's answer for each still it answered for, the stills it didn't, and those it turned away
 * for the Worker's key, with the first error.
 * @param {object} options
 * @param {string} options.apiKey
 * @param {typeof fetch} options.fetchImpl
 * @param {string[]} stills
 */
async function checkStills({ apiKey, fetchImpl }, stills) {
  const results = await Promise.allSettled(
    stills.map((still) => hasHeadline({ apiKey, fetchImpl, still })),
  );
  /** @type {Record<string, boolean>} */
  const answers = {};
  /** @type {string[]} */
  const missed = [];
  /** @type {string[]} */
  const refused = [];
  /** @type {unknown} */
  let firstError;
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      answers[stills[index]] = result.value;
      continue;
    }
    firstError ??= result.reason;
    const isKeyRefused = REFUSED_KEY_STATUSES.has(result.reason?.status);
    (isKeyRefused ? refused : missed).push(stills[index]);
  }
  return { answers, missed, refused, firstError };
}

/**
 * The stills without an answer that have gone unanswered least often: this round's, which a read
 * asks about the first few of, so each is asked about once a round.
 * @param {string[]} stills
 * @param {Record<string, boolean>} kept
 * @param {Record<string, number>} missed
 */
function listRoundStills(stills, kept, missed) {
  const unanswered = stills.filter((still) => !Object.hasOwn(kept, still));
  const fewest = Math.min(...unanswered.map((still) => missed[still] ?? 0));
  return unanswered.filter((still) => (missed[still] ?? 0) === fewest);
}

/**
 * How many reads each still without an answer has gone unanswered, counting this one.
 * @param {string[]} stills
 * @param {{ answered: Record<string, boolean>, missed: Record<string, number>, missedNow: string[] }} read
 * @returns {Record<string, number>}
 */
const countMisses = (stills, { answered, missed, missedNow }) =>
  Object.fromEntries(
    stills
      .filter((still) => !Object.hasOwn(answered, still))
      .map(
        (still) =>
          /** @type {const} */ ([
            still,
            (missed[still] ?? 0) + (missedNow.includes(still) ? 1 : 0),
          ]),
      )
      .filter(([, count]) => count > 0),
  );

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
 * been asked about this round, and whether any went unanswered, which the run's failures name. A
 * still that has gone unanswered too often is kept as clean. A read Claude turned the key away for
 * is tried again later, as one that went unanswered is, without counting against its stills.
 * @param {RunContext} context
 * @param {StillsGame} game
 * @param {string[]} stills
 * @returns {Promise<{ withHeadlines: Set<string>, isFinished: boolean, hasMisses: boolean }>}
 */
export async function findHeadlineStills(context, game, stills) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { withHeadlines: new Set(), isFinished: true, hasMisses: false };
  /** @type {Record<string, boolean>} */
  const kept = (await context.storage.get(nameChecksKey(game))) ?? {};
  /** @type {Record<string, number>} */
  const missed = (await context.storage.get(nameMissesKey(game))) ?? {};
  const round = listRoundStills(stills, kept, missed);
  const asked = round.slice(0, STILLS_PER_READ);
  const checked = await checkStills({ apiKey, fetchImpl: context.fetchImpl }, asked);
  const unanswered = checked.missed.length + checked.refused.length;
  if (unanswered)
    noteFailure(
      context.failures,
      `Asking Claude about ${unanswered} of game ${game.id}'s stills`,
      checked.firstError,
    );
  const answered = { ...kept, ...checked.answers };
  const counted = countMisses(stills, { answered, missed, missedNow: checked.missed });
  const isGivenUp = (/** @type {string} */ still) => counted[still] >= MAX_STILL_TRIES;
  const checks = Object.fromEntries(
    stills
      .filter((still) => Object.hasOwn(answered, still) || isGivenUp(still))
      .map((still) => [still, answered[still] ?? false]),
  );
  const misses = Object.fromEntries(Object.entries(counted).filter(([still]) => !isGivenUp(still)));
  await saveWhenChanged(context.storage, nameChecksKey(game), { before: kept, after: checks });
  await saveWhenChanged(context.storage, nameMissesKey(game), { before: missed, after: misses });
  const isKeyRefused = checked.refused.length > 0;
  return {
    withHeadlines: new Set(stills.filter((still) => checks[still])),
    isFinished: isKeyRefused || round.length <= STILLS_PER_READ,
    hasMisses: isKeyRefused || Object.keys(misses).length > 0,
  };
}

/**
 * Where the answers kept under `key` belong, by the season its name holds, or, for answers kept
 * under a game alone, which every season before had, under the current season.
 * @param {string} prefix
 * @param {string} key
 * @param {number} current
 */
function placeKeptStills(prefix, key, current) {
  const [season, id] = key.slice(prefix.length).split(":");
  if (id === undefined) return { isCurrent: true, key: `${prefix}${current}:${season}` };
  return { isCurrent: season === String(current), key };
}

/**
 * Forgets the answers kept for any season but the current one, by the season each key names,
 * once the season changes.
 * @param {JobContext} context
 * @param {number} current the current season
 */
export async function forgetOtherSeasonsStills({ storage }, current) {
  if ((await storage.get(SEASON_KEY)) === current) return;
  for (const prefix of [CHECKS_PREFIX, MISSES_PREFIX])
    for (const [key, answers] of await storage.list(prefix)) {
      const placed = placeKeptStills(prefix, key, current);
      if (placed.isCurrent && placed.key !== key) await storage.put(placed.key, answers);
      if (!placed.isCurrent || placed.key !== key) await storage.delete(key);
    }
  await storage.put(SEASON_KEY, current);
}
