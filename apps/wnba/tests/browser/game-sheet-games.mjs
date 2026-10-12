import { GAMES } from "./harness.mjs";

export const ACES_AT_FEVER = "Game details: Aces at Fever, First Round Game 2";
export const FEVER_AT_ACES = "Game details: Fever at Aces, First Round Game 3";
export const VALKYRIES_AT_WINGS = "Game details: Valkyries at Wings, First Round Game 2";

/**
 * Valkyries at Wings, Game 2, under way in the third quarter: the store's game, and the league's
 * box score as it would read then.
 * @param {any} season
 */
export function startValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "live", status: "Q3 4:32", period: 3, clock: "4:32" });
  Object.assign(game.away, { score: 74 });
  Object.assign(game.home, { score: 72, isInBonus: true });
  return season;
}
export const liveBoxScore = structuredClone(GAMES.boxScores["1042600112"]);
Object.assign(liveBoxScore.game, { gameStatus: 2, period: 3 });

/**
 * Valkyries at Wings, Game 2, over: the Wings won 108-100 in overtime.
 * @param {any} season
 */
export function finishValkyriesAtWings(season) {
  const game = season.games.find((each) => each.id === "1042600112");
  Object.assign(game, { state: "final", status: "Final/OT" });
  Object.assign(game.away, { score: 100 });
  Object.assign(game.home, { score: 108 });
  return season;
}

/** @param {import("@playwright/test").Page} page */
export function countBoxScoreReads(page) {
  const reads = { count: 0 };
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/box-score") reads.count += 1;
  });
  return reads;
}
