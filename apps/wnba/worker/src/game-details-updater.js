import { createBoxScoreReader, isLeagueFinal } from "./adapters/box-score.js";
import { isFromEspn } from "./adapters/espn-box-score.js";
import { createEspnGameReader, describeGameLead } from "./adapters/lead.js";
import { nameGameDetailsKey } from "./store-docs.js";
import { createGameDetailsJob, nameReadsKey } from "../../../../shared/worker/game-details-job.js";

// Keeps each finished game's box score and lead, as the shared job reads each final
// (game-details-job.js), until the league and ESPN have both caught up: a season's playoff games
// and each team's last, newest first.

const NO_DETAILS = { boxScore: null, lead: null };
// Where the WNBA's own job kept each season's reads, before the shared job kept them.
const OWN_READS_PREFIX = "reads:";

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
 * has no such game. ESPN's box score stands in only until the league's answers, so it isn't whole.
 * @param {PromiseSettledResult<any>} boxScore
 * @param {PromiseSettledResult<any>} lead
 */
const isWhole = (boxScore, lead) =>
  isLeagueFinal(readAnswer(boxScore)) &&
  lead.status === "fulfilled" &&
  (lead.value?.isOver ?? true);

/**
 * The box score to keep: the one read, but that ESPN's never replaces the league's final.
 * @param {any} read
 * @param {any} kept
 */
const chooseBoxScore = (read, kept) =>
  isFromEspn(read) && isLeagueFinal(kept) ? kept : (read ?? kept);

/** @param {any} details */
const isStandIn = (details) => isFromEspn(details.boxScore);

/**
 * A game's box score and lead, each kept as stored when it didn't answer.
 * @param {JobContext} context
 * @param {any} game
 * @param {any} stored
 */
async function readDetails(context, game, stored) {
  const { fetchImpl } = context;
  const espnGames = createEspnGameReader({ fetchImpl });
  const readBoxScore = createBoxScoreReader({ fetchImpl, espnGames });
  const teams = { away: game.away.team, home: game.home.team, start: game.start };
  const summary = espnGames.fetchSummary({ id: game.id, ...teams }, context.docs.read);
  const [boxScore, lead] = await Promise.allSettled([
    readBoxScore(
      { id: game.id, ...teams },
      (key) => context.docs.read(key),
      () => summary,
    ),
    summary.then((read) => describeGameLead(teams, read)),
  ]);
  if (boxScore.status === "rejected" && lead.status === "rejected") throw boxScore.reason;
  const kept = stored ?? NO_DETAILS;
  return {
    details: {
      boxScore: chooseBoxScore(readAnswer(boxScore), kept.boxScore),
      lead: readAnswer(lead) ?? kept.lead,
    },
    isWhole: isWhole(boxScore, lead),
  };
}

/**
 * Moves each season's reads from where the WNBA's own job kept them to where the shared job does,
 * so a final read before isn't read again.
 * @param {JobContext["storage"]} storage
 */
async function moveOwnReads(storage) {
  for (const [key, reads] of await storage.list(OWN_READS_PREFIX)) {
    const sharedKey = nameReadsKey(Number(key.slice(OWN_READS_PREFIX.length)));
    if ((await storage.get(sharedKey)) === undefined) await storage.put(sharedKey, reads);
    await storage.delete(key);
  }
}

/** @returns {import("../../../../shared/worker/season-store.js").BackgroundJob} */
export function createWnbaGameDetailsJob() {
  const job = createGameDetailsJob({
    listFinals,
    readDetails,
    nameKey: nameGameDetailsKey,
    isStandIn,
  });
  return {
    chooseDelay: job.chooseDelay,
    async updateStore(context) {
      await moveOwnReads(context.storage);
      await job.updateStore(context);
    },
  };
}
