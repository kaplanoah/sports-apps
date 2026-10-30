import { createBoxScoreReader } from "./adapters/box-score.js";
import { createEspnGameReader, describeGameLead } from "./adapters/lead.js";

// The details of each game a page has open, which the store reads with each update and pushes to
// the pages watching: its box score and its lead. A game that hasn't started has none, and one
// whose final box score is saved needs no more. A read that fails keeps what was saved.

/** @param {{ fetchImpl?: (input: string, init: object) => Promise<Response> }} [options] */
export function createWatchedGameLoader({ fetchImpl = (input, init) => fetch(input, init) } = {}) {
  const espnGames = createEspnGameReader({ fetchImpl });
  const readBoxScore = createBoxScoreReader({ fetchImpl, espnGames });

  /**
   * @param {string} id
   * @param {any} snapshot
   * @param {any} stored the details saved last
   * @param {import("../../../../shared/worker/store-reads.js").ReadDoc} readDoc the store's documents
   */
  return async function loadWatchedGame(id, snapshot, stored, readDoc) {
    const game = [...snapshot.games, ...snapshot.nearestGames].find((each) => each.id === id);
    if (!game || game.state === "pre" || stored?.boxScore?.state === "final") return null;
    const teams = { away: game.away.team, home: game.home.team, start: game.start };
    const summary = espnGames.fetchSummary({ id: game.id, ...teams }, readDoc);
    const [boxScore, lead] = await Promise.all([
      readBoxScore({ id, ...teams }, readDoc, () => summary).catch(() => stored?.boxScore ?? null),
      summary.then((read) => describeGameLead(teams, read)).catch(() => stored?.lead ?? null),
    ]);
    return boxScore || lead ? { boxScore, lead } : null;
  };
}
