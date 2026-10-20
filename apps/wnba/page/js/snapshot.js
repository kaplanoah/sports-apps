// Runs in both the browser page and the Worker, so it uses no DOM and no globals.
// The league's own feeds: today's scoreboard and the season's schedule from its CDN, and the
// playoff bracket and the standings from its stats site. When the scoreboard doesn't answer,
// ESPN's stands in for today's scores and clocks, and for a game the schedule still holds as under
// way once the scoreboard no longer lists it. The league's feeds don't say where a game is on, so
// ESPN's scoreboard does, and it says when a game starts while the league's schedule still has its
// time to be decided.

import { readEasternDay } from "#shared/days.js";
import * as PollSchedule from "#shared/poll-schedule.js";
import { findTeamCode, findTeamCodeByEspnId, TEAMS } from "./teams.js";
import { findTeamNearestGames } from "./nearest-games.js";

// The shape of a snapshot, and of the season record saved from it, which a page reads only when it
// knows it.
export const SNAPSHOT_VERSION = 1;

// Every game of a season keeps a document of its own, which only the Games view reads, so the
// season's record that pages watch through every live game doesn't carry it.
/** @param {number} year */
export const nameScheduleKey = (year) => `schedules/${year}`;

const WNBA_CDN = "https://cdn.wnba.com";
const WNBA_STATS = "https://stats.wnba.com";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba";
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";

const LEAGUE_FEEDS = ["bracket", "schedule", "scoreboard", "standings"];

export const REQUESTS = {
  scoreboard: `${WNBA_CDN}/static/json/liveData/scoreboard/todaysScoreboard_10.json`,
  schedule: `${WNBA_CDN}/static/json/staticData/scheduleLeagueV2_10.json`,
  /** @param {number} season */
  bracket: (season) =>
    `${WNBA_STATS}/stats/playoffbracket?LeagueID=10&SeasonYear=${season}&State=2`,
  /** @param {number} season */
  standings: (season) =>
    `${WNBA_STATS}/stats/leaguestandingsv3?LeagueID=10&Season=${season}&SeasonType=Regular+Season`,
};

export const BACKUP_REQUESTS = {
  /**
   * @param {string} firstDay as YYYYMMDD
   * @param {string} lastDay as YYYYMMDD
   */
  events: (firstDay, lastDay) => `${ESPN_CORE}/events?dates=${firstDay}-${lastDay}`,
  /** @param {string} eventId */
  competition: (eventId) => `${ESPN_CORE}/events/${eventId}/competitions/${eventId}`,
};

// A month's scoreboard holds every game ESPN lists that month, with room to spare.
/** @param {string} month as YYYYMM */
export const NETWORKS_REQUEST = (month) => `${ESPN_SITE}/scoreboard?dates=${month}&limit=200`;

export const ROUNDS = {
  1: { name: "First Round", shortName: "1st Rd", bestOf: 3 },
  2: { name: "Semifinals", shortName: "Semis", bestOf: 5 },
  3: { name: "WNBA Finals", shortName: "Finals", bestOf: 7 },
};
/** @param {number} round */
export const countWinsNeeded = (round) => Math.ceil(ROUNDS[round].bestOf / 2);

// A playoff game's ID spells out where it sits: 104, the season's last two digits, 00, then its
// round, its series in that round from 0, and its game in the series.
const PLAYOFF_GAME_ID = /^104(\d{2})00([1-3])(\d)(\d)$/;

/** @param {string} id */
export function readPlayoffGameId(id) {
  const [, season, round, series, game] = String(id).match(PLAYOFF_GAME_ID) ?? [];
  if (!round) return null;
  return {
    season: 2000 + Number(season),
    round: Number(round),
    series: Number(series),
    game: Number(game),
  };
}

// The games of a season the Games view lists: its regular season's, the Commissioner's Cup final,
// which has a number of its own, the All-Star Game, and its playoffs'. The ID's 102, 105, 103, or
// 104 comes before the season's last two digits.
const SEASON_GAME_ID = /^10[2-5](\d{2})\d{5}$/;

const ALL_STAR_GAME_ID = /^103/;

