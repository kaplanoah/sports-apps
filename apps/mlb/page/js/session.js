import { readEasternDay } from "#shared/days.js";

const FRESH_FINAL_MS = 10 * 60 * 1000;
const APRIL = 4;

// A season starts on the day spring training does, which is always before April, so the
// first guess is only in doubt from January through March.
export function guessSeasonYear(now = Date.now()) {
  const { date, year } = readEasternDay(now);
  return Number(date.slice(5, 7)) >= APRIL ? year : year - 1;
}

export const hasSpringStarted = (springStart, now = Date.now()) =>
  !!springStart && readEasternDay(now).date >= springStart;

export const session = {
  db: null,
  currentSeason: guessSeasonYear(),
  activeYear: guessSeasonYear(),
  // The shown season's record, as the Worker saves it.
  season: null,
  // Every game of the shown season, which the Games view lists, null when the store has none.
  /** @type {any[] | null} */
  schedule: null,
  // Every player on a club's roster this season, for search, null when the store has none.
  /** @type {{ players: import("#shared/page-search.js").PagePlayer[] } | null} */
  playerIndex: null,
  // How the store's last update went.
  status: null,
  problem: "",
  state: null,
  standings: null,
  trackedTitles: {},
  isReordering: false,
  // The news cards the Worker keeps, null when it keeps none, and undefined until the store or the
  // page's last showing says.
  /** @type {{ cards: import("#shared/news-picks.js").NewsCard[] } | null | undefined} */
  news: undefined,
};

export const readSeasonYear = () => session.currentSeason;

// The day's finals show as fresh for a few minutes after they end.
export function composeState() {
  const { season } = session;
  const slate = season.slate && {
    ...season.slate,
    since: new Date(Date.now() - FRESH_FINAL_MS).toISOString(),
  };
  session.state = { ...season, slate };
  session.standings = season.standings ?? null;
}
