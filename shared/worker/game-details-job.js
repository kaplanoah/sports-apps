import { isSameJson } from "../page/compare.js";
import { listPastSeasons } from "./background-job.js";
import { findSettledTime } from "./feed-keeper.js";
import { noteFailure, runWithStatus } from "./job-status.js";

// Keeps each finished game's details, like its box score, so a sheet opened on a final reads only
// the store. A game is read as the store finds it final, and again until a read comes long enough
// after its end for the league to have caught up on its last plays, and then never again, since a
// finished game doesn't change, or once it has gone a couple of hours without settling. A game
// whose details stand in for the league's own is read every hour after that, until they don't.
// Each run reads a few games: the current season's first, in the order the league lists them, then
// each season's the store keeps from before, newest first. A season before the current one whose
// every final is read is never looked through again, and only a season's finals' reads are kept, so
// the reads never outgrow the season. A league that keeps more of a game raises its version, and
// each final kept before is read once more. A game still to start or being played is left to the
// pages watching it. Each run saves how it went in `games/status`.

const MINUTE_MS = 60 * 1000;
const RUN_DELAY_MS = 2 * MINUTE_MS;
const GAMES_PER_RUN = 4;
const RETRY_MS = 10 * MINUTE_MS;
const GIVE_UP_MS = 2 * 60 * MINUTE_MS;
const STAND_IN_RETRY_MS = 60 * MINUTE_MS;
const STATUS_KEY = "games/status";

/** @typedef {import("./season-store.js").JobContext} JobContext */
/** @typedef {import("./job-status.js").RunContext} RunContext */
/** @typedef {{ firstReadAt: number, readAt: number, isDone: boolean, version?: number }} GameRead */

/**
 * What a league hands the job.
 * @typedef {object} GameDetailsLeague
 * @property {(context: JobContext, season: number) => Promise<any[]>} listFinals a season's finals
 *   whose details the store keeps, in the order to read them
 * @property {(context: JobContext, game: any, stored: any) => Promise<{ details: any, isWhole: boolean }>} readDetails
 *   a game's details, with what's stored standing in for any part that didn't answer, and whether
 *   every part answered as it will stay; throws when none answered
 * @property {(id: string) => string} nameKey where the store keeps a game's details
 * @property {(details: any) => boolean} [isStandIn] whether details kept stand in for the league's
 *   own, so the game is read again past giving up, less often, until they don't
 * @property {number} [version] how much of a game the league keeps, raised when that grows
 */

/**
 * Where the job keeps when each of a season's finals was read.
 * @param {number} season
 */
export const nameReadsKey = (season) => `final-reads:${season}`;

/** @param {number} season */
const nameKeptKey = (season) => `finals-kept:${season}`;

/**
 * A game's last read, unless it was made before its details kept what they keep now.
 * @param {GameRead | undefined} read
 * @param {number} version
 */
const findCurrentRead = (read, version) => ((read?.version ?? 0) === version ? read : undefined);

/**
 * @param {GameRead | undefined} read
 * @param {{ now: number, version: number }} when
 */
function isDue(read, { now, version }) {
  const current = findCurrentRead(read, version);
  if (!current) return true;
  const retryMs = current.readAt - current.firstReadAt >= GIVE_UP_MS ? STAND_IN_RETRY_MS : RETRY_MS;
  return !current.isDone && now - current.readAt >= retryMs;
}

/**
 * Reads a game's details and saves them when they changed, keeping what was saved when the read
 * fails.
 * @param {RunContext} context
 * @param {GameDetailsLeague} league
 * @param {any} game
 * @param {GameRead | undefined} read the game's last read
 * @returns {Promise<GameRead>}
 */
async function keepGame(context, league, game, read) {
  const version = league.version ?? 0;
  const key = league.nameKey(game.id);
  const stored = await context.docs.read(key);
  let kept = stored;
  let isWhole = false;
  try {
    const answer = await league.readDetails(context, game, stored);
    if (!isSameJson(stored, answer.details)) await context.docs.write(key, answer.details);
    kept = answer.details;
    isWhole = answer.isWhole;
  } catch (error) {
    noteFailure(context.failures, `Reading game ${game.id}'s details`, error);
  }
  const now = context.now();
  const firstReadAt = findCurrentRead(read, version)?.firstReadAt ?? now;
  const isSettled = isWhole && now >= findSettledTime(game);
  const isStandIn = !!kept && (league.isStandIn?.(kept) ?? false);
  return {
    firstReadAt,
    readAt: now,
    isDone: isSettled || (!isStandIn && now - firstReadAt >= GIVE_UP_MS),
    version,
  };
}

/**
 * Reads up to `limit` of a season's finals that are due, in the order given, and says how many it
 * read and whether every final's reads are done.
 * @param {RunContext} context
 * @param {GameDetailsLeague} league
 * @param {{ season: number, finals: any[], limit: number }} reading
 */
async function keepSeasonGames(context, league, { season, finals, limit }) {
  const readsKey = nameReadsKey(season);
  /** @type {Record<string, GameRead>} */
  const stored = (await context.storage.get(readsKey)) ?? {};
  const reads = Object.fromEntries(
    finals.filter((game) => stored[game.id]).map((game) => [game.id, stored[game.id]]),
  );
  const when = { now: context.now(), version: league.version ?? 0 };
  const due = finals.filter((game) => isDue(reads[game.id], when)).slice(0, limit);
  for (const game of due) reads[game.id] = await keepGame(context, league, game, reads[game.id]);
  if (!isSameJson(stored, reads)) await context.storage.put(readsKey, reads);
  const isDone = finals.every((game) => findCurrentRead(reads[game.id], when.version)?.isDone);
  return { readCount: due.length, isDone };
}

/**
 * The seasons before the current one that the store keeps, newest first, but those whose every
 * final is already read.
 * @param {JobContext} context
 * @param {number} current
 * @param {number} version
 */
async function listUnkeptPastSeasons(context, current, version) {
  const years = await listPastSeasons(context.docs, current);
  const kept = await Promise.all(years.map((year) => context.storage.get(nameKeptKey(year))));
  return years.filter((_, index) => kept[index] !== version);
}

/**
 * @param {RunContext} context
 * @param {GameDetailsLeague} league
 */
async function keepFinishedGames(context, league) {
  const current = (await context.docs.read("live/current"))?.season;
  if (!Number.isInteger(current)) return;
  const version = league.version ?? 0;
  const finals = await league.listFinals(context, current);
  const { readCount } = await keepSeasonGames(context, league, {
    season: current,
    finals,
    limit: GAMES_PER_RUN,
  });
  let left = GAMES_PER_RUN - readCount;
  for (const year of await listUnkeptPastSeasons(context, current, version)) {
    if (!left) return;
    const pastFinals = await league.listFinals(context, year);
    const past = await keepSeasonGames(context, league, {
      season: year,
      finals: pastFinals,
      limit: left,
    });
    if (past.isDone && pastFinals.length) await context.storage.put(nameKeptKey(year), version);
    left -= past.readCount;
  }
}

/**
 * @param {GameDetailsLeague} league
 * @returns {import("./season-store.js").BackgroundJob}
 */
export const createGameDetailsJob = (league) => ({
  chooseDelay: () => RUN_DELAY_MS,
  updateStore: (context) =>
    runWithStatus(context, {
      statusKey: STATUS_KEY,
      updateStore: (runContext) => keepFinishedGames(runContext, league),
    }),
});
