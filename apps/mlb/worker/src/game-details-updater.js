import { isSameJson } from "#shared/compare.js";
import { nameScheduleCollection } from "../../page/js/snapshot.js";
import { listSlateGames } from "../../page/js/slate.js";
import { fetchBoxScore, nameGameDetailsKey } from "./box-score.js";
import { listPastSeasons } from "../../../../shared/worker/background-job.js";
import { findSettledTime } from "../../../../shared/worker/feed-keeper.js";

// Keeps each finished game's box score, so a sheet opened on a final reads only the store. A game
// is read as the store finds it final, and again once a read comes long enough after its end for
// MLB to have caught up on its last plays, and then never again, since a finished game doesn't
// change. Each run reads a few games: the current season's slate first, the latest to end first,
// then the rest of its games, newest first, then each season's the store keeps from before. A
// game still to start or being played is left to the pages watching it (watched-games.js).

const MINUTE_MS = 60 * 1000;
const RUN_DELAY_MS = 2 * MINUTE_MS;
const GAMES_PER_RUN = 4;
const RETRY_MS = 10 * MINUTE_MS;
// A game whose box score hasn't settled this long after its first read is let go.
const GIVE_UP_MS = 2 * 60 * MINUTE_MS;
// Raised whenever a box score keeps more of MLB's feed, so each final kept before is read again.
const BOX_SCORE_VERSION = 3;

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/** @typedef {{ firstReadAt: number, readAt: number, isDone: boolean, version: number }} GameRead */

/** @param {number} season */
const nameReadsKey = (season) => `final-reads:${season}`;

// A season before the current one whose every final is read is never looked through again, until
// a box score keeps more.
/** @param {number} season */
const nameKeptKey = (season) => `finals-kept:${season}`;

// The All-Star Game's teams aren't clubs, so it has no sheet.
/** @param {any} game */
const isFinal = (game) => game.state === "final" && !game.allStar;

/** @param {any} slate */
const listSlateFinals = (slate) =>
  listSlateGames(slate)
    .filter(isFinal)
    .sort((first, second) => Date.parse(second.end) - Date.parse(first.end));

/**
 * A season's finals from the store's schedule, newest first.
 * @param {JobContext["docs"]} docs
 * @param {number} season
 */
async function listScheduledFinals(docs, season) {
  const months = await docs.list(nameScheduleCollection(season));
  return months
    .flatMap((/** @type {any} */ month) => month.games ?? [])
    .filter(isFinal)
    .sort((first, second) => Date.parse(second.start) - Date.parse(first.start));
}

/**
 * Each of a season's finals once, in the order given.
 * @param {any[]} games
 */
const keepFirstOfEach = (games) => [...new Map(games.map((game) => [game.id, game])).values()];

/**
 * A game's last read, unless it was made before its box score kept what it keeps now.
 * @param {GameRead | undefined} read
 */
const findCurrentRead = (read) => (read?.version === BOX_SCORE_VERSION ? read : undefined);

/**
 * @param {GameRead | undefined} read
 * @param {number} now
 */
function isDue(read, now) {
  const current = findCurrentRead(read);
  return !current || (!current.isDone && now - current.readAt >= RETRY_MS);
}

/**
 * Reads a game's box score and saves it when it changed, keeping what was saved when the read fails.
 * @param {JobContext} context
 * @param {any} game
 * @param {GameRead | undefined} read the game's last read
 * @returns {Promise<GameRead>}
 */
async function keepGame(context, game, read) {
  const key = nameGameDetailsKey(game.id);
  const boxScore = await fetchBoxScore(context.fetchImpl, game.id).catch(() => null);
  if (boxScore && !isSameJson(await context.docs.read(key), boxScore))
    await context.docs.write(key, boxScore);
  const now = context.now();
  const firstReadAt = findCurrentRead(read)?.firstReadAt ?? now;
  const isSettled = boxScore?.state === "final" && now >= findSettledTime(game);
  const isDone = isSettled || now - firstReadAt >= GIVE_UP_MS;
  return { firstReadAt, readAt: now, isDone, version: BOX_SCORE_VERSION };
}

/**
 * Reads up to `limit` of a season's finals that are due, in the order given, and says how many it
 * read and whether every final's reads are done. Only the finals' reads are kept, so the list
 * never outgrows the season.
 * @param {JobContext} context
 * @param {number} season
 * @param {any[]} finals
 * @param {number} limit
 */
async function keepSeasonGames(context, season, finals, limit) {
  const readsKey = nameReadsKey(season);
  /** @type {Record<string, GameRead>} */
  const stored = (await context.storage.get(readsKey)) ?? {};
  const reads = Object.fromEntries(
    finals.filter((game) => stored[game.id]).map((game) => [game.id, stored[game.id]]),
  );
  const now = context.now();
  const due = finals.filter((game) => isDue(reads[game.id], now)).slice(0, limit);
  for (const game of due) reads[game.id] = await keepGame(context, game, reads[game.id]);
  if (!isSameJson(stored, reads)) await context.storage.put(readsKey, reads);
  const isDone = finals.every((game) => findCurrentRead(reads[game.id])?.isDone);
  return { readCount: due.length, isDone };
}

/**
 * The seasons before the current one that the store keeps, newest first, but those whose every
 * final is already read.
 * @param {JobContext} context
 * @param {number} current
 */
async function listUnkeptPastSeasons(context, current) {
  const years = await listPastSeasons(context.docs, current);
  const kept = await Promise.all(years.map((year) => context.storage.get(nameKeptKey(year))));
  return years.filter((_, index) => kept[index] !== BOX_SCORE_VERSION);
}

/**
 * The current season's finals, each once: the slate's first, the latest to end first, then the
 * rest of its games, newest first.
 * @param {JobContext} context
 */
export async function listCurrentFinals(context) {
  const season = (await context.docs.read("live/current"))?.season;
  if (!season) return null;
  const slate = (await context.docs.read(`seasons/${season}`))?.slate;
  const games = keepFirstOfEach([
    ...(slate ? listSlateFinals(slate) : []),
    ...(await listScheduledFinals(context.docs, season)),
  ]);
  return { season, games };
}

/** @param {JobContext} context */
async function keepFinishedGames(context) {
  const finals = await listCurrentFinals(context);
  if (!finals) return;
  const { season, games: currentFinals } = finals;
  const current = await keepSeasonGames(context, season, currentFinals, GAMES_PER_RUN);
  let left = GAMES_PER_RUN - current.readCount;
  for (const year of await listUnkeptPastSeasons(context, season)) {
    if (!left) return;
    const finals = await listScheduledFinals(context.docs, year);
    const { readCount, isDone } = await keepSeasonGames(context, year, finals, left);
    if (isDone && finals.length) await context.storage.put(nameKeptKey(year), BOX_SCORE_VERSION);
    left -= readCount;
  }
}

export function createGameDetailsJob() {
  return { chooseDelay: () => RUN_DELAY_MS, updateStore: keepFinishedGames };
}
