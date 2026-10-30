// WNBA's scoreboard, schedule, bracket, and standings adapted to app-owned records.
// ESPN supplies channels and unset starts, and stands in for a failed scoreboard or games left live.

import {
  BasketballSnapshot,
  BasketballGames,
  BasketballSeries,
  BasketballStandings,
  validateSportsData,
} from "../../../../../shared/worker/sports-schema.js";
import {
  readBackupGames,
  readNetworkGames,
  nameEspnSite,
  nameEspnDayRequest,
  nameEspnNetworksRequest,
} from "../../../../../shared/worker/espn-adapter.js";
import { listTimedReminderGames } from "#shared/reminder-games.js";
import { isStillIfNecessary } from "#shared/series-text.js";
import { addDays, readEasternDay } from "#shared/days.js";
import * as PollSchedule from "#shared/poll-schedule.js";
import { readLeagueDate } from "../../../page/js/days.js";
import { findTeamCode, findTeamCodeByEspnId, TEAMS } from "../../../page/js/teams.js";
import {
  findTeamNearestGames,
  isPlayable,
  isPutOff,
  isToBePlayed,
  mapSeriesById,
} from "../../../page/js/nearest-games.js";
import { REGULATION_PERIODS } from "../../../page/js/periods.js";
import { SNAPSHOT_VERSION, countWinsNeeded, GAME_PREFIXES } from "../../../page/js/snapshot.js";

export { formatEspnDay } from "../../../../../shared/worker/espn-adapter.js";
export const ESPN_SPORT = "basketball/wnba";
export const ESPN_SITE = nameEspnSite(ESPN_SPORT);
export const ESPN_DAY_REQUEST = (day) => nameEspnDayRequest(ESPN_SPORT, day);
export const NETWORKS_REQUEST = (month) => nameEspnNetworksRequest(ESPN_SPORT, month);

const WNBA_CDN = "https://cdn.wnba.com";
const WNBA_STATS = "https://stats.wnba.com";
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

// The playoff suffix locates a game's round, series from zero, and game within that series.
const PLAYOFF_GAME_ID = new RegExp(`^${GAME_PREFIXES.playoffs}(\\d{2})00([1-3])(\\d)(\\d)$`);

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
// which has a number of its own, the All-Star Game, and its playoffs'.
const SEASON_GAME_ID = new RegExp(
  `^(?:${[GAME_PREFIXES.regularSeason, GAME_PREFIXES.allStar, GAME_PREFIXES.playoffs, GAME_PREFIXES.cupFinal].join("|")})(\\d{2})\\d{5}$`,
);

const ALL_STAR_GAME_ID = new RegExp(`^${GAME_PREFIXES.allStar}`);

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

// The Games view leaves out the preseason, but the season starts with its first game.
const PRESEASON_GAME_ID = new RegExp(`^${GAME_PREFIXES.preseason}(\\d{2})\\d{5}$`);

