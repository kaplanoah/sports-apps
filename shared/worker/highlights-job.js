import { isSameJson } from "../page/compare.js";
import { noteFailure, runWithStatus } from "./job-status.js";

// Keeps each final's highlights, so a game's Highlights section reads only the store. A league's
// clips, its recap video, and its written recap post over the hours after a game, so a game is read
// as the store finds it final and again at each of a few times after its end, and then never
// again. Each run reads a few games, newest first, so a game that just ended comes before the rest
// of the season's, which are read once each, a few at a time. A read the league couldn't finish
// in one run, like one with more stills to check than a run may ask about, saves what it has and
// is read again at the next run, until it's finished, and one that saved what it has with some of
// it unanswered is tried again later, as a read that failed is, each try in a row waiting twice as
// long, so a game that keeps failing never holds back the rest. A league that changes how it reads
// a game's highlights raises its edition, and each final it kept is read once more the same way.
// Each run saves how it went in `highlights/status`.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RUN_DELAY_MS = 2 * MINUTE_MS;
const GAMES_PER_RUN = 4;
const RETRY_MS = 10 * MINUTE_MS;
const MAX_RETRY_MS = 6 * HOUR_MS;
const READ_AFTER_END_MS = [0, HOUR_MS, 3 * HOUR_MS, 12 * HOUR_MS];
const STATUS_KEY = "highlights/status";

/** @typedef {import("./season-store.js").JobContext} JobContext */
/** @typedef {import("./job-status.js").RunContext} RunContext */
/**
 * @typedef {object} HighlightsRead
 * @property {number | null} readAt when the game was last read whole
 * @property {number} triedAt when it was last read, whole or not
 * @property {number} [edition]
 * @property {boolean} [isUnfinished] whether the last read saved what it had with more to read
 * @property {number} [tries] how many reads in a row have failed or had misses
 */

/**
 * What a league's read of a game brings.
 * @typedef {object} GameHighlights
 * @property {any} highlights the game's highlights, or null when the league has no such game
 * @property {boolean} isFinished whether the read brought everything, or has more to read next run
 * @property {boolean} [hasMisses] whether some of what it read didn't answer, to be read again
 *   later as a read that failed is
 */

/**
 * What a league hands the job.
 * @typedef {object} HighlightsLeague
 * @property {(context: JobContext) => Promise<{ season: number, games: any[] } | null>} listFinals
 *   the current season's finals, newest first
 * @property {number} gameLengthMs about how long a game lasts, for one the store didn't see end
 * @property {(context: RunContext, game: any) => Promise<GameHighlights>} readHighlights
 * @property {(id: string) => string} nameKey where the store keeps a game's highlights
 * @property {number} [edition] how the league reads a game's highlights, raised when that changes
 */

/** @param {number} season */
const nameReadsKey = (season) => `highlight-reads:${season}`;

/**
 * When the game ended, in milliseconds.
 * @param {{ start: string, end?: string | null }} game
 * @param {number} gameLengthMs
 */
const findEnd = (game, gameLengthMs) =>
  game.end ? Date.parse(game.end) : Date.parse(game.start) + gameLengthMs;

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

/** @param {HighlightsRead} read */
const chooseRetryWait = (read) => Math.min(RETRY_MS * 2 ** ((read.tries ?? 1) - 1), MAX_RETRY_MS);

/**
 * @param {number} end
 * @param {HighlightsRead | undefined} read
 * @param {object} options
 * @param {number} options.now
 * @param {number} options.edition
 */
function isDue(end, read, { now, edition }) {
  if (!read || read.isUnfinished) return true;
  if (now - read.triedAt < chooseRetryWait(read)) return false;
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
 * saved, and one with misses saves what it brought, and either is tried again later; one that
 * brought what it could so far is finished next run.
 * @param {RunContext} context
 * @param {HighlightsLeague} league
 * @param {any} game
 * @param {HighlightsRead | undefined} read
 * @returns {Promise<HighlightsRead>}
 */
async function keepGame(context, league, game, read) {
  const now = context.now();
  const tried = stampEdition(
    { readAt: read?.readAt ?? null, triedAt: now, tries: (read?.tries ?? 0) + 1 },
    read?.edition,
  );
  const brought = await league.readHighlights(context, game).catch((error) => {
    noteFailure(context.failures, `Reading game ${game.id}'s highlights`, error);
    return undefined;
  });
  if (brought === undefined) return tried;
  const key = league.nameKey(game.id);
  if (brought.highlights && !isSameJson(await context.docs.read(key), brought.highlights))
    await context.docs.write(key, brought.highlights);
  if (brought.isFinished && brought.hasMisses) return tried;
  if (!brought.isFinished)
    return stampEdition(
      { readAt: read?.readAt ?? null, triedAt: now, isUnfinished: true },
      read?.edition,
    );
  return stampEdition({ readAt: now, triedAt: now }, league.edition);
}

/** @param {HighlightsLeague} league */
export function createHighlightsJob(league) {
  /** @param {RunContext} context */
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
      .filter((game) => isDue(findEnd(game, league.gameLengthMs), reads[game.id], when))
      .slice(0, GAMES_PER_RUN);
    for (const game of due) reads[game.id] = await keepGame(context, league, game, reads[game.id]);
    if (!isSameJson(stored, reads)) await context.storage.put(readsKey, reads);
  }

  return {
    chooseDelay: () => RUN_DELAY_MS,
    updateStore: (context) =>
      runWithStatus(context, { statusKey: STATUS_KEY, updateStore: keepHighlights }),
  };
}
