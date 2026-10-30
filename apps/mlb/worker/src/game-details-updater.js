import { nameScheduleCollection } from "./adapters/mlb.js";
import { listSlateGames } from "../../page/js/slate.js";
import { fetchBoxScore, nameGameDetailsKey } from "./box-score.js";
import { createGameDetailsJob } from "../../../../shared/worker/game-details-job.js";

// Keeps each finished game's box score, as the shared job reads each final (game-details-job.js):
// a season's slate first, the latest to end first, then the rest of its games, newest first.

// Raised whenever a box score keeps more of MLB's feed, so each final kept before is read again.
const BOX_SCORE_VERSION = 5;

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */

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
 * A season's finals, each once: its slate's first, the latest to end first, then the rest of its
 * games, newest first.
 * @param {JobContext} context
 * @param {number} season
 */
async function listFinals(context, season) {
  const slate = (await context.docs.read(`seasons/${season}`))?.slate;
  return keepFirstOfEach([
    ...(slate ? listSlateFinals(slate) : []),
    ...(await listScheduledFinals(context.docs, season)),
  ]);
}

/**
 * The current season's finals, in the order they're read.
 * @param {JobContext} context
 */
export async function listCurrentFinals(context) {
  const season = (await context.docs.read("live/current"))?.season;
  if (!season) return null;
  return { season, games: await listFinals(context, season) };
}

/**
 * @param {JobContext} context
 * @param {any} game
 */
async function readDetails(context, game) {
  const boxScore = await fetchBoxScore(context.fetchImpl, game.id);
  return { details: boxScore, isWhole: boxScore.state === "final" };
}

export const createMlbGameDetailsJob = () =>
  createGameDetailsJob({
    listFinals,
    readDetails,
    nameKey: nameGameDetailsKey,
    version: BOX_SCORE_VERSION,
  });