// The All-Star Game's teams aren't the league's, so the game carries their names: a captain's name
// or a conference, without the feeds' "Team" before it, as every team shows its name without its
// city.
/** @param {any} game */
function readAllStarTeams(game) {
  if (!ALL_STAR_GAME_ID.test(String(game.gameId))) return {};
  /** @param {any} team */
  const nameTeam = (team) => team?.teamName || "TBD";
  return { allStar: { away: nameTeam(game.awayTeam), home: nameTeam(game.homeTeam) } };
}

/** @param {string} id */
function readGameSeason(id) {
  const [, season] = String(id).match(SEASON_GAME_ID) ?? [];
  return season ? 2000 + Number(season) : null;
}

// The Games view leaves out the preseason, whose games are numbered 101 and then the season's last
// two digits, but the season starts with its first game.
const PRESEASON_GAME_ID = /^101(\d{2})\d{5}$/;

/** @param {string} id */
function readAnyGameSeason(id) {
  const [, preseason] = String(id).match(PRESEASON_GAME_ID) ?? [];
  return preseason ? 2000 + Number(preseason) : readGameSeason(id);
}

/**
 * The league's day of the season's first game, its preseason's first when it has one, or null
 * while the schedule lists none of its games.
 * @param {any} schedule
 * @param {number} season
 * @returns {string | null}
 */
function readOpeningDay(schedule, season) {
  const starts = (schedule?.leagueSchedule?.gameDates ?? [])
    .flatMap((day) => day.games)
    .filter((game) => readAnyGameSeason(game.gameId) === season)
    .map((game) => Date.parse(game.gameDateTimeUTC))
    .filter(Number.isFinite);
  return starts.length ? readEasternDay(Math.min(...starts)).date : null;
}

const nameSeries = (round, series) => `${round}-${series}`;

const GAME_STATES = { 1: "pre", 2: "live", 3: "final" };

/** @param {number} gameStatus the feeds' 1, 2, or 3 */
export const readGameState = (gameStatus) => GAME_STATES[gameStatus] ?? "pre";

// The CDN's clock reads like PT04M32.00S; the page shows 4:32, and tenths under a minute.
export function readClock(clock) {
  const [, minutes, seconds] = String(clock ?? "").match(/^PT(\d+)M([\d.]+)S$/) ?? [];
  if (minutes === undefined) return null;
  const wholeMinutes = Number(minutes);
  const exactSeconds = Number(seconds);
  if (wholeMinutes === 0 && exactSeconds < 60) return exactSeconds.toFixed(1);
  return `${wholeMinutes}:${String(Math.floor(exactSeconds)).padStart(2, "0")}`;
}

const readSide = (team) => ({
  team: team.teamTricode || null,
  seed: team.seed ?? null,
  score: team.score ?? null,
  seriesWins: team.wins ?? null,
  isInBonus: team.inBonus === "1" || team.inBonus === 1 || team.inBonus === true,
  timeouts: team.timeoutsRemaining ?? null,
});

// Where a game is played, once the schedule names its arena, and whether the league counts it as at
// a neutral site, away from its home team's own arena.
/** @param {any} game */
function readArena(game) {
  const city = game.arenaCity?.trim();
  if (!city || /^TBD$/i.test(city)) return {};
  return {
    arena: { name: game.arenaName?.trim() ?? "", city, state: game.arenaState?.trim() ?? "" },
    ...(game.isNeutral === true && { isNeutral: true }),
  };
}

// A game from the scoreboard or the schedule, which name their fields alike. Only a playoff game
// has a round, a series, and a number in it.
function normalizeGame(game) {
  const place = readPlayoffGameId(game.gameId);
  const state = readGameState(game.gameStatus);
  return {
    id: String(game.gameId),
    round: place?.round ?? null,
    series: place ? nameSeries(place.round, place.series) : null,
    number: place?.game ?? null,
    start: game.gameDateTimeUTC ?? game.gameTimeUTC ?? null,
    state,
    status: game.gameStatusText?.trim() || "",
    // A game whose time isn't set yet reads TBD, and its start is a placeholder on its day.
    isTimeSet: !/^TBD$/i.test(game.gameStatusText?.trim() ?? ""),
    period: state === "pre" ? null : (game.period ?? null),
    clock: state === "live" ? readClock(game.gameClock) : null,
    isIfNeeded: !!game.ifNecessary,
    away: readSide(game.awayTeam ?? {}),
    home: readSide(game.homeTeam ?? {}),
    ...readAllStarTeams(game),
    ...readArena(game),
  };
}

