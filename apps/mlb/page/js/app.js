import { openNotificationGame } from "#shared/notification-navigation.js";
import { BACKGROUND_JOBS } from "./background-jobs.js";
import { renderBracket, watchBracketSpace } from "./bracket-view.js";
import { listRankedOrder, renderTeamDot } from "./clubs.js";
import { startCatchUpNote } from "#shared/catch-up-note.js";
import { startCaughtUpSweep } from "#shared/caught-up-sweep.js";
import { startChannelTag } from "#shared/channel-tag.js";
import { startDailyCount } from "#shared/daily-count.js";
import { startPullToRefresh } from "#shared/pull-to-refresh.js";
import { startHomeScreen } from "#shared/home-screen.js";
import { showJobStatuses, showUpdateStatus, startDiagnostics } from "#shared/diagnostics.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { showStartDay, startDayStrip, startOverDayStrip } from "#shared/day-strip.js";
import { startGameSearch } from "#shared/game-search-view.js";
import { keepLastRead } from "#shared/kept-read.js";
import {
  keepLastSeen,
  readLastSeen,
  readLastSeenYears,
  reopenLastSheets,
} from "#shared/last-seen.js";
import { endLoadNote, hasDrawing } from "#shared/load-note.js";
import { watchPresses } from "#shared/press.js";
import { startNotifications } from "#shared/notifications.js";
import {
  drawNews as drawNewsList,
  readLastSeenNews,
  startNewsRedraws,
  watchNews,
} from "#shared/news.js";
import { readNewsChoices } from "#shared/news-choices.js";
import { listShownStories } from "#shared/page-places.js";
import { openPageTab, setTabStart, startPageTabs } from "#shared/page-tabs.js";
import { isSettingShown, openSettings } from "#shared/settings-sheet.js";
import { openNotifiedGame, openGameSection, startGameSheet } from "./game-sheet.js";
import { listFoundGameDays } from "./games-view.js";
import { listSeasonGames } from "./season-games.js";
import { REORDER_EVENT } from "./ranking.js";
import { renderAll } from "./render.js";
import { reloadIfReplaced, watchReturns } from "#shared/resume.js";
import { startServiceWorker } from "#shared/service-worker.js";
import { keepRanking, watchKeptChoices } from "./kept-on-device.js";
import { LEAGUE_WORDS } from "./league-words.js";
import { NEWS_LEAGUE } from "./news-league.js";
import {
  applyDeferredSeason,
  loadSeason,
  loadSeasonList,
  showYear,
  startSeasonData,
  watchSeasonSelection,
} from "./season-data.js";
import { composeState, session } from "./session.js";
import { startSettings } from "./settings.js";
import { startPlayerSheet } from "./player-sheet.js";
import { fillRoster, readShownRoster, reopenRoster, startRosterSection } from "./roster-section.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { renderStamp } from "./stamp-view.js";
import { PLAYOFF_FIELDS, listSearchPages } from "./search-pages.js";
import { createSearchTerms, readSearchGames } from "./search-terms.js";
import { showLeagueStandings } from "./standings.js";
import { refreshTeamSheet, startTeamSheet } from "#shared/team-sheet.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { isReadableSeason } from "#shared/season-reader.js";
import { fillSeasonPicker, keepSeasonYears, watchSeasonPicks } from "#shared/season-picker.js";
import { startAppearance } from "#shared/appearance.js";
import { showSeasonPart, startBracketStandings } from "#shared/bracket-standings.js";
import { LOOKS } from "./looks.js";
import { SNAPSHOT_VERSION } from "./snapshot.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findNewsList = () => /** @type {HTMLElement} */ (document.getElementById("newsList"));

// Until the store or the page's last showing says what the news is, the view keeps what it was.
function drawNews() {
  if (session.news !== undefined) drawNewsList(findNewsList(), session.news, NEWS_LEAGUE);
}

const findSeasonRow = () => /** @type {HTMLElement} */ (document.getElementById("seasonRow"));

// Another season's Games view opens on its start day: today, or a season over's last day.
function drawPickedSeason() {
  startOverDayStrip();
  renderAll();
}

const readSeasonYears = keepSeasonYears(loadSeasonList);

/** @param {string[] | null} years */
const fillYearPicker = (years) =>
  fillSeasonPicker(
    findSeasonRow(),
    { years, pickedYear: session.activeYear, currentYear: session.currentSeason },
    LEAGUE_WORDS,
  );

