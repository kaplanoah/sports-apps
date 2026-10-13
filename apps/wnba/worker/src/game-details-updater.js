import { isSameJson } from "#shared/compare.js";
import { fetchBoxScore } from "./box-score.js";
import { createLeadReader } from "./lead.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { findSettledTime } from "../../../../shared/worker/feed-keeper.js";

// Keeps each finished game's box score and lead, so a sheet opened on a final reads only the
// store. A game is read as the store finds it final, and again until a read comes long enough
// after its end for the league and ESPN to have caught up, and then never again, since a finished
// game doesn't change. Each run reads a few games, newest first: the current season's playoff games
// and each team's last, then each season's the store keeps from before. A game still being played
// is left to the pages watching it (watched-games.js).

const MINUTE_MS = 60 * 1000;
const RUN_DELAY_MS = 2 * MINUTE_MS;
const GAMES_PER_RUN = 4;
const RETRY_MS = 10 * MINUTE_MS;
// A game whose details haven't settled this long after its first read is let go.
const GIVE_UP_MS = 2 * 60 * MINUTE_MS;
const NO_DETAILS = { boxScore: null, lead: null };

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */
/** @typedef {{ firstReadAt: number, readAt: number, isDone: boolean }} GameRead */

/** @param {number} season */
const nameReadsKey = (season) => `reads:${season}`;

/**
 * The seasons the store keeps, newest first.
 * @param {JobContext["docs"]} docs
 */
const listSeasonsNewestFirst = async (docs) =>
  (await docs.list("seasons"))
    .filter((/** @type {any} */ season) => Array.isArray(season?.games))
    .sort((/** @type {any} */ first, /** @type {any} */ second) => second.year - first.year);

/**
 * A season's games that a sheet opens, each once: its playoff games and each team's nearest.
 * @param {any} season
 */
const listSeasonGames = (season) => [
  ...new Map(
    [...season.games, ...(season.nearestGames ?? [])].map((/** @type {any} */ game) => [
      game.id,
      game,
    ]),
  ).values(),
];

/** @param {any} season */
const listFinalsNewestFirst = (season) =>
  listSeasonGames(season)
    .filter((/** @type {any} */ game) => game.state === "final")
    .sort(
      (/** @type {any} */ first, /** @type {any} */ second) =>
        Date.parse(second.start) - Date.parse(first.start),
    );

/**
 * @param {GameRead | undefined} read
 * @param {number} now
 */
const isDue = (read, now) => !read || (!read.isDone && now - read.readAt >= RETRY_MS);

/** @param {PromiseSettledResult<any>} result */
const readAnswer = (result) => (result.status === "fulfilled" ? result.value : null);

/**
 * Whether the league answered with a final box score, and ESPN with a lead that's over, or that it
 * has no such game.
 * @param {PromiseSettledResult<any>} boxScore
 * @param {PromiseSettledResult<any>} lead
 */
const isWhole = (boxScore, lead) =>
  readAnswer(boxScore)?.state === "final" &&
  lead.status === "fulfilled" &&
  (lead.value?.isOver ?? true);

/**
 * Reads a game's details and saves what changed, keeping what was saved for a read that failed.
 * @param {JobContext} context
 * @param {(game: { away: string, home: string, start: string }) => Promise<any>} readLead
 * @param {any} game
 * @param {GameRead | undefined} read the game's last read
 * @returns {Promise<GameRead>}
 */
async function keepGame(context, readLead, game, read) {
  const key = nameGameDetailsKey(game.id);
  const stored = (await context.docs.read(key)) ?? NO_DETAILS;
  const [boxScore, lead] = await Promise.allSettled([
    fetchBoxScore(context.fetchImpl, game.id),
    readLead({ away: game.away.team, home: game.home.team, start: game.start }),
  ]);
  const details = {
    boxScore: readAnswer(boxScore) ?? stored.boxScore,
    lead: readAnswer(lead) ?? stored.lead,
  };
  if (!isSameJson(stored, details)) await context.docs.write(key, details);
  const now = context.now();
  const firstReadAt = read?.firstReadAt ?? now;
  const isSettled = isWhole(boxScore, lead) && now >= findSettledTime(game);
  return { firstReadAt, readAt: now, isDone: isSettled || now - firstReadAt >= GIVE_UP_MS };
}

/**
 * Reads up to `limit` of a season's finals that are due, newest first, and says how many it read.
 * @param {JobContext} context
 * @param {(game: { away: string, home: string, start: string }) => Promise<any>} readLead
 * @param {any} season
 * @param {number} limit
 */
async function keepSeasonGames(context, readLead, season, limit) {
  const readsKey = nameReadsKey(season.year);
  /** @type {Record<string, GameRead>} */
  const reads = (await context.storage.get(readsKey)) ?? {};
  const now = context.now();
  const due = listFinalsNewestFirst(season)
    .filter((game) => isDue(reads[game.id], now))
    .slice(0, limit);
  for (const game of due) reads[game.id] = await keepGame(context, readLead, game, reads[game.id]);
  if (due.length) await context.storage.put(readsKey, reads);
  return due.length;
}

/** @param {JobContext} context */
async function keepFinishedGames(context) {
  const readLead = createLeadReader({ fetchImpl: context.fetchImpl });
  let left = GAMES_PER_RUN;
  for (const season of await listSeasonsNewestFirst(context.docs)) {
    if (!left) return;
    left -= await keepSeasonGames(context, readLead, season, left);
  }
}

export function createGameDetailsJob() {
  return { chooseDelay: () => RUN_DELAY_MS, updateStore: keepFinishedGames };
}