const readSeed = (tricode, rank) => (tricode ? { team: tricode, seed: rank || null } : null);

function readBracketSeries(series) {
  const top = readSeed(series.highSeedTricode, series.highSeedRank);
  const bottom = readSeed(series.lowSeedTricode, series.lowSeedRank);
  return {
    id: nameSeries(series.roundNumber, series.seriesNumber),
    round: series.roundNumber,
    top: top && { ...top, wins: series.highSeedSeriesWins ?? 0 },
    bottom: bottom && { ...bottom, wins: series.lowSeedSeriesWins ?? 0 },
    winner: findTeamCode(series.seriesWinner),
    status: series.seriesText?.trim() || "",
    nextGame: series.nextGameId
      ? { id: String(series.nextGameId), start: series.nextGameDateTimeUTC || null }
      : null,
  };
}

/**
 * The stats site answers with a table: its column names, then a row of values for each line.
 * @param {any} response
 * @returns {Record<string, any>[]}
 */
function readStatsTable(response) {
  const table = response?.resultSets?.[0];
  if (!table) return [];
  return table.rowSet.map((row) =>
    Object.fromEntries(table.headers.map((header, index) => [header, row[index]])),
  );
}

// The standings' PlayoffRank is the league-wide place, and its LeagueRank the conference place.
function readStandingsRows(response) {
  return readStatsTable(response)
    .map((row) => ({
      team: findTeamCode(row.TeamID),
      conference: row.Conference,
      wins: row.WINS,
      losses: row.LOSSES,
      place: row.PlayoffRank,
      conferencePlace: row.LeagueRank,
      gamesBack: row.LeagueGamesBack ?? null,
      conferenceGamesBack: row.ConferenceGamesBack ?? null,
      clinch: String(row.ClinchIndicator ?? "").replace(/^\s*-\s*/, "") || null,
      streak: row.strCurrentStreak || null,
      lastTen: row.L10 || null,
      pointsFor: row.PointsPG ?? null,
      pointsAgainst: row.OppPointsPG ?? null,
      margin: row.DiffPointsPG ?? null,
      home: row.HOME || null,
      road: row.ROAD || null,
    }))
    .filter((row) => row.team)
    .sort((first, second) => first.place - second.place);
}

// The schedule and the scoreboard hold the last season's games until the league starts the next.
const listSeasonGames = (games, season) =>
  games.filter((game) => readGameSeason(game.gameId) === season);

const isPlayoffGame = (game) => game.round !== null;

// The Games view lists every game of the season, which the store saves on its own, again only as a
// game ends or the schedule changes. A game under way is listed as it was before it started, since
// the season's record carries it while it's played, as each team's game now, and only a final
// keeps its score and status, since a row shows a game's start until then.
/**
 * @param {{ team: string | null, seed: number | null, score: number | null }} side
 * @param {boolean} isFinal
 */
const readScheduledSide = ({ team, seed, score }, isFinal) => ({
  team,
  seed,
  score: isFinal ? score : null,
  isInBonus: false,
});

/** @param {any} game */
function readScheduledGame(game) {
  const isFinal = game.state === "final";
  return {
    id: game.id,
    round: game.round,
    series: game.series,
    number: game.number,
    start: game.start,
    state: isFinal ? "final" : "pre",
    status: isFinal ? game.status : "",
    isTimeSet: game.isTimeSet,
    period: null,
    clock: null,
    isIfNeeded: game.isIfNeeded,
    away: readScheduledSide(game.away, isFinal),
    home: readScheduledSide(game.home, isFinal),
    ...(game.allStar && { allStar: game.allStar }),
    ...(game.arena && { arena: game.arena }),
    ...(game.isNeutral && { isNeutral: true }),
  };
}

const sortByStart = (games) =>
  games.sort((first, second) => Date.parse(first.start) - Date.parse(second.start));

const listScheduleGames = (schedule, season) =>
  listSeasonGames(
    (schedule?.leagueSchedule?.gameDates ?? []).flatMap((day) => day.games),
    season,
  );

// The scoreboard is the freshest word on today's games, so it replaces the schedule's copy, but for
// the arena, which only the schedule names.
function mergeGames(schedule, scoreboard, season) {
  const scheduled = listScheduleGames(schedule, season).map(normalizeGame);
  const today = listSeasonGames(scoreboard?.scoreboard?.games ?? [], season).map(normalizeGame);
  const byId = new Map(scheduled.map((game) => [game.id, game]));
  for (const game of today) byId.set(game.id, { ...byId.get(game.id), ...game });
  return sortByStart([...byId.values()]);
}

