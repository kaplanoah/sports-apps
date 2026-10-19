import { renderCatchUpLines, startCatchUpNote } from "#shared/catch-up-note.js";
import { startCaughtUpSweep } from "#shared/caught-up-sweep.js";
import { startChannelTag } from "#shared/channel-tag.js";
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
import { listShownStories } from "#shared/page-places.js";
import { showJobStatuses, startDiagnostics } from "#shared/diagnostics.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { fillDayStrip, showStartDay, startDayStrip, startOverDayStrip } from "#shared/day-strip.js";
import { refreshGameSearch, startGameSearch } from "#shared/game-search-view.js";
import { listSearchGames } from "#shared/game-search.js";
import { trackKeyboardFocus } from "#shared/keyboard-focus.js";
import { keepLastRead } from "#shared/kept-read.js";
import { keepLastSeen, readLastSeen, reopenLastSheets } from "#shared/last-seen.js";
import { endLoadNote } from "#shared/load-note.js";
import { watchPresses } from "#shared/press.js";
import { startNotifications } from "#shared/notifications.js";
import { openPageTab, setTabStart, startPageTabs } from "#shared/page-tabs.js";
import { reloadIfReplaced, watchReturns } from "#shared/resume.js";
import { fillSeasonPicker, keepSeasonYears, watchSeasonPicks } from "#shared/season-picker.js";
import { isReadableSeason } from "#shared/season-reader.js";
import { startServiceWorker } from "#shared/service-worker.js";
import { isSettingShown, openSettings, startSettingsSheet } from "#shared/settings-sheet.js";
import { refreshTeamSheet, startTeamSheet } from "#shared/team-sheet.js";
import { fillStamp } from "#shared/stamp.js";
import { chooseTitleYear, showTitleYear } from "#shared/title-year.js";
import { createWorkerStore } from "#shared/worker-store.js";
import { startAppearance } from "#shared/appearance.js";
import {
  showSeasonPart,
  showSeasonPhase,
  startBracketStandings,
} from "#shared/bracket-standings.js";
import { BACKGROUND_JOBS } from "./background-jobs.js";
import { LOOKS } from "./looks.js";
import { placeBracket, readBracketScroll, startBracket } from "./bracket-tree.js";
import { renderBracket } from "./bracket-view.js";
import { openGameSection, refreshGameSheet, startGameSheet } from "./game-sheet.js";
import { renderDot } from "./clubs.js";
import { LEAGUE_WORDS } from "./league-words.js";
import { listFoundGameDays, listListedGames, listSeasonDays } from "./games-view.js";
import { NEWS_LEAGUE } from "./news-league.js";
import { refreshPlayerSheet, startPlayerSheet } from "./player-sheet.js";
import { fillRoster, readShownRoster, reopenRoster, startRosterSection } from "./roster-section.js";
import { loadSeason, loadSeasonYears, showYear, startSeasonData } from "./season-data.js";
import { isPastSeason, session } from "./session.js";
import { SNAPSHOT_VERSION } from "./snapshot.js";
import { isFieldSet, isPlayoffsOver } from "./series.js";
import { describeStampProblem, renderStampLines } from "./stamp.js";
import { drawStandings, showStandingsList } from "./standings-view.js";
import { listSearchPages } from "./search-pages.js";
import { createSearchTerms, readSearchGame } from "./search-terms.js";
import { renderTeamSheet } from "./team-view.js";
import { TEAMS } from "./teams.js";
import { drawUpdates, watchUpdatesSeen } from "./updates.js";

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
  showTitleYear(chooseTitleYear({ shownYear, currentYear, isSeasonOver }), LEAGUE_WORDS);
}

function renderAll() {
  const now = Date.now();
  showSeasonPhase(isFieldSet(session.season?.series ?? []));
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

const findSeasonRow = () => findElement("seasonRow");

const readSeasonYears = keepSeasonYears(loadSeasonYears);

/** @param {string[] | null} years */
const fillSeasonList = (years) =>
  fillSeasonPicker(
    findSeasonRow(),
    { years, shownYear: session.year, currentYear: session.currentYear },
    LEAGUE_WORDS,
  );

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
  fillSeasonList(await readSeasonYears());
}

const readSearchPages = () =>
  listSearchPages({
    index: session.playerIndex,
    isSettingShown,
    standings: session.season?.standings ?? [],
    stories: listShownStories(session.news, readNewsChoices(), NEWS_LEAGUE.outletSwitches),
  });

/**
 * Opens a place a search lists: a tab, the bracket or standings in theirs, one of the standings'
 * lists, a game's section, or settings at one of its rows.
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
    openPageTab("bracket-standings");
    showSeasonPart("standings", { isInstant: true });
    showStandingsList(detail);
  } else if (place === "highlights") openGameSection(detail, "highlights");
  else openSettings(key);
}

// A search reads the season on each key press, so its games and words are worked out again only
// once the season, its schedule, or the games known to have gone to overtime change.
const readSearchSeasonFrom = keepLastRead(
  /**
   * @param {any} season
   * @param {any} schedule
   * @param {any} overtimes
   */
  (season, schedule, overtimes) => {
    const listed = listListedGames(season, schedule);
    return {
      listed,
      terms: createSearchTerms({ games: listed, standings: season.standings }),
      games: listSearchGames(listed, (game) => readSearchGame(game, overtimes)),
    };
  },
);

function readSearchSeason() {
  const { season, schedule, overtimes } = session;
  return season ? readSearchSeasonFrom(season, schedule, overtimes) : null;
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
  setTabStart("games", showStartDay);
  startDayStrip(findElement("seasonGames"));
  startGameSearch(findElement("gameSearch"), {
    readSeason: readSearchSeason,
    listDays: listSearchDays,
    renderTeamMark: renderDot,
    readPages: readSearchPages,
    openPlace: openSearchPlace,
    placeholder: "Teams, players, and games",
  });
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
  startChannelTag();
  startNewsRedraws(findElement("newsList"), drawNews, NEWS_LEAGUE);
  startHomeScreen();
  watchSeasonPicks(findSeasonRow(), switchSeason);
  startBracket();
  startBracketStandings();
  session.db = createWorkerStore();
  showJobStatuses(session.db, BACKGROUND_JOBS);
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
  const [years] = await Promise.all([readSeasonYears(), loadSeason()]);
  fillSeasonList(years);
  redrawEased(drawLoadedSeason);
  watchNews(session.db, (news) => {
    session.news = news;
    redrawEased(drawNews);
    refreshGameSearch();
  });
  watchUpdatesSeen(() => redrawEased(drawUpdates));
  refreshClockEveryMinute();
  startServiceWorker();
  startNotifications({ about: "Final scores" });
}

boot();
