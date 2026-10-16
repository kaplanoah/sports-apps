import { fetchBoxScore } from "./box-score.js";
import { createLeadReader } from "./lead.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { createGameDetailsJob } from "../../../../shared/worker/game-details-job.js";

// Keeps each finished game's box score and lead, as the shared job reads each final
// (game-details-job.js), until the league and ESPN have both caught up: a season's playoff games
// and each team's last, newest first.

const NO_DETAILS = { boxScore: null, lead: null };

/** @typedef {import("../../../../shared/worker/season-store.js").JobContext} JobContext */

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

/**
 * A season's finals, newest first.
 * @param {JobContext} context
 * @param {number} year
 */
async function listFinals(context, year) {
  const season = await context.docs.read(`seasons/${year}`);
  if (!Array.isArray(season?.games)) return [];
  return listSeasonGames(season)
    .filter((/** @type {any} */ game) => game.state === "final")
    .sort(
      (/** @type {any} */ first, /** @type {any} */ second) =>
        Date.parse(second.start) - Date.parse(first.start),
    );
}

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
 * A game's box score and lead, each kept as stored when it didn't answer.
 * @param {JobContext} context
 * @param {any} game
 * @param {any} stored
 */
async function readDetails(context, game, stored) {
  const readLead = createLeadReader({ fetchImpl: context.fetchImpl });
  const [boxScore, lead] = await Promise.allSettled([
    fetchBoxScore(context.fetchImpl, game.id),
    readLead({ away: game.away.team, home: game.home.team, start: game.start }),
  ]);
  if (boxScore.status === "rejected" && lead.status === "rejected") throw boxScore.reason;
  const kept = stored ?? NO_DETAILS;
  return {
    details: {
      boxScore: readAnswer(boxScore) ?? kept.boxScore,
      lead: readAnswer(lead) ?? kept.lead,
    },
    isWhole: isWhole(boxScore, lead),
  };
}

export const createWnbaGameDetailsJob = () =>
  createGameDetailsJob({ listFinals, readDetails, nameKey: nameGameDetailsKey });
