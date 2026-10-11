import { renderBracket, watchBracketSpace } from "./bracket-view.js";
import { listRankedOrder, renderTeamDot } from "./clubs.js";
import { startCatchUpNote } from "#shared/catch-up-note.js";
import { startCaughtUpSweep } from "#shared/caught-up-sweep.js";
import { startPullToRefresh } from "#shared/pull-to-refresh.js";
import { startHomeScreen } from "#shared/home-screen.js";
import { showJobStatuses, startDiagnostics } from "#shared/diagnostics.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import {
  showStartDay,
  showStartDayOnReturn,
  startDayStrip,
  startOverDayStrip,
} from "#shared/day-strip.js";
import { closeGameSearch, openGameSearch, startGameSearch } from "#shared/game-search-view.js";
import { keepLastSeen, readLastSeen, reopenLastSheets } from "#shared/last-seen.js";
import { endLoadNote } from "#shared/load-note.js";
import { startNotifications } from "#shared/notifications.js";
import {
  drawNews as drawNewsList,
  readLastSeenNews,
  startNewsRedraws,
  watchNews,
} from "#shared/news.js";
import { setTabStart, startPageTabs } from "#shared/page-tabs.js";
import { startGameSheet } from "./game-sheet.js";
import { listFoundGameDays, listSeasonGames } from "./games-view.js";
import { REORDER_EVENT } from "./ranking.js";
import { renderAll } from "./render.js";
import { reloadIfReplaced, watchReturns } from "#shared/resume.js";
import { startServiceWorker } from "#shared/service-worker.js";
import { keepRanking, watchKeptChoices } from "./kept-on-device.js";
import { NEWS_LEAGUE } from "./news-league.js";
import {
  applyDeferredSeason,
  loadSeason,
  loadSeasonList,
  showYear,
  startSeasonData,
} from "./season-data.js";
import { composeState, session, readSeasonYear } from "./session.js";
import { startSettings } from "./settings.js";
import { startPlayerSheet } from "./player-sheet.js";
import { fillRoster, readShownRoster, reopenRoster, startRosterSection } from "./roster-section.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { renderStamp } from "./stamp-view.js";
import { createSearchTerms, readSearchGame } from "./search-terms.js";
import { refreshTeamSheet, startTeamSheet } from "#shared/team-sheet.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { isReadableSeason } from "#shared/season-reader.js";
import { fillSeasonPicker } from "#shared/season-picker.js";
import { SNAPSHOT_VERSION } from "./snapshot.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findNewsList = () => /** @type {HTMLElement} */ (document.getElementById("newsList"));

// Until the store or the page's last showing says what the news is, the view keeps what it was.
function drawNews() {
  if (session.news !== undefined) drawNewsList(findNewsList(), session.news, NEWS_LEAGUE);
}

const findYearPicker = () => /** @type {HTMLSelectElement} */ (document.getElementById("yearSel"));

// Another season's Games view opens on its start day: today, or a season over's last day.
async function switchYear(year) {
  await showYear(year);
  if (session.activeYear !== year) return;
  startOverDayStrip();
  renderAll();
}

async function listYears() {
  const recent = [readSeasonYear(), readSeasonYear() - 1, readSeasonYear() - 2].map(String);
  try {
    return await loadSeasonList();
  } catch {
    return recent;
  }
}

/** @param {string[]} years */
const fillYearPicker = (years) => fillSeasonPicker(findYearPicker(), years, session.activeYear);

// A new current season changes what the stamp says, and the picker lists it.
async function showNewCurrentYear() {
  startOverDayStrip();
  renderAll();
  fillYearPicker(await listYears());
}

// Sortable has already moved the dragged card, so redrawing the list keeps it where it was dropped.
function finishReordering(order) {
  session.isReordering = false;
  if (order.join() !== listRankedOrder().join()) keepRanking(session.activeYear, order);
  applyDeferredSeason();
  renderAll();
}

// Another tab's drag or dismissal redraws this one, unless a drag here is still under way.
function showChoicesFromOtherTabs() {
  if (!session.isReordering) redrawEased(renderAll);
}

// As on iPhone, choosing the Games tab while it shows goes back to where it starts: today, closing
// a search that's open.
function returnGamesToToday() {
  if (!closeGameSearch()) showStartDay();
  return true;
}

/** Every game the Games view lists, which a search reads. */
const listListedGames = () => listSeasonGames(session.state?.slate, session.schedule);

// The season a search reads, its words read again only for another season, schedule, or standings.
/** @type {{ state: any, schedule: any, terms: import("#shared/game-search.js").SearchTerms } | null} */
let searchTerms = null;

function readSearchSeason() {
  const { state, schedule } = session;
  if (!state) return null;
  const games = listListedGames();
  if (searchTerms?.state !== state || searchTerms?.schedule !== schedule)
    searchTerms = {
      state,
      schedule,
      terms: createSearchTerms({ games, divisions: session.standings?.divisions }),
    };
  const searchGames = games
    .map(readSearchGame)
    .filter((game) => game !== null)
    .sort((first, second) => first.startMs - second.startMs);
  return { terms: searchTerms.terms, games: searchGames };
}

