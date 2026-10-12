import { isSameJson } from "../page/compare.js";

// Keeps each final's highlights, so a game's Highlights section reads only the store. A league's
// clips, its recap video, and its written recap post over the hours after a game, so a game is read
// as the store finds it final and again at each of a few times after its end, and then never
// again. Each run reads a few games, newest first, so a game that just ended comes before the rest
// of the season's, which are read once each, a few at a time. A league that changes how it reads a
// game's highlights raises its edition, and each final it kept is read once more the same way.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 2 * MINUTE_MS;
const GAMES_PER_RUN = 4;
const RETRY_MS = 10 * MINUTE_MS;
const READ_AFTER_END_MS = [0, HOUR_MS, 3 * HOUR_MS, 12 * HOUR_MS];

/** @typedef {import("./season-store.js").JobContext} JobContext */
/** @typedef {{ readAt: number | null, triedAt: number, edition?: number }} HighlightsRead */

/**
 * What a league hands the job.
 * @typedef {object} HighlightsLeague
 * @property {(context: JobContext) => Promise<{ season: number, games: any[] } | null>} listFinals
 *   the current season's finals, newest first
 * @property {(game: any) => number} findEnd when the game ended, in milliseconds
 * @property {(context: JobContext, game: any) => Promise<any>} readHighlights the game's
 *   highlights, or null when the league has no such game
 * @property {(id: string) => string} nameKey where the store keeps a game's highlights
 * @property {number} [edition] how the league reads a game's highlights, raised when that changes
 */

/** @param {number} season */
const nameReadsKey = (season) => `highlight-reads:${season}`;

/**
 * The next time the game is due a read after the one at `readAt`, or null once its last is done.
 * @param {number} end
 * @param {number | null} readAt
 */
function findNextRead(end, readAt) {
  if (readAt === null) return end;
  const next = READ_AFTER_END_MS.map((offset) => end + offset).find((at) => at > readAt);
  return next ?? null;
}

/**
 * @param {number} end
 * @param {HighlightsRead | undefined} read
 * @param {object} options
 * @param {number} options.now
 * @param {number} options.edition
 */
function isDue(end, read, { now, edition }) {
  if (!read) return true;
  if (now - read.triedAt < RETRY_MS) return false;
  if ((read.edition ?? 0) !== edition) return true;
  const next = findNextRead(end, read.readAt);
  return next !== null && now >= next;
}

/**
 * A league that never raised its edition keeps none in its reads.
 * @param {HighlightsRead} read
 * @param {number | undefined} edition
 * @returns {HighlightsRead}
 */
const stampEdition = (read, edition) => (edition ? { ...read, edition } : read);

/**
 * Reads a game's highlights and saves them when they changed. A read that fails keeps what was
 * saved and is tried again later.
 * @param {JobContext} context
 * @param {HighlightsLeague} league
 * @param {any} game
 * @param {HighlightsRead | undefined} read
 * @returns {Promise<HighlightsRead>}
 */
async function keepGame(context, league, game, read) {
  const now = context.now();
  const highlights = await league.readHighlights(context, game).catch(() => undefined);
  if (highlights === undefined)
    return stampEdition({ readAt: read?.readAt ?? null, triedAt: now }, read?.edition);
  const key = league.nameKey(game.id);
  if (highlights && !isSameJson(await context.docs.read(key), highlights))
    await context.docs.write(key, highlights);
  return stampEdition({ readAt: now, triedAt: now }, league.edition);
}

/** @param {HighlightsLeague} league */
export function createHighlightsJob(league) {
  /** @param {JobContext} context */
  async function keepHighlights(context) {
    const finals = await league.listFinals(context);
    if (!finals) return;
    const readsKey = nameReadsKey(finals.season);
    /** @type {Record<string, HighlightsRead>} */
    const stored = (await context.storage.get(readsKey)) ?? {};
    const reads = Object.fromEntries(
      finals.games.filter((game) => stored[game.id]).map((game) => [game.id, stored[game.id]]),
    );
    const when = { now: context.now(), edition: league.edition ?? 0 };
    const due = finals.games
      .filter((game) => isDue(league.findEnd(game), reads[game.id], when))
      .slice(0, GAMES_PER_RUN);
    for (const game of due) reads[game.id] = await keepGame(context, league, game, reads[game.id]);
    if (!isSameJson(stored, reads)) await context.storage.put(readsKey, reads);
  }

  return { chooseDelay: () => RUN_DELAY_MS, run: keepHighlights };
}
