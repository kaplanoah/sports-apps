import { renderCatchUpLines, startCatchUpNote } from "#shared/catch-up-note.js";
import { startCaughtUpSweep } from "#shared/caught-up-sweep.js";
import { startPullToRefresh } from "#shared/pull-to-refresh.js";
import { startHomeScreen } from "#shared/home-screen.js";
import { setHtml } from "#shared/html.js";
import {
  drawNews as drawNewsList,
  readLastSeenNews,
  startNewsRedraws,
  watchNews,
} from "#shared/news.js";
import { readNewsChoices } from "#shared/news-choices.js";
import { pickReadCards } from "#shared/news-picks.js";
import { keepOpenedStories } from "#shared/opened-stories.js";
import { showJobStatuses, startDiagnostics } from "#shared/diagnostics.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { fillDayStrip, showStartDay, startDayStrip, startOverDayStrip } from "#shared/day-strip.js";
import {
  focusGameSearch,
  openGameSearch,
  refreshGameSearch,
  startGameSearch,
} from "#shared/game-search-view.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { keepLastSeen, readLastSeen, reopenLastSheets } from "#shared/last-seen.js";
import { endLoadNote } from "#shared/load-note.js";
import { watchPresses } from "#shared/press.js";
import { startNotifications } from "#shared/notifications.js";
import {
  openPageTab,
  readShownTab,
  readTabBefore,
  setTabEnter,
  setTabStart,
  startPageTabs,
} from "#shared/page-tabs.js";
import { reloadIfReplaced, watchReturns } from "#shared/resume.js";
import { fillSeasonPicker } from "#shared/season-picker.js";
import { isReadableSeason } from "#shared/season-reader.js";
import { startServiceWorker } from "#shared/service-worker.js";
import { openSettings, startSettingsSheet } from "#shared/settings-sheet.js";
import { refreshTeamSheet, startTeamSheet } from "#shared/team-sheet.js";
import { fillStamp } from "#shared/stamp.js";
import { chooseTitleYear, showTitleYear } from "#shared/title-year.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { startAppearance } from "#shared/appearance.js";
import { LOOKS } from "./looks.js";
import { placeBracket, readBracketScroll, startBracket } from "./bracket-tree.js";
import { renderBracket } from "./bracket-view.js";
import { openGameSection, refreshGameSheet, startGameSheet } from "./game-sheet.js";
import { renderDot } from "./clubs.js";
import { listFoundGameDays, listListedGames, listSeasonDays } from "./games-view.js";
import { NEWS_LEAGUE } from "./news-league.js";
import { refreshPlayerSheet, startPlayerSheet } from "./player-sheet.js";
import { fillRoster, readShownRoster, reopenRoster, startRosterSection } from "./roster-section.js";
import { loadSeason, loadSeasonYears, showYear, startSeasonData } from "./season-data.js";
import { isPastSeason, session } from "./session.js";
import { SNAPSHOT_VERSION } from "./snapshot.js";
import { isPlayoffsOver } from "./series.js";
import { describeStampProblem, renderStampLines } from "./stamp.js";
import { drawStandings, showStandingsList, startStandings } from "./standings-view.js";
import { listSearchPages } from "./search-pages.js";
import { createSearchTerms, readSearchGame } from "./search-terms.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { drawUpdates, watchDismissals } from "./updates.js";

const CLOCK_REFRESH_MS = 60 * 1000;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// The store's status is about the current season's updates, so a past season's page leaves it out.
function renderStamp() {
  const problem = describeStampProblem({
    status: isPastSeason() ? null : session.status,
    problem: session.problem,
  });
  const lines = renderStampLines(session.season, Date.now());
  fillStamp(findElement("stamp"), [...renderCatchUpLines(), ...lines], problem ? [problem] : []);
}

// Until the store or the page's last showing says what the news is, the view keeps what it was.
function drawNews() {
  if (session.news !== undefined) drawNewsList(findElement("newsList"), session.news, NEWS_LEAGUE);
}

function renderTitleYear() {
  const { year: shownYear, currentYear } = session;
  const isSeasonOver = isPlayoffsOver(session.season?.series ?? []);
  showTitleYear(chooseTitleYear({ shownYear, currentYear, isSeasonOver }));
}

