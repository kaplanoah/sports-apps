// The order the page lists MLB's games in: by day, then by start, but for a doubleheader's games,
// which go together in game order where its first one starts, since MLB can list its second game
// with the earlier start. Runs in both the page and the Worker, so it uses no DOM and no globals.

/**
 * @typedef {{ date?: string, start: string, away?: string | null, home?: string | null, doubleheader?: number | null }} ScheduledGame
 */

/** @param {ScheduledGame} game */
const nameDoubleheader = (game) => `${game.date ?? ""} ${game.away ?? ""} ${game.home ?? ""}`;

/**
 * Where each doubleheader's games go in the day: where its earliest listed start is.
 * @param {ScheduledGame[]} games
 */
function findDoubleheaderSlots(games) {
  /** @type {Map<string, number>} */
  const slots = new Map();
  for (const game of games.filter((each) => each.doubleheader)) {
    const key = nameDoubleheader(game);
    slots.set(key, Math.min(slots.get(key) ?? Infinity, Date.parse(game.start)));
  }
  return slots;
}

/**
 * The games in schedule order. A doubleheader's numbers are compared only between its own games.
 * @template {ScheduledGame} Game
 * @param {Game[]} games
 * @returns {Game[]}
 */
export function sortInScheduleOrder(games) {
  const slots = findDoubleheaderSlots(games);
  const findSlot = (/** @type {Game} */ game) =>
    (game.doubleheader && slots.get(nameDoubleheader(game))) || Date.parse(game.start);
  return games
    .map((game) => ({ game, slot: findSlot(game) }))
    .sort(
      (first, second) =>
        (first.game.date ?? "").localeCompare(second.game.date ?? "") ||
        first.slot - second.slot ||
        (first.game.doubleheader || 0) - (second.game.doubleheader || 0) ||
        Date.parse(first.game.start) - Date.parse(second.game.start),
    )
    .map(({ game }) => game);
}