/** @param {string} id */
export function readAnyGameSeason(id) {
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

/** @param {number} gameStatus */
export const readStrictGameState = (gameStatus) =>
  typeof gameStatus === "number" ? GAME_STATES[gameStatus] : undefined;

/** @param {number} gameStatus the feeds' 1, 2, or 3 */
const readGameState = (gameStatus) => readStrictGameState(gameStatus) ?? "pre";

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
 * @param {Pick<import("../../../../../shared/worker/sports-schema.js").BasketballGameRecord["away"], "team" | "seed" | "score">} side
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

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const isSameMatchup = (game, backup) =>
  game.home.team === backup.home?.team && game.away.team === backup.away?.team;
const measureStartGap = (game, backup) =>
  Math.abs(Date.parse(game.start) - Date.parse(backup.start));
const isOnSameDay = (game, espnGame) =>
  readLeagueDate(game.start) === readLeagueDate(espnGame.start);

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

/**
 * Whether the scoreboard, which answered, lists every game the schedule has on the league's day of
 * `now`. Its word on each game it lists replaces the schedule's, so a schedule kept from an earlier
 * read then holds nothing older than the scoreboard for today's games.
 * @param {any} schedule
 * @param {any} scoreboard
 * @param {number} season
 * @param {number} now
 */
export function isTodayOnScoreboard(schedule, scoreboard, season, now) {
  if (!scoreboard) return false;
  const listed = new Set(
    listSeasonGames(scoreboard.scoreboard?.games ?? [], season).map((game) => String(game.gameId)),
  );
  return listTodayGames(schedule, season, now).every((game) => listed.has(game.id));
}

/**
 * Whether ESPN's backup, which answered, agrees with the schedule on the games of the league's day
 * of `now`, as the scoreboard would while it doesn't answer. ESPN's word on a game it has started
 * replaces the schedule's, and one it hasn't must start when the schedule says and not be put off.
 * Each game ESPN has on that day and hasn't put off must be one of the schedule's too, so a schedule
 * kept from an earlier read then holds nothing older than ESPN for today's games, a game moved into
 * today too.
 * @param {any} schedule
 * @param {{ answers: any[] } | null | undefined} backup
 * @param {number} season
 * @param {number} now
 */
export function isTodayOnBackup(schedule, backup, season, now) {
  if (!backup) return false;
  const backupGames = readBackupGames(backup, findTeamCodeByEspnId);
  const todayGames = listTodayGames(schedule, season, now);
  const backupTodayGames = backupGames.filter(
    (backupGame) =>
      hasBothTeams(backupGame) && !isPutOff(backupGame) && isOnLeagueToday(backupGame, now),
  );
  return (
    todayGames.every((game) => isBackupAgreeing(game, findAnsweringGame(game, backupGames))) &&
    backupTodayGames.every((backupGame) =>
      todayGames.some((game) => isSameMatchup(game, backupGame)),
    )
  );
}

// A game whose time isn't set gets no reminder, so only a set time has to match ESPN's.
/** @param {any} game @param {any} backup */
const isBackupAgreeing = (game, backup) =>
  !!backup &&
  (backup.state !== "pre" ||
    (!isPutOff(backup) &&
      (!game.isTimeSet || Date.parse(game.start) === Date.parse(backup.start))));

/** @param {{ start: string | null }} game @param {number} now */
const isOnLeagueToday = (game, now) => readLeagueDate(game.start) === readEasternDay(now).date;

/** @param {any} schedule @param {number} season @param {number} now */
function listTodayGames(schedule, season, now) {
  return listScheduleGames(schedule, season)
    .map(normalizeGame)
    .filter((game) => isOnLeagueToday(game, now));
}

// ESPN stands in for every game while the scoreboard doesn't answer, and otherwise only for those
// the schedule has left under way.
function listGamesForBackup(games, responses, season) {
  if (!responses.scoreboard) return games;
  const leftLive = listGamesLeftLive(responses.schedule, responses.scoreboard, season);
  return games.filter((game) => leftLive.has(game.id));
}

const isScored = (backup) =>
  typeof backup.away?.score === "number" && typeof backup.home?.score === "number";

// The ESPN game that is a league game's own, on the league's day for it, when it answers for it: one
// ESPN hasn't started, or one it gives both scores for. Another game between the same teams, like
// the night before's, never stands in for it.
function findAnsweringGame(game, backupGames) {
  const sameDay = backupGames.filter((backup) => isOnSameDay(game, backup));
  const backup = findEspnGame(game, sameDay);
  return backup && (backup.state === "pre" || isScored(backup)) ? backup : null;
}

// Each league game a started ESPN game stands for, by the league's game ID. A game ESPN hasn't
// started, or gives no score for, keeps the league's own word on it.
function matchBackupGames(games, backupGames) {
  return new Map(
    games
      .map((game) => [game.id, findAnsweringGame(game, backupGames)])
      .filter(([, backup]) => backup && backup.state !== "pre"),
  );
}

// While the scoreboard is down, ESPN covers it once it answers for one of the league's games, started
// or not, so the page doesn't warn of the scoreboard only until a game tips off.
/**
 * @param {any[]} games
 * @param {{ scoreboard?: any }} responses
 * @param {any[]} backupGames
 */
const isEspnCovering = (games, responses, backupGames) =>
  !responses.scoreboard && games.some((game) => !!findAnsweringGame(game, backupGames));

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

// Until ESPN names both teams, its game could be any of a round's games at that time.
const hasBothTeams = (espnGame) => !!(espnGame.home?.team && espnGame.away?.team);

// A game from the league's yesterday that isn't over is one the scoreboard still holds past
// midnight, or one the schedule hasn't caught up on. An older one left unplayed or unfinished is the
// schedule's to settle, not the scoreboard's to score.
/**
 * @param {{ start: string | null }} game
 * @param {number} now
 */
function isOnScoreboardDay({ start }, now) {
  const date = readLeagueDate(start);
  const today = readEasternDay(now).date;
  return !!date && date >= addDays(today, -1) && date <= today;
}

/**
 * Whether a game's score is the league scoreboard's to send: one on the league's today or yesterday
 * that's under way, or to be played between known teams.
 * @param {import("../../../page/js/nearest-games.js").SeasonGame & { start: string | null }} game
 * @param {Map<string, import("../../../page/js/nearest-games.js").DecidedSeries>} seriesById
 * @param {number} now
 */
export function isScoreboardGame(game, seriesById, now) {
  if (!isOnScoreboardDay(game, now)) return false;
  return game.state === "live" || (game.state === "pre" && isPlayable(game, seriesById));
}

// The scoreboard has no score to send for a game before it's due, so a feed that refuses then
// keeps nothing from fans, though the schedule alone may still be behind on the game. A game
// without a set time starts at midnight Eastern, so it's due all its day.
/**
 * Whether the scoreboard owes fans a game's score now: one of its games under way or past its start.
 * @param {import("../../../page/js/nearest-games.js").SeasonGame & { start: string | null }} game
 * @param {Map<string, import("../../../page/js/nearest-games.js").DecidedSeries>} seriesById
 * @param {number} now
 */
export const isScoreDue = (game, seriesById, now) =>
  isScoreboardGame(game, seriesById, now) &&
  (game.state === "live" || Date.parse(String(game.start)) <= now);

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
 * and its next.
 * @param {any[]} games the season's games, in order of start
 * @param {any[]} series
 */
function listNearestGames(games, series) {
  const seriesById = mapSeriesById(series);
  const nearest = new Set(
    Object.keys(TEAMS).flatMap((team) =>
      Object.values(findTeamNearestGames(games, team, seriesById)).filter(Boolean),
    ),
  );
  return games.filter((game) => nearest.has(game));
}

/** @param {any} game */
const isTimedToCome = (game) => game.state === "pre" && game.isTimeSet;

/**
 * When the league had each of the season's games it put off and hasn't played to start, regular
 * season and playoffs, kept apart since the schedule's copy of a game to come leaves out its status.
 * @param {any[]} games
 * @returns {string[]}
 */
const listPutOffStarts = (games) =>
  games.filter((game) => isTimedToCome(game) && isPutOff(game)).map((game) => game.start);

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
 * @param {any} game
 * @param {Map<string, any>} seriesById
 */
function isStillIfNeeded(game, seriesById) {
  if (!isPlayoffGame(game)) return false;
  const series = seriesById.get(game.series);
  return isStillIfNecessary({
    state: game.state,
    ifNecessary: game.isIfNeeded,
    number: game.number,
    winsNeeded: countWinsNeeded(game.round),
    wins: [series?.top?.wins ?? 0, series?.bottom?.wins ?? 0],
  });
}

/**
 * @param {{ scoreboard?: any, schedule?: any, bracket?: any, standings?: any, backup?: { answers: any[] } | null, networks?: any[] | null }} responses
 * @param {{ season: number, now?: number }} options
 */
export function buildSnapshot(responses, { season, now = Date.now() }) {
  const backupGames = readBackupGames(responses.backup, findTeamCodeByEspnId);
  const leagueGames = mergeGames(responses.schedule, responses.scoreboard, season);
  const standIns = matchBackupGames(
    listGamesForBackup(leagueGames, responses, season),
    backupGames,
  );
  const listedGames = addEspnListings(
    leagueGames.map((game) =>
      standIns.has(game.id) ? applyBackupGame(game, standIns.get(game.id)) : game,
    ),
    readNetworkGames(responses.networks ?? [], findTeamCodeByEspnId),
  );
  const playoffGames = listedGames.filter(isPlayoffGame);
  const bracket = responses.bracket?.bracket?.playoffBracketSeries;
  const countedSeries = countSeriesFromGames(playoffGames);
  const series = bracket
    ? combineSeries(bracket.map(readBracketSeries), countedSeries, playoffGames)
    : countedSeries;
  const seriesById = mapSeriesById(series);
  const seasonGames = listedGames.map((game) => ({
    ...game,
    isIfNeeded: isStillIfNeeded(game, seriesById),
  }));
  const games = seasonGames.filter(isPlayoffGame);
  return validateSportsData(BasketballSnapshot, {
    version: SNAPSHOT_VERSION,
    season,
    asOf: new Date(now).toISOString(),
    games,
    nearestGames: listNearestGames(seasonGames, series),
    putOffStarts: listPutOffStarts(seasonGames),
    schedule: seasonGames.map(readScheduledGame),
    series,
    standings: readStandingsRows(responses.standings),
    missing: LEAGUE_FEEDS.filter((name) => !responses[name]),
    standIn: standIns.size ? "espn" : null,
    scoreboardCover: isEspnCovering(leagueGames, responses, backupGames) ? "espn" : null,
    isTodayOnBackup: isTodayOnBackup(responses.schedule, responses.backup, season, now),
    hasNoScoreboardGame:
      !!responses.schedule && !seasonGames.some((game) => isScoreboardGame(game, seriesById, now)),
    // Without the schedule, which says when each game starts, a score may be due.
    hasScoreDue:
      !responses.schedule || seasonGames.some((game) => isScoreDue(game, seriesById, now)),
    openingDay: readOpeningDay(responses.schedule, season),
  });
}

const POLL_LIVE_MS = 15 * 1000;
// The last minutes of the 4th quarter and all of overtime are followed as fast as the Worker's
// copy of the scoreboard turns over.
const POLL_CLOSING_MS = 5 * 1000;
const CLOSING_SECONDS = 5 * 60;

// A clock reads like 4:32, or 45.2 under a minute.
function readClockSeconds(clock) {
  const [minutes, seconds] = clock.includes(":") ? clock.split(":") : ["0", clock];
  return Number(minutes) * 60 + Number(seconds);
}

function isClosingStretch(game) {
  if (game.state !== "live") return false;
  if (game.period > REGULATION_PERIODS) return true;
  return (
    game.period === REGULATION_PERIODS &&
    typeof game.clock === "string" &&
    readClockSeconds(game.clock) <= CLOSING_SECONDS
  );
}

// A live game on a team's sheet is followed as closely as a playoff game.
export function choosePollDelay(snapshot, now = Date.now()) {
  const games = [...(snapshot?.games ?? []), ...(snapshot?.nearestGames ?? [])];
  const seriesById = mapSeriesById(snapshot?.series);
  return PollSchedule.choosePollDelay({
    isLive: games.some((game) => game.state === "live"),
    starts: games
      .filter((game) => isTimedToCome(game) && isToBePlayed(game, seriesById))
      .map((game) => Date.parse(game.start)),
    putOffStarts: (snapshot?.putOffStarts ?? []).map(Date.parse),
    liveMs: games.some(isClosingStretch) ? POLL_CLOSING_MS : POLL_LIVE_MS,
    now,
  });
}

/** @param {any} snapshot */
export function listReminderGames(snapshot) {
  if (!REMINDER_FEEDS.every((name) => isReminderFeedHeard(snapshot, name))) return null;
  const series = mapSeriesById(snapshot.series);
  return listTimedReminderGames(
    snapshot.games.filter((game) => isConfirmedReminderGame(game, series)),
    snapshot.season,
    (game) => ({ away: TEAMS[game.away.team]?.name, home: TEAMS[game.home.team]?.name }),
  );
}

const REMINDER_FEEDS = ["schedule", "scoreboard", "bracket"];

// ESPN answering for each of today's games stands in for the scoreboard.
const isReminderFeedHeard = (snapshot, name) =>
  !snapshot.missing.includes(name) || (name === "scoreboard" && snapshot.isTodayOnBackup);

const isConfirmedReminderGame = (game, seriesById) =>
  game.state === "pre" && game.isTimeSet && isToBePlayed(game, seriesById) && !game.isIfNeeded;

/** @param {string} name @param {any} answer @param {{ season?: number }} [options] */
export function validateFeedResponse(name, answer, { season } = {}) {
  if (name === "backup") readBackupGames({ answers: [answer] }, findTeamCodeByEspnId);
  if (name === "networks") readNetworkGames([answer], findTeamCodeByEspnId);
  if (name === "scoreboard")
    validateSportsData(
      BasketballGames,
      listSeasonGames(answer.scoreboard.games, season).map(normalizeGame),
    );
  if (name === "schedule")
    validateSportsData(BasketballGames, listScheduleGames(answer, season).map(normalizeGame));
  if (name === "bracket")
    validateSportsData(
      BasketballSeries,
      answer.bracket.playoffBracketSeries.map(readBracketSeries),
    );
  if (name === "standings") validateSportsData(BasketballStandings, readStandingsRows(answer));
  return answer;
}
