import { readCalendarYear } from "#shared/days.js";

// What the page shows, read from the Worker's store and kept current as it changes.
export const session = {
  /** @type {ReturnType<typeof import("#shared/worker-store.js").createWorkerStore> | null} */
  db: null,
  // The season shown, and the one the store says is current, null until it says.
  year: readCalendarYear(new Date()),
  /** @type {number | null} */
  currentYear: null,
  /** @type {any} */
  season: null,
  // Every game of the season shown, which the Games view lists, null when the store has none.
  /** @type {{ games: any[] } | null} */
  schedule: null,
  // Every player on a team's roster in the season shown, for search, null when the store has none.
  /** @type {{ players: import("./search-pages.js").IndexedPlayer[] } | null} */
  playerIndex: null,
  // The news cards, null when the store has none, and undefined until the store or the page's
  // last showing says.
  /** @type {{ cards: import("#shared/news-picks.js").NewsCard[] } | null | undefined} */
  news: undefined,
  /** @type {{ error?: string, detail?: string } | null} */
  status: null,
  problem: "",
};

/** Whether the season shown is over, one the store keeps from before the current one. */
export const isPastSeason = () =>
  session.currentYear !== null && session.year !== session.currentYear;
