// What the snapshot asks MLB for, and each field it reads from the answers, which MLB filters with
// `fields=`, so a field it renames or drops comes back as nothing and is named as missing.

import { addDays, readEasternDay } from "#shared/days.js";
import {
  LISTED_GAME_TYPES,
  hasStarted,
  isFinal,
  isHalfInning,
  isLive,
  isNumber,
  listScheduleGames,
} from "./feed-games.js";
import { hasEveryDivision } from "./feed-standings.js";

export const MLB_API = "https://statsapi.mlb.com";

const GAME_FIELDS = [
  "dates",
  "date",
  "games",
  "gamePk",
  "gameType",
  "gameDate",
  "officialDate",
  "status",
  "abstractGameState",
  "detailedState",
  "codedGameState",
  "reason",
  "startTimeTBD",
  "teams",
  "away",
  "home",
  "team",
  "id",
  "name",
  "score",
  "leagueRecord",
  "wins",
  "losses",
  "seriesGameNumber",
  "seriesDescription",
  "ifNecessary",
  "linescore",
  "currentInning",
  "inningState",
  "outs",
  "doubleHeader",
  "gameNumber",
  "gameInfo",
  "firstPitch",
  "gameDurationMinutes",
  "probablePitcher",
  "defense",
  "offense",
  "pitcher",
  "broadcasts",
  "type",
  "language",
  "isNational",
  "homeAway",
].join(",");
// A game being played is read from MLB's live feed, which runs ahead of the schedule's copy of it
// by half a minute or more, so every part shows the same inning, outs, and score.
const LIVE_GAME_FIELDS = [
  "gameData",
  "status",
  "abstractGameState",
  "codedGameState",
  "detailedState",
  "reason",
  "liveData",
  "linescore",
  "currentInning",
  "inningState",
  "outs",
  "teams",
  "away",
  "home",
  "runs",
  "defense",
  "offense",
  "pitcher",
  "team",
  "id",
].join(",");
/** @param {number | string} id */
export const nameLiveGameRequest = (id) =>
  `/api/v1.1/game/${id}/feed/live?fields=${LIVE_GAME_FIELDS}`;
// The season's whole schedule, which only the Games view lists, needs only who plays when and where,
// each club's record and starter with the game, and how it ended, in which inning.
const SEASON_GAME_FIELDS = [
  "dates",
  "date",
  "games",
  "gamePk",
  "gameType",
  "gameDate",
  "officialDate",
  "status",
  "abstractGameState",
  "detailedState",
  "codedGameState",
  "startTimeTBD",
  "teams",
  "away",
  "home",
  "team",
  "id",
  "score",
  "doubleHeader",
  "gameNumber",
  "leagueRecord",
  "wins",
  "losses",
  "probablePitcher",
  "useName",
  "useLastName",
  "pitchHand",
  "code",
  "linescore",
  "currentInning",
  "venue",
  "name",
  "location",
  "city",
  "stateAbbrev",
  "timeZone",
].join(",");
const SEASON_FIELDS = ["seasons", "springStartDate", "regularSeasonEndDate"].join(",");
const PITCHER_FIELDS = ["people", "id", "useName", "useLastName", "pitchHand", "code"].join(",");
const STANDINGS_FIELDS = [
  "records",
  "division",
  "id",
  "teamRecords",
  "team",
  "wins",
  "losses",
  "winningPercentage",
  "divisionGamesBack",
  "wildCardGamesBack",
  "eliminationNumber",
  "wildCardEliminationNumber",
  "divisionChamp",
  "divisionLeader",
  "divisionRank",
  "wildCardRank",
  "leagueRank",
  "clinchIndicator",
  "runsScored",
  "runsAllowed",
  "splitRecords",
  "type",
].join(",");

const isText = (value) => typeof value === "string" && value !== "";
const isBoolean = (value) => typeof value === "boolean";
const isNumericText = (value) => isText(value) && Number.isFinite(Number(value));
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value));
const isPresent = (value) => value !== undefined && value !== null && value !== "";
const hasPlayed = (record) => record.wins + record.losses > 0;

// With `onSome`, a field is only missing when no item it applies to has it.
/**
 * @param {string} path
 * @param {(value: any) => boolean} isValid
 * @param {(item: any) => boolean} [appliesTo]
 * @param {boolean} [onSome]
 */
