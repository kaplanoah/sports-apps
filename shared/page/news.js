import { watchFailedImages } from "./failed-images.js";
import { setHtml } from "./html.js";
import { readNewsChoices, startNewsChoices } from "./news-choices.js";
import { renderNews } from "./news-view.js";
import { fitPhotoCredits, watchPhotoCredits } from "./photo-credits.js";

// The News tab: the cards the Worker keeps in the store, which it pushes to the page on every
// change, drawn with the outlets this device reads, in two columns on a wide screen.

const NEWS_PATH = "news/cards";
const WIDE_SCREEN = "(min-width: 900px)";

/**
 * @param {HTMLElement} list
 * @param {{ cards?: import("./news-picks.js").NewsCard[] } | null} news
 * @param {import("./news-view.js").NewsLeague} league
 */
export function drawNews(list, news, league) {
  const columnCount = matchMedia(WIDE_SCREEN).matches ? 2 : 1;
  setHtml(
    list,
    renderNews(news?.cards ?? [], readNewsChoices(), Date.now(), { ...league, columnCount }),
  );
  fitPhotoCredits(list);
}

/**
 * Calls `redraw` after a News switch changes, the screen widens or narrows, or a photo fails to
 * load, and fits the photos' credits again whenever the list's width changes.
 * @param {HTMLElement} list
 * @param {() => void} redraw
 * @param {import("./news-view.js").NewsLeague} league
 */
export function startNewsRedraws(list, redraw, league) {
  startNewsChoices(redraw, Object.keys(league.outletSwitches));
  matchMedia(WIDE_SCREEN).addEventListener("change", redraw);
  watchFailedImages(list, redraw);
  watchPhotoCredits(list);
}

/**
 * Calls `onChange` with the news each time the store has new cards, or null when it has none.
 * @param {{ doc: (path: string) => any }} db
 * @param {(news: { cards: import("./news-picks.js").NewsCard[] } | null) => void} onChange
 */
export function watchNews(db, onChange) {
  db.doc(NEWS_PATH).onSnapshot(
    (snapshot) => onChange(snapshot.exists ? snapshot.data() : null),
    () => {},
  );
}

/**
 * The news from the page's last showing, or undefined when it can't be read, which leaves the view
 * as it was until the store answers.
 * @param {any} news
 */
export const readLastSeenNews = (news) =>
  news === null || Array.isArray(news?.cards) ? news : undefined;