// A new current season changes what the stamp says, and the picker lists it.
async function showNewCurrentYear() {
  startOverDayStrip();
  renderAll();
  fillYearPicker(await readSeasonYears());
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

const readSearchPages = () =>
  listSearchPages({
    index: session.playerIndex,
    isSettingShown,
    divisions: session.standings?.divisions ?? {},
    stories: listShownStories(session.news, readNewsChoices(), NEWS_LEAGUE.outletSwitches),
  });

/**
 * Opens a place a search lists: a tab, the bracket or standings in theirs, one of the standings'
 * parts, a game's section, or settings at one of its rows.
 * @param {string} key
 */
function openSearchPlace(key) {
  const [place, detail] = key.split(":");
  if (place === "tab") openPageTab(detail);
  else if (place === "season") {
    openPageTab("bracket-standings");
    showSeasonPart(/** @type {import("#shared/bracket-standings.js").SeasonPart} */ (detail), {
      isInstant: true,
    });
  } else if (place === "standings") {
    // The playoff fields lead the standings, so their row shows the standings from the top.
    openPageTab("bracket-standings");
    showSeasonPart("standings", { isInstant: true });
    if (detail !== PLAYOFF_FIELDS) showLeagueStandings(detail);
  } else if (place === "highlights" || place === "matchup") openGameSection(detail, place);
  else openSettings(key);
}

// A search reads the season on each key press, so its games and words are worked out again only
// once the season, its schedule, or its standings change.
const readSearchSeasonFrom = keepLastRead(
  /**
   * @param {any} state
   * @param {any} schedule
   * @param {any} standings
   */
  (state, schedule, standings) => {
    const listed = listSeasonGames(state.slate, schedule);
    return {
      listed,
      terms: createSearchTerms({ games: listed, divisions: standings?.divisions }),
      games: readSearchGames(listed),
    };
  },
);

function readSearchSeason() {
  const { state, schedule, standings } = session;
  return state ? readSearchSeasonFrom(state, schedule, standings) : null;
}

/**
 * The days of the games a search found, drawn as the Games view draws them.
 * @param {import("#shared/game-search.js").SearchGame[]} found
 * @param {number} now
 */
const listSearchDays = (found, now) =>
  listFoundGameDays(
    found.map((game) => game.game),
    readSearchSeason()?.listed ?? [],
    now,
  );

function wireControls() {
  startPageTabs();
  startBracketStandings();
  setTabStart("games", showStartDay);
  startDayStrip(/** @type {HTMLElement} */ (document.getElementById("seasonGames")));
  startGameSearch(/** @type {HTMLElement} */ (document.getElementById("gameSearch")), {
    readSeason: readSearchSeason,
    listDays: listSearchDays,
    renderTeamMark: renderTeamDot,
    readPages: readSearchPages,
    openPlace: openSearchPlace,
    placeholder: "Teams, players, and games",
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
  startChannelTag();
  startAppearance(LOOKS);
  startNewsRedraws(findNewsList(), drawNews, NEWS_LEAGUE);
  startHomeScreen();
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
  session.season && {
    year: session.season.year,
    currentYear: session.currentSeason,
    ...pickShown(session),
    news: session.news,
  };

// The news isn't any one season's, so the page's last showing of it is drawn whichever season shows.
function drawLastSeenNews(lastSeen) {
  session.news = readLastSeenNews(lastSeen?.news);
  drawNews();
}

// The seasons the page last showed and the store then said was current name the season a reload
// loads, even when what it showed can't be drawn.
function keepLastSeenYears(lastSeen) {
  const years = readLastSeenYears(lastSeen);
  if (!years) return;
  Object.assign(session, { activeYear: years.year, currentSeason: years.currentYear });
}

// What the page last showed is only a stand-in until the store answers, so what can't be drawn is
// skipped.
function drawLastSeen() {
  const lastSeen = readLastSeen();
  keepLastSeenYears(lastSeen);
  drawLastSeenNews(lastSeen);
  const isShowable = !!lastSeen?.season && isReadableSeason(lastSeen.season, SNAPSHOT_VERSION);
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

function reloadSeason() {
  session.db.afterHandOver(async () => {
    await loadSeason();
    showNewData();
  });
}

// A page whose load failed loads its season again, once the store's update is in, so it draws
// that rather than what the store held. Otherwise what changed while it was away comes in one
// redraw, with the store's latest.
/** @param {number} awayMs */
function catchUp(awayMs) {
  session.db.catchUp(awayMs);
  if (session.problem) reloadSeason();
  else
    session.db.afterHandOver(() => {
      if (!session.isReordering) showNewData();
    });
}

// The season the store and MLB answer with eases in over the one the page last showed.
function drawLoadedSeason() {
  renderAll();
  endLoadNote();
}

async function boot() {
  startDiagnostics();
  watchReturns({ isBusy: () => session.isReordering, catchUp, pause: () => session.db.pause() });
  startDailyCount();
  trackKeyboardFocus();
  watchPresses([".matchup-row .team-open", ".starters-open"]);
  wireControls();
  session.db = createWorkerStore({ isShowing: hasDrawing });
  showJobStatuses(session.db, BACKGROUND_JOBS);
  showUpdateStatus(() => session.status);
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
  watchSeasonPicks(findSeasonRow(), {
    pick: showYear,
    watchSelection: watchSeasonSelection,
    showPicked: drawPickedSeason,
  });
  const [years] = await Promise.all([readSeasonYears(), loadSeason()]);
  fillYearPicker(years);
  session.db.afterHandOver(() => redrawEased(drawLoadedSeason));
  watchNews(session.db, (news) => {
    session.news = news;
    redrawEased(drawNews);
  });
  watchKeptChoices(showChoicesFromOtherTabs);
  watchBracketSpace();
  refreshClockEveryMinute();
  startServiceWorker();
  startNotifications(LEAGUE_WORDS);
  openNotificationGame({ showYear, openGame: openNotifiedGame });
}

boot();