function renderAll() {
  const now = Date.now();
  const keptLeft = readBracketScroll();
  setHtml(findElement("bracketWrap"), renderBracket(session.season, now));
  placeBracket(keptLeft);
  fillDayStrip(listSeasonDays(session.season, session.schedule, now));
  refreshGameSearch();
  drawStandings(session.season);
  drawNews();
  drawUpdates();
  renderTitleYear();
  renderStamp();
  refreshGameSheet();
  refreshTeamSheet();
  refreshPlayerSheet();
}

// What new data changes eases in, as does the season the store answers with after the one the page
// last showed.
const showNewData = () => redrawEased(renderAll);

function drawLoadedSeason() {
  renderAll();
  endLoadNote();
}

// Times read as today or tomorrow, so they're redrawn as the clock moves on.
function refreshClockEveryMinute() {
  setInterval(renderAll, CLOCK_REFRESH_MS);
}

// The season's games from the page's last showing count only in the version the page reads.
const readLastSeenSchedule = (schedule) =>
  Array.isArray(schedule?.games) && isReadableSeason(schedule, SNAPSHOT_VERSION) ? schedule : null;

// The season the page last showed is only a stand-in until the store answers, so one that can't
// be drawn is skipped.
function drawLastSeen() {
  const lastSeen = readLastSeen();
  if (!lastSeen?.season || !isReadableSeason(lastSeen.season, SNAPSHOT_VERSION)) return;
  const { year, season, schedule, news } = session;
  try {
    Object.assign(session, {
      year: lastSeen.year,
      season: lastSeen.season,
      schedule: readLastSeenSchedule(lastSeen.schedule),
      news: readLastSeenNews(lastSeen.news),
    });
    renderAll();
    endLoadNote();
  } catch {
    Object.assign(session, { year, season, schedule, news });
  }
}

/** @param {string} team */
const renderShownTeam = (team) =>
  renderTeamSheet(session.season, team, { year: session.year, now: Date.now() });

const readShown = () =>
  session.season && {
    year: session.year,
    season: session.season,
    schedule: session.schedule,
    news: session.news,
  };

const findSeasonPicker = () => /** @type {HTMLSelectElement} */ (findElement("seasonPicker"));

async function listSeasonYears() {
  try {
    return await loadSeasonYears();
  } catch {
    return [];
  }
}

/** @param {string[]} years */
const fillSeasonList = (years) => fillSeasonPicker(findSeasonPicker(), years, session.year);

// Another season's Games view opens on its start day: today, or a season over's last day.
/** @param {number} year */
async function switchSeason(year) {
  await showYear(year);
  startOverDayStrip();
  renderAll();
}

// A new current season changes what the header says, and the picker lists it.
async function showNewCurrentYear() {
  startOverDayStrip();
  renderAll();
  fillSeasonList(await listSeasonYears());
}

// As on iPhone, choosing the Games tab while it shows goes back to where it starts: today.
function returnGamesToToday() {
  showStartDay();
  return true;
}

// Search opens with the keyboard up from the tap on its tab, or as it was left, while it's open.
function enterSearch() {
  if (findElement("gameSearch").hidden) openGameSearch();
}

// As on iPhone, choosing search while it shows brings the keyboard up in its field.
function focusSearch() {
  focusGameSearch();
  return true;
}

// A search that closes while it shows goes back to the tab before it.
function leaveSearch() {
  if (readShownTab() === "search") openPageTab(readTabBefore() ?? "games");
}

/** @param {string} key */
const findSettingRow = (key) =>
  /** @type {HTMLElement | null} */ (document.querySelector(`[data-setting="${key}"]`));

// Settings itself always shows, and a setting only while its row does.
/** @param {string} key */
const isSettingShown = (key) => {
  const row = findSettingRow(key);
  return key === "settings" || (!!row && !row.closest("[hidden]"));
};

// Every story the News tab shows, for search to list a team's newest.
const listReadStories = () =>
  pickReadCards(session.news?.cards ?? [], readNewsChoices(), NEWS_LEAGUE.outletSwitches).flatMap(
    (card) => [card.lead, ...card.more],
  );

const readSearchPages = () =>
  listSearchPages({
    index: session.playerIndex,
    isSettingShown,
    standings: session.season?.standings ?? [],
    stories: listReadStories(),
  });

