// The season's games as the Games view, a game's sheet, a club's cards, and the search list them:
// the store's schedule with the slate's copies over it, each game known by its key, and each day's
// games in schedule order.

import { sortInScheduleOrder } from "./schedule-order.js";
import { listSlateGames } from "./slate.js";

// A game is MLB's by its id, which a postponed game's listing shares with its makeup's, so its day
// tells the two apart. Its clubs can't, since every playoff game whose clubs aren't known yet has
// the same ones.
/** @param {{ id: string, date: string }} game */
export const nameGameKey = (game) => `${game.id} ${game.date}`;

/**
 * Every game of the season, from the store's schedule, with the slate's copies, which carry a game
 * while it's played, over it, keeping each club's record with the game, which only the schedule
 * has.
 * @param {any} slate
 * @param {any[] | null} schedule
 */
export function listSeasonGames(slate, schedule) {
  const games = new Map((schedule ?? []).map((game) => [nameGameKey(game), game]));
  const slateGames = slate ? [...listSlateGames(slate), slate.allStar].filter(Boolean) : [];
  for (const game of slateGames)
    games.set(nameGameKey(game), { ...games.get(nameGameKey(game)), ...game });
  return [...games.values()];
}

/**
 * Each day that has games, in order, with its games in schedule order.
 * @template {{ date: string, start: string }} Game
 * @param {Game[]} games
 * @returns {{ date: string, games: Game[] }[]}
 */
export function groupGamesByDay(games) {
  /** @type {Map<string, Game[]>} */
  const days = new Map();
  for (const game of sortInScheduleOrder(games)) {
    if (!days.has(game.date)) days.set(game.date, []);
    days.get(game.date)?.push(game);
  }
  return [...days].map(([date, dayGames]) => ({ date, games: dayGames }));
}