// A team not known yet has a seed of 0 in the feeds, and goes after the one that is, as in the bracket.
const readSeedOrder = (side) => (side.team ? side.seed : Infinity);

// A series counts its wins from the games it has finished, with or without the bracket.
function countSeriesFromGames(games) {
  const series = {};
  for (const game of games) {
    if (!game.series) continue;
    const [top, bottom] = [game.home, game.away].sort(
      (first, second) => readSeedOrder(first) - readSeedOrder(second),
    );
    series[game.series] ??= {
      id: game.series,
      round: game.round,
      top: top.team ? { team: top.team, seed: top.seed, wins: 0 } : null,
      bottom: bottom.team ? { team: bottom.team, seed: bottom.seed, wins: 0 } : null,
      winner: null,
      status: "",
      nextGame: null,
    };
    const record = series[game.series];
    if (game.state !== "final" || !record.top || !record.bottom) continue;
    const winner = game.home.score > game.away.score ? game.home.team : game.away.team;
    const side = winner === record.top.team ? record.top : record.bottom;
    side.wins += 1;
    if (side.wins >= countWinsNeeded(game.round)) record.winner = side.team;
  }
  return Object.values(series);
}

function addCountedWins(side, counted) {
  if (!side) return null;
  const countedSide = [counted?.top, counted?.bottom].find((other) => other?.team === side.team);
  return { ...side, wins: Math.max(side.wins, countedSide?.wins ?? 0) };
}

const findSeriesWinner = (round, sides) =>
  sides.find((side) => side && side.wins >= countWinsNeeded(round))?.team ?? null;

// The first game of the series not yet finished.
function findNextGame(seriesId, games) {
  const [next] = games
    .filter((game) => game.series === seriesId && game.state !== "final")
    .sort((first, second) => first.number - second.number);
  return next ? { id: next.id, start: next.start } : null;
}

// The bracket trails a final by minutes, so each side keeps the most wins either the bracket or
// the finished games give it, and a next game already finished gives way to the one after it.
function combineSeries(bracketSeries, countedSeries, games) {
  const countedById = new Map(countedSeries.map((record) => [record.id, record]));
  const finishedIds = new Set(
    games.filter((game) => game.state === "final").map((game) => game.id),
  );
  return bracketSeries.map((record) => {
    const counted = countedById.get(record.id);
    const top = addCountedWins(record.top, counted);
    const bottom = addCountedWins(record.bottom, counted);
    const winner = record.winner ?? findSeriesWinner(record.round, [top, bottom]);
    const isNextGameFinished = !!record.nextGame && finishedIds.has(record.nextGame.id);
    const nextGame = winner
      ? null
      : isNextGameFinished
        ? findNextGame(record.id, games)
        : record.nextGame;
    const hasNewWins = top?.wins !== record.top?.wins || bottom?.wins !== record.bottom?.wins;
    return { ...record, top, bottom, winner, nextGame, status: hasNewWins ? "" : record.status };
  });
}

const BACKUP_STATES = { pre: "pre", in: "live", post: "final" };

/** @param {{ competition: any, status: any, scores: any[] }} answers */
function readBackupGame({ competition, status, scores }) {
  const state = BACKUP_STATES[status?.type?.state] ?? "pre";
  const sides = Object.fromEntries(
    competition.competitors.map((competitor, index) => [
      competitor.homeAway,
      { team: findTeamCodeByEspnId(competitor.id), score: scores[index]?.value ?? null },
    ]),
  );
  return {
    start: competition.date,
    state,
    status: status?.type?.shortDetail?.trim() || "",
    period: state === "pre" ? null : (status?.period ?? null),
    clock: state === "live" ? (status?.displayClock ?? null) : null,
    home: sides.home,
    away: sides.away,
  };
}

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const isSameMatchup = (game, backup) =>
  game.home.team === backup.home?.team && game.away.team === backup.away?.team;
const measureStartGap = (game, backup) =>
  Math.abs(Date.parse(game.start) - Date.parse(backup.start));