/**
 * The days of the games a search found, drawn as the Games view draws them.
 * @param {import("#shared/game-search.js").SearchGame[]} found
 * @param {number} now
 */
const listSearchDays = (found, now) =>
  listFoundGameDays(
    found.map((game) => game.game),
    listListedGames(),
    now,
  );

function wireControls() {
  startPageTabs();
  setTabStart("games", returnGamesToToday);
  startDayStrip(/** @type {HTMLElement} */ (document.getElementById("seasonGames")), {
    search: openGameSearch,
  });
  startGameSearch(/** @type {HTMLElement} */ (document.getElementById("gameSearch")), {
    readSeason: readSearchSeason,
    listDays: listSearchDays,
    renderTeamMark: renderTeamDot,
    close: showStartDayOnReturn,
  });
  startGameSheet();
  startTeamSheet({
    isTeam: (id) => id in TEAMS,
    renderSheet: (id) => renderTeamSheet(id),
    fillSections: fillRoster,
    sectionsKeeper: { read: readShownRoster, reopen: reopenRoster },
  });
  startRosterSection({ showChange: refreshTeamSheet });
  startPlayerSheet();
  startSettings();
  startNewsRedraws(findNewsList(), drawNews, NEWS_LEAGUE);
  startHomeScreen();
  const picker = findYearPicker();
  picker.addEventListener("change", () => switchYear(Number(picker.value)));
  document
    .getElementById("rankList")
    .addEventListener(REORDER_EVENT, (event) =>
      finishReordering(/** @type {CustomEvent} */ (event).detail.order),
    );
}

// The stamp's times, which final is fresh, the bracket's countdowns to first pitch, and the day
// each story came out read the clock.
function refreshClockEveryMinute() {
  setInterval(() => {
    try {
      if (session.season) composeState();
      renderStamp();
      renderBracket();
      drawNews();
    } catch {
      /* try again next minute */
    }
  }, CLOCK_REFRESH_MS);
}

/** @param {any} shown */
const pickShown = ({ season, schedule, trackedTitles }) => ({ season, schedule, trackedTitles });

const readShown = () =>
  session.season && { year: session.activeYear, ...pickShown(session), news: session.news };

// The news isn't any one season's, so the page's last showing of it is drawn whichever season shows.
function drawLastSeenNews(lastSeen) {
  session.news = readLastSeenNews(lastSeen?.news);
  drawNews();
}

// What the page last showed is only a stand-in until the store answers, so what can't be drawn is
// skipped.
function drawLastSeen() {
  const lastSeen = readLastSeen();
  drawLastSeenNews(lastSeen);
  const isShowable =
    !!lastSeen?.season &&
    lastSeen.year === session.activeYear &&
    isReadableSeason(lastSeen.season, SNAPSHOT_VERSION);
  if (!isShowable) return;
  const before = pickShown(session);
  try {
    const schedule = Array.isArray(lastSeen.schedule) ? lastSeen.schedule : null;
    Object.assign(session, { ...pickShown(lastSeen), schedule });
    composeState();
    renderAll();
    endLoadNote();
  } catch {
    Object.assign(session, before);
  }
}

const showNewData = () => redrawEased(renderAll);

async function reloadSeason() {
  await loadSeason();
  showNewData();
}

// A page whose load failed loads its season again.
/** @param {number} awayMs */
function catchUp(awayMs) {
  session.db.catchUp(awayMs);
  if (session.problem) reloadSeason();
  else if (!session.isReordering) showNewData();
}

// The season the store and MLB answer with eases in over the one the page last showed.
function drawLoadedSeason() {
  renderAll();
  endLoadNote();
}

async function boot() {
  startDiagnostics();
  watchReturns({ isBusy: () => session.isReordering, catchUp, pause: () => session.db.pause() });
  trackKeyboardFocus();
  wireControls();
  session.db = createWorkerStore();
  showJobStatuses(session.db, ["news", "pitchers"]);
  drawLastSeen();
  reopenLastSheets();
  startCatchUpNote(session.db, renderStamp);
  startCaughtUpSweep(session.db, document.getElementById("stamp"));
  startPullToRefresh({ store: session.db, catchUp });
  keepLastSeen(readShown);
  startSeasonData({
    showChange: showNewData,
    showStamp: () => redrawEased(renderStamp),
    showCurrentYear: showNewCurrentYear,
    showUnreadable: reloadIfReplaced,
  });
  const [years] = await Promise.all([listYears(), loadSeason()]);
  fillYearPicker(years);
  redrawEased(drawLoadedSeason);
  watchNews(session.db, (news) => {
    session.news = news;
    redrawEased(drawNews);
  });
  watchKeptChoices(showChoicesFromOtherTabs);
  watchBracketSpace();
  refreshClockEveryMinute();
  startServiceWorker();
  startNotifications();
}

boot();