const requireField = (path, isValid, appliesTo = () => true, onSome = false) => ({
  path,
  isValid,
  appliesTo,
  onSome,
});
const FIELD_RULES = {
  division: [requireField("division.id", isNumber), requireField("teamRecords", Array.isArray)],
  club: [
    requireField("team.id", isNumber),
    requireField("wins", isNumber),
    requireField("losses", isNumber),
    requireField("winningPercentage", isNumericText, hasPlayed),
    requireField("divisionRank", isNumericText, hasPlayed),
    requireField("leagueRank", isNumericText, hasPlayed),
    requireField("divisionGamesBack", isPresent, hasPlayed),
    requireField("wildCardGamesBack", isPresent, hasPlayed),
    requireField("eliminationNumber", isPresent, hasPlayed),
    requireField("wildCardEliminationNumber", isPresent, hasPlayed),
    requireField("divisionChamp", isBoolean, hasPlayed),
    requireField("divisionLeader", isBoolean, hasPlayed),
    requireField(
      "wildCardRank",
      isNumericText,
      (record) => hasPlayed(record) && record.divisionLeader === false,
    ),
    requireField("clinchIndicator", isText, (record) => record.divisionChamp === true),
  ],
  date: [requireField("date", isDay), requireField("games", Array.isArray)],
  season: [requireField("springStartDate", isDay), requireField("regularSeasonEndDate", isDay)],
  game: [
    requireField("gamePk", isNumber),
    requireField("gameType", isText),
    requireField("gameDate", isTime),
    requireField("officialDate", isDay),
    requireField("status.abstractGameState", isText),
    requireField("status.detailedState", isText),
    requireField("status.codedGameState", isText),
    requireField("status.startTimeTBD", isBoolean),
    requireField("teams.away.team.id", isNumber),
    requireField("teams.away.team.name", isText),
    requireField("teams.home.team.id", isNumber),
    requireField("teams.home.team.name", isText),
    requireField("doubleHeader", isText),
    requireField("gameNumber", isNumber),
    requireField("teams.away.score", isNumber, isFinal),
    requireField("teams.home.score", isNumber, isFinal),
    requireField("gameInfo.firstPitch", isTime, isFinal, true),
    requireField("gameInfo.gameDurationMinutes", isNumber, isFinal, true),
  ],
  // The season's whole schedule leaves out each club's name and how long each game took.
  seasonGame: [
    requireField("gamePk", isNumber),
    requireField("gameType", isText),
    requireField("gameDate", isTime),
    requireField("officialDate", isDay),
    requireField("status.abstractGameState", isText),
    requireField("status.detailedState", isText),
    requireField("status.codedGameState", isText),
    requireField("status.startTimeTBD", isBoolean),
    requireField("teams.away.team.id", isNumber),
    requireField("teams.home.team.id", isNumber),
    requireField("doubleHeader", isText),
    requireField("gameNumber", isNumber),
    requireField("teams.away.score", isNumber, isFinal),
    requireField("teams.home.score", isNumber, isFinal),
  ],
  scheduleGame: [
    requireField("linescore.currentInning", isNumber, hasStarted, true),
    requireField("linescore.inningState", isHalfInning, isLive, true),
    requireField("linescore.outs", isNumber, isLive, true),
  ],
  pitcher: [
    requireField("id", isNumber),
    requireField("useName", isText, () => true, true),
    requireField("useLastName", isText),
    requireField("pitchHand.code", isText),
  ],
  postseasonGame: [
    requireField("seriesGameNumber", isNumber),
    // The series' league comes from this name.
    requireField(
      "seriesDescription",
      (value) => /^(AL|NL)\b/.test(value),
      (game) => game.gameType !== "W",
    ),
  ],
};
export const CHECKED_FIELDS = [
  ...new Set(
    Object.values(FIELD_RULES).flatMap((rules) => rules.flatMap((rule) => rule.path.split("."))),
  ),
  "records",
  "dates",
  "seasons",
  "people",
  // MLB leaves the cause off some delays, so a missing one is never flagged.
  "reason",
  // Who's pitching only tells a starter still in from one pulled, so the games show without it.
  "defense",
  "offense",
  "pitcher",
  // A club names its starter a day or two ahead, so a game without one is never flagged.
  "probablePitcher",
  // A row without each club's record with the game still shows the game.
  "leagueRecord",
  // A game MLB doesn't mark as one it may not need shows as any other.
  "ifNecessary",
  // A game MLB lists no channels for yet says to check back, and a broadcast that doesn't say it's
  // on English TV is left out.
  "broadcasts",
  "type",
  "language",
  "isNational",
  "homeAway",
  // A club's runs and its records home and away, which only its sheet's curves need, are left out
  // of them while MLB doesn't send them.
  "runsScored",
  "runsAllowed",
  "splitRecords",
  // A game MLB names no ballpark for is found by its home club's city.
  "venue",
  "location",
  "city",
  "stateAbbrev",
  "timeZone",
];