// ESPN numbers its games its own way, so an ESPN game stands for the league's game between the
// same home and away teams that starts nearest it.
function findEspnGame(game, espnGames) {
  const [nearest] = espnGames
    .filter((espnGame) => isSameMatchup(game, espnGame))
    .filter((espnGame) => measureStartGap(game, espnGame) < MATCH_WINDOW_MS)
    .sort((first, second) => measureStartGap(game, first) - measureStartGap(game, second));
  return nearest ?? null;
}

/**
 * The IDs of the games the schedule holds as under way that the scoreboard, which answered, doesn't
 * list. The league's schedule catches up on a game only now and then, so once the scoreboard moves
 * on to the next day, it can still hold the night before's last game as under way.
 * @param {any} schedule
 * @param {any} scoreboard
 * @param {number} season
 * @returns {Set<string>}
 */
export function listGamesLeftLive(schedule, scoreboard, season) {
  if (!scoreboard) return new Set();
  const listed = new Set((scoreboard.scoreboard?.games ?? []).map((game) => String(game.gameId)));
  return new Set(
    listScheduleGames(schedule, season)
      .filter((game) => readGameState(game.gameStatus) === "live")
      .map((game) => String(game.gameId))
      .filter((id) => !listed.has(id)),
  );
}

// ESPN stands in for every game while the scoreboard doesn't answer, and otherwise only for those
// the schedule has left under way.
function listGamesForBackup(games, responses, season) {
  if (!responses.scoreboard) return games;
  const leftLive = listGamesLeftLive(responses.schedule, responses.scoreboard, season);
  return games.filter((game) => leftLive.has(game.id));
}

// Each league game a started ESPN game stands for, by the league's game ID. A game ESPN hasn't
// started keeps the league's own word on it.
function matchBackupGames(games, backupGames) {
  const startedGames = backupGames.filter((backup) => backup.state !== "pre");
  return new Map(
    games.map((game) => [game.id, findEspnGame(game, startedGames)]).filter(([, backup]) => backup),
  );
}

function applyBackupGame(game, backup) {
  const { state, status, period, clock } = backup;
  return {
    ...game,
    state,
    status,
    period,
    clock,
    away: { ...game.away, score: backup.away.score },
    home: { ...game.home, score: backup.home.score },
  };
}

const isNational = (broadcast) => broadcast.market === "national";
const isLocal = (broadcast) => !isNational(broadcast);

// What an ESPN scoreboard game is on, its national channels first.
function readNetworkGame(event) {
  const competition = event.competitions?.[0] ?? {};
  const sides = Object.fromEntries(
    (competition.competitors ?? []).map((competitor) => [
      competitor.homeAway,
      { team: findTeamCodeByEspnId(competitor.id) },
    ]),
  );
  const broadcasts = competition.broadcasts ?? [];
  const ordered = [...broadcasts.filter(isNational), ...broadcasts.filter(isLocal)];
  return {
    start: competition.date ?? event.date,
    isTimeSet: competition.timeValid === true,
    home: sides.home,
    away: sides.away,
    networks: [...new Set(ordered.flatMap((broadcast) => broadcast.names ?? []))],
  };
}

// Until ESPN names both teams, its game could be any of a round's games at that time.
const hasBothTeams = (networkGame) => !!(networkGame.home?.team && networkGame.away?.team);

const readStartDay = (game) => readEasternDay(Date.parse(game.start)).date;
const isOnSameDay = (game, espnGame) => readStartDay(game) === readStartDay(espnGame);

// Matched by day rather than by the nearest start, since the league's placeholder start, at midnight
// Eastern, can be nearer the same teams' game the night before.
function findEspnStart(game, networkGames) {
  const timed = networkGames.find(
    (espnGame) =>
      espnGame.isTimeSet && isSameMatchup(game, espnGame) && isOnSameDay(game, espnGame),
  );
  return timed?.start ?? null;
}

function addEspnStart(game, networkGames) {
  if (game.isTimeSet || !game.start) return game;
  const start = findEspnStart(game, networkGames);
  return start ? { ...game, start, isTimeSet: true } : game;
}

/**
 * Where each game is or was on, and when one the league hasn't timed yet starts, as far as ESPN
 * knows.
 * @param {any[]} games
 * @param {any[]} networkGames
 */
function addEspnListings(games, networkGames) {
  const known = networkGames.filter(hasBothTeams);
  return sortByStart(
    games
      .map((game) => addEspnStart(game, known))
      .map((game) => ({ ...game, networks: findEspnGame(game, known)?.networks ?? [] })),
  );
}