/**
 * Opens a place a search lists: a tab, one of the Standings tab's lists, a game's section, or
 * settings at one of its rows.
 * @param {string} key
 */
function openSearchPlace(key) {
  const [place, detail] = key.split(":");
  if (place === "tab") openPageTab(detail);
  else if (place === "standings") {
    openPageTab("standings");
    showStandingsList(detail);
  } else if (place === "highlights") openGameSection(detail, "highlights");
  else openSettings(findSettingRow(key));
}

// The season a search reads, its words read again only for another season or schedule.
/** @type {{ season: any, schedule: any, terms: import("#shared/game-search.js").SearchTerms } | null} */
let searchTerms = null;

function readSearchSeason() {
  const { season, schedule } = session;
  if (!season) return null;
  const games = listListedGames(season, schedule);
  if (searchTerms?.season !== season || searchTerms?.schedule !== schedule)
    searchTerms = {
      season,
      schedule,
      terms: createSearchTerms({ games, standings: season.standings }),
    };
  return {
    terms: searchTerms.terms,
    games: games.map((game) => readSearchGame(game, session.overtimes)).filter(Boolean),
  };
}

/**
 * The days of the games a search found, drawn as the Games view draws them.
 * @param {import("#shared/game-search.js").SearchGame[]} found
 * @param {number} now
 * @param {{ showsNetworks: boolean }} shown
 */
const listSearchDays = (found, now, shown) =>
  listFoundGameDays(
    found.map((game) => game.game),
    listListedGames(session.season, session.schedule),
    now,
    shown,
  );

async function reloadSeason() {
  await loadSeason();
  showNewData();
}

/** @param {number} awayMs */
function catchUp(awayMs) {
  session.db.catchUp(awayMs);
  if (session.problem) reloadSeason();
  else showNewData();
}

async function boot() {
  startDiagnostics();
  startAppearance(LOOKS);
  watchReturns({ catchUp, pause: () => session.db.pause() });
  trackKeyboardFocus();
  watchPresses([".team-line .team-open"]);
  startPageTabs();
  setTabStart("games", returnGamesToToday);
  setTabStart("search", focusSearch);
  setTabEnter("search", enterSearch);
  startDayStrip(findElement("seasonGames"));
  startGameSearch(findElement("gameSearch"), {
    readSeason: readSearchSeason,
    listDays: listSearchDays,
    renderTeamMark: renderDot,
    close: leaveSearch,
    readPages: readSearchPages,
    openPlace: openSearchPlace,
    placeholder: "Teams, players, and games",
  });
  keepOpenedStories(findElement("gameSearch"), drawNews);
  startGameSheet();
  startTeamSheet({
    isTeam: (team) => team in TEAMS,
    renderSheet: renderShownTeam,
    fillSections: fillRoster,
    sectionsKeeper: { read: readShownRoster, reopen: reopenRoster },
  });
  startRosterSection();
  startPlayerSheet();
  startSettingsSheet();
  startNewsRedraws(findElement("newsList"), drawNews, NEWS_LEAGUE);
  startHomeScreen();
  findSeasonPicker().addEventListener("change", () =>
    switchSeason(Number(findSeasonPicker().value)),
  );
  startBracket();
  startStandings();
  session.db = createWorkerStore();
  showJobStatuses(session.db, ["news", "players"]);
  drawLastSeen();
  reopenLastSheets();
  startCatchUpNote(session.db, renderStamp);
  startCaughtUpSweep(session.db, findElement("stamp"));
  startPullToRefresh({ store: session.db, catchUp });
  keepLastSeen(readShown);
  startSeasonData({
    showChange: showNewData,
    showStamp: renderStamp,
    showCurrentYear: showNewCurrentYear,
    showUnreadable: reloadIfReplaced,
  });
  const [years] = await Promise.all([listSeasonYears(), loadSeason()]);
  fillSeasonList(years);
  redrawEased(drawLoadedSeason);
  watchNews(session.db, (news) => {
    session.news = news;
    redrawEased(drawNews);
  });
  watchDismissals(() => redrawEased(drawUpdates));
  refreshClockEveryMinute();
  startServiceWorker();
  startNotifications({ about: "Post-season game final scores" });
}

boot();