const readPath = (object, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);

function findInvalidFields(items, rules) {
  return rules
    .filter(({ path, isValid, appliesTo, onSome }) => {
      const applicable = items.filter(appliesTo);
      const invalid = applicable.filter((item) => !isValid(readPath(item, path)));
      return invalid.length > 0 && (!onSome || invalid.length === applicable.length);
    })
    .map((rule) => rule.path);
}

// No divisions at all is how MLB answers before a season's first standings.
function findMissingStandingsFields(standings) {
  if (!Array.isArray(standings?.records)) return ["records"];
  if (standings.records.length && !hasEveryDivision(standings)) return ["records"];
  const clubs = standings.records.flatMap((division) => division.teamRecords || []);
  return [
    ...findInvalidFields(standings.records, FIELD_RULES.division),
    ...findInvalidFields(clubs, FIELD_RULES.club),
  ];
}

function findMissingGameFields(schedule, rules) {
  if (!Array.isArray(schedule?.dates)) return ["dates"];
  const games = listScheduleGames(schedule);
  return [
    ...findInvalidFields(schedule.dates, FIELD_RULES.date),
    ...findInvalidFields(games, rules),
  ];
}

function findMissingSeasonFields(season) {
  if (!Array.isArray(season?.seasons) || !season.seasons.length) return ["seasons"];
  return findInvalidFields(season.seasons, FIELD_RULES.season);
}

function findMissingPitcherFields(pitchers) {
  if (!Array.isArray(pitchers?.people)) return ["people"];
  return findInvalidFields(pitchers.people, FIELD_RULES.pitcher);
}

export function findMissingFields(responses) {
  const missing = [
    ...findMissingSeasonFields(responses.season),
    ...findMissingStandingsFields(responses.standings),
    ...findMissingGameFields(responses.postseason, [
      ...FIELD_RULES.game,
      ...FIELD_RULES.postseasonGame,
    ]),
    ...(responses.schedule
      ? findMissingGameFields(responses.schedule, [
          ...FIELD_RULES.game,
          ...FIELD_RULES.scheduleGame,
        ])
      : []),
    ...(responses.seasonGames
      ? findMissingGameFields(responses.seasonGames, FIELD_RULES.seasonGame)
      : []),
    ...(responses.pitchers ? findMissingPitcherFields(responses.pitchers) : []),
  ];
  return [...new Set(missing)];
}

export function listMlbRequests(season, now, regularSeasonEnd = null) {
  const today = readEasternDay(now);
  // Four days back spans a postseason off day; after the regular season, its last days hold
  // every club's final game.
  const firstDay = [addDays(today.date, -4), regularSeasonEnd && addDays(regularSeasonEnd, -3)]
    .filter(Boolean)
    .sort()[0];
  const requests = {
    season: `/api/v1/seasons/${season}?sportId=1&fields=${SEASON_FIELDS}`,
    standings:
      `/api/v1/standings?leagueId=103,104&season=${season}` +
      `&standingsTypes=regularSeason&fields=${STANDINGS_FIELDS}`,
    postseason:
      `/api/v1/schedule/postseason?season=${season}` +
      `&hydrate=gameInfo,linescore,probablePitcher&fields=${GAME_FIELDS}`,
    schedule: null,
    seasonGames:
      `/api/v1/schedule?sportId=1&season=${season}` +
      `&gameType=${[...LISTED_GAME_TYPES].join(",")}` +
      `&hydrate=linescore,probablePitcher,person,venue(location,timezone)` +
      `&fields=${SEASON_GAME_FIELDS}`,
  };
  if (season === today.year) {
    // Four days ahead reaches every club's next regular season game.
    requests.schedule =
      `/api/v1/schedule?sportId=1&startDate=${firstDay}` +
      `&endDate=${addDays(today.date, 4)}&hydrate=linescore,gameInfo,probablePitcher,broadcasts` +
      `&fields=${GAME_FIELDS}`;
  }
  return requests;
}

// Sorted, so the same starters make the same request and MLB's cache can answer it.
export const listPitcherRequest = (ids) =>
  `/api/v1/people?personIds=${[...ids].sort((first, second) => first - second).join(",")}` +
  `&fields=${PITCHER_FIELDS}`;