/**
 * Each team's nearest games, each game once, in order of start: its last, the one it's playing,
 * and its next. A game left over in a series that's already decided won't be played.
 * @param {any[]} games the season's games, in order of start
 * @param {any[]} series
 */
function listNearestGames(games, series) {
  const decided = new Set(series.filter((each) => each.winner).map((each) => each.id));
  const nearest = new Set(
    Object.keys(TEAMS).flatMap((team) =>
      Object.values(findTeamNearestGames(games, team, decided)).filter(Boolean),
    ),
  );
  return games.filter((game) => nearest.has(game));
}

/**
 * When each of the season's playoff games and each team's nearest games start, as the league's
 * schedule has them.
 * @param {any} schedule
 * @param {number} season
 * @returns {string[]}
 */
export function listScheduledStarts(schedule, season) {
  const games = mergeGames(schedule, null, season);
  const playoffs = games.filter(isPlayoffGame);
  const nearest = listNearestGames(games, countSeriesFromGames(playoffs));
  return [...new Set([...playoffs, ...nearest])].map((game) => game.start).filter(Boolean);
}

/**
 * @param {{ scoreboard?: any, schedule?: any, bracket?: any, standings?: any, backup?: { games: any[] } | null, networks?: any[] | null }} responses
 * @param {{ season: number, now?: number }} options
 */
export function buildSnapshot(responses, { season, now = Date.now() }) {
  const backupGames = (responses.backup?.games ?? []).map(readBackupGame);
  const leagueGames = mergeGames(responses.schedule, responses.scoreboard, season);
  const standIns = matchBackupGames(
    listGamesForBackup(leagueGames, responses, season),
    backupGames,
  );
  const seasonGames = addEspnListings(
    leagueGames.map((game) =>
      standIns.has(game.id) ? applyBackupGame(game, standIns.get(game.id)) : game,
    ),
    (responses.networks ?? []).flatMap((answer) => answer.events ?? []).map(readNetworkGame),
  );
  const games = seasonGames.filter(isPlayoffGame);
  const bracket = responses.bracket?.bracket?.playoffBracketSeries;
  const countedSeries = countSeriesFromGames(games);
  const series = bracket
    ? combineSeries(bracket.map(readBracketSeries), countedSeries, games)
    : countedSeries;
  return {
    version: SNAPSHOT_VERSION,
    season,
    asOf: new Date(now).toISOString(),
    games,
    nearestGames: listNearestGames(seasonGames, series),
    schedule: seasonGames.map(readScheduledGame),
    series,
    standings: readStandingsRows(responses.standings),
    missing: LEAGUE_FEEDS.filter((name) => !responses[name]),
    standIn: standIns.size ? "espn" : null,
    openingDay: readOpeningDay(responses.schedule, season),
  };
}

const POLL_LIVE_MS = 15 * 1000;
// The last minutes of the 4th quarter and all of overtime are followed as fast as the Worker's
// copy of the scoreboard turns over.
const POLL_CLOSING_MS = 5 * 1000;
const FOURTH_QUARTER = 4;
const CLOSING_SECONDS = 5 * 60;

// A clock reads like 4:32, or 45.2 under a minute.
function readClockSeconds(clock) {
  const [minutes, seconds] = clock.includes(":") ? clock.split(":") : ["0", clock];
  return Number(minutes) * 60 + Number(seconds);
}

function isClosingStretch(game) {
  if (game.state !== "live") return false;
  if (game.period > FOURTH_QUARTER) return true;
  return (
    game.period === FOURTH_QUARTER &&
    typeof game.clock === "string" &&
    readClockSeconds(game.clock) <= CLOSING_SECONDS
  );
}

// A live game on a team's sheet is followed as closely as a playoff game.
export function choosePollDelay(snapshot, now = Date.now()) {
  const games = [...(snapshot?.games ?? []), ...(snapshot?.nearestGames ?? [])];
  return PollSchedule.choosePollDelay({
    isLive: games.some((game) => game.state === "live"),
    starts: games
      .filter((game) => game.state === "pre" && game.isTimeSet)
      .map((game) => Date.parse(game.start)),
    liveMs: games.some(isClosingStretch) ? POLL_CLOSING_MS : POLL_LIVE_MS,
    now,
  });
}
