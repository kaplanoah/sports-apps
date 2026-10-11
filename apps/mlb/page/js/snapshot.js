// Runs in both the browser page and the Worker, so it uses no DOM and no globals.

import { addDays, readEasternDay } from "#shared/days.js";
import * as PollSchedule from "#shared/poll-schedule.js";
import { NIGHT_END_HOUR } from "./dates.js";

// The shape of a snapshot, and of the season record saved from it, which a page reads only when it
// knows it.
export const SNAPSHOT_VERSION = 1;

export const MLB_API = "https://statsapi.mlb.com";

// Postseason placeholders ("AL #3 Seed") have made-up ids, so a miss means no real club yet.
const MLB_TEAM = {
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "ATH",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
};
export const listClubs = () => Object.values(MLB_TEAM);
// Postseason placeholders have made-up ids, so this is null for them.
export const readClubId = (mlbTeamId) => MLB_TEAM[mlbTeamId] || null;
// The MLB id of one of the page's clubs, or null for a name that isn't one.
export const readMlbTeamId = (club) =>
  Number(Object.keys(MLB_TEAM).find((mlbTeamId) => MLB_TEAM[mlbTeamId] === club)) || null;

const MLB_DIVISION = {
  200: "AL West",
  201: "AL East",
  202: "AL Central",
  203: "NL West",
  204: "NL East",
  205: "NL Central",
};

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
const PITCHER_FIELDS = [
  "people",
  "id",
  "useName",
  "useLastName",
  "pitchHand",
  "code",
  "stats",
  "splits",
  "stat",
  "era",
].join(",");
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

// The requests filter with `fields=`, so a field MLB renames or drops comes back as nothing.
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isText = (value) => typeof value === "string" && value !== "";
const isBoolean = (value) => typeof value === "boolean";
const isNumericText = (value) => isText(value) && Number.isFinite(Number(value));
const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTime = (value) => isText(value) && !Number.isNaN(Date.parse(value));
const isPresent = (value) => value !== undefined && value !== null && value !== "";
const hasPlayed = (record) => record.wins + record.losses > 0;
const isFinal = (game) => readGameState(game.status || {}) === "final";
const hasStarted = (game) => ["live", "final"].includes(readGameState(game.status || {}));
const isLive = (game) => readGameState(game.status || {}) === "live";
const HALF_INNINGS = { Top: "top", Middle: "middle", Bottom: "bottom", End: "end" };
const isHalfInning = (value) => Object.hasOwn(HALF_INNINGS, value);

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
  // A pitcher has no line until he pitches in the season.
  pitchingLine: [requireField("era", isText, () => true, true)],
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
  "stats",
  "splits",
  "stat",
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
  const games = schedule.dates.flatMap((date) => date.games || []);
  return [
    ...findInvalidFields(schedule.dates, FIELD_RULES.date),
    ...findInvalidFields(games, rules),
  ];
}

function findMissingSeasonFields(season) {
  if (!Array.isArray(season?.seasons) || !season.seasons.length) return ["seasons"];
  return findInvalidFields(season.seasons, FIELD_RULES.season);
}

const readPitchingLine = (person) => person.stats?.[0]?.splits?.[0]?.stat;

function findMissingPitcherFields(pitchers) {
  if (!Array.isArray(pitchers?.people)) return ["people"];
  const lines = pitchers.people.map(readPitchingLine).filter(Boolean);
  return [
    ...findInvalidFields(pitchers.people, FIELD_RULES.pitcher),
    ...findInvalidFields(lines, FIELD_RULES.pitchingLine),
  ];
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

export const LEAGUES = ["AL", "NL"];
export const BEST_OF = { WC: 3, DS: 5, CS: 7, WS: 7 };
export const countWinsNeeded = (round) => Math.ceil(BEST_OF[round] / 2);

// The bracket is fixed, not reseeded: 1 draws the 4/5 winner, 2 the 3/6.
const LEAGUE_SERIES = [
  { key: "WC1", round: "WC", sides: [{ seed: 3 }, { seed: 6 }] },
  { key: "WC2", round: "WC", sides: [{ seed: 4 }, { seed: 5 }] },
  { key: "DS1", round: "DS", sides: [{ seed: 1 }, { winnerOf: "WC2" }] },
  { key: "DS2", round: "DS", sides: [{ seed: 2 }, { winnerOf: "WC1" }] },
  { key: "CS", round: "CS", sides: [{ winnerOf: "DS1" }, { winnerOf: "DS2" }] },
];

/**
 * Walks the bracket in playing order. `decideWinner` names each series' winner, or null.
 * @param {Record<string, { league: string, seed: number }>} teams
 * @param {(seriesId: string, round: string, teamA: string | null, teamB: string | null) => string | null} decideWinner
 */
export function resolveBracket(teams, decideWinner) {
  const holderOfSeed = {};
  for (const [id, team] of Object.entries(teams)) holderOfSeed[`${team.league}${team.seed}`] = id;
  const bracket = {};
  const findWinner = (seriesId) => (bracket[seriesId] ? bracket[seriesId].winner : null);
  const settleSeries = (id, round, teamA, teamB) => {
    bracket[id] = { id, round, teamA, teamB, winner: decideWinner(id, round, teamA, teamB) };
  };
  for (const league of LEAGUES) {
    for (const { key, round, sides } of LEAGUE_SERIES) {
      const [teamA, teamB] = sides.map((side) =>
        side.seed
          ? holderOfSeed[`${league}${side.seed}`] || null
          : findWinner(`${league}_${side.winnerOf}`),
      );
      settleSeries(`${league}_${key}`, round, teamA, teamB);
    }
  }
  settleSeries("WS", "WS", findWinner("AL_CS"), findWinner("NL_CS"));
  return bracket;
}

// `side` is 0 for teamA and 1 for teamB.
export function findFeederSeries(seriesId, side) {
  if (seriesId === "WS") return side === 0 ? "AL_CS" : "NL_CS";
  const [league, key] = seriesId.split("_");
  const series = LEAGUE_SERIES.find((candidate) => candidate.key === key);
  const winnerOf = series && series.sides[side].winnerOf;
  return winnerOf ? `${league}_${winnerOf}` : null;
}

const GAME_TYPES = new Set(["R", "F", "D", "L", "W"]);
// The Games view lists the All-Star Game among the clubs' games.
const LISTED_GAME_TYPES = new Set([...GAME_TYPES, "A"]);

// MLB caches its responses for 20 seconds, so polling much faster only refetches the same answer.
export const POLL_LIVE_MS = 30 * 1000;
// From the 9th inning on, any pitch can end a game, so it's followed a little faster than MLB's
// cache turns over.
export const POLL_CLOSING_MS = 15 * 1000;
const CLOSING_INNING = 9;
const REGULATION_INNINGS = 9;

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
export const listPitcherRequest = (season, ids) =>
  `/api/v1/people?personIds=${[...ids].sort((first, second) => first - second).join(",")}` +
  `&hydrate=stats(group=[pitching],type=[season],season=${season})&fields=${PITCHER_FIELDS}`;

// Only the starters of the games the page lists are looked up, and those come from the slate.
export function listStarterIds(slate) {
  if (!slate) return [];
  const days = [slate.today, slate.nextDay, slate.lastNight].filter(Boolean);
  const games = [...days.flatMap((day) => day.games), slate.lastFinal, slate.previous, slate.next]
    .flat()
    .filter(Boolean);
  return [
    ...new Set(games.flatMap((game) => (game.starters || []).filter(Boolean).map(({ id }) => id))),
  ];
}

// The starters only add to the games, so the games still show when MLB can't name them.
async function fetchPitchers(getJson, season, ids) {
  if (!ids.length) return null;
  try {
    return await getJson(listPitcherRequest(season, ids), "pitchers");
  } catch {
    return null;
  }
}

const readUnlessFailed = (promise) => promise.catch(() => null);

// The season's dates come first because they decide how far back the schedule reaches, and the
// games come before the standings, since a game that just ended is what makes them worth reading
// again. The starters come last, since which games the slate lists depends on the standings,
// which set the postseason's field. `getJson` is handed each request's name as well as its path.
// The bracket and the games can't do without the postseason and the schedule, but they can
// without the season's dates, the standings, or the season's whole schedule, which the snapshot
// then lists as missing.
export async function fetchResponses(getJson, season, now = Date.now()) {
  const seasonDates = await readUnlessFailed(
    getJson(listMlbRequests(season, now).season, "season"),
  );
  const requests = listMlbRequests(season, now, readRegularSeasonEnd(seasonDates));
  const [postseason, schedule] = await Promise.all([
    getJson(requests.postseason, "postseason"),
    requests.schedule ? getJson(requests.schedule, "schedule") : null,
  ]);
  const [standings, seasonGames] = await Promise.all([
    readUnlessFailed(getJson(requests.standings, "standings")),
    readUnlessFailed(getJson(requests.seasonGames, "seasonGames")),
  ]);
  const responses = { season: seasonDates, standings, postseason, schedule, seasonGames };
  const { slate } = buildSnapshot(responses, { season, now });
  const pitchers = await fetchPitchers(getJson, season, listStarterIds(slate));
  return { ...responses, pitchers };
}

/**
 * How many of the schedule's games have ended.
 * @param {any} schedule MLB's schedule
 */
export const countFinals = (schedule) =>
  (schedule?.dates ?? [])
    .flatMap((day) => day.games ?? [])
    .filter((game) => readGameState(game.status ?? {}) === "final").length;

export async function fetchSnapshot(getJson, season, now = Date.now()) {
  return buildSnapshot(await fetchResponses(getJson, season, now), { season, now });
}

// Postponed and cancelled games read "Final" in abstractGameState, and warmup reads "Live", so
// check the coded state first.
function readGameState(status) {
  const isCalledOff =
    ["C", "D", "T", "U"].includes(status.codedGameState) ||
    /postpon|cancel|suspend/i.test(status.detailedState || "");
  if (isCalledOff) return "off";
  if (["S", "P"].includes(status.codedGameState)) return "pre";
  if (status.abstractGameState === "Live") return "live";
  if (status.abstractGameState === "Final") return "final";
  return "pre";
}

// MLB names a delay "Delayed Start" before the first pitch and "Delayed" after, with its cause apart.
function describeDelay(status) {
  if (!/^Delayed\b/.test(status.detailedState || "")) return null;
  return status.reason ? `Delayed: ${status.reason}` : "Delayed";
}

// Without gameInfo, three hours past the scheduled start is close enough to order finals.
function estimateEnd(game) {
  const info = game.gameInfo || {};
  const firstPitch = Date.parse(info.firstPitch || game.gameDate);
  if (Number.isNaN(firstPitch)) return null;
  const minutes = info.gameDurationMinutes || (info.firstPitch ? 0 : 180);
  return new Date(firstPitch + minutes * 60000).toISOString().replace(".000Z", "Z");
}

// Between halves MLB says "Middle" or "End", with the third out still counted.
function readHalfInning(linescore) {
  const state = linescore && linescore.inningState;
  return isHalfInning(state) ? HALF_INNINGS[state] : null;
}

const isBatting = (game) => game.half === "top" || game.half === "bottom";

// A live game's linescore names the pitcher in for each side, fielding and batting.
function readPitcherIn(linescore, teamId) {
  const side = [linescore?.defense, linescore?.offense].find((entry) => entry?.team?.id === teamId);
  return side?.pitcher?.id ?? null;
}

// A channel's name can carry its sponsor or a note on where it airs, and one shown on its
// streaming service too names both, split by a slash.
const SPONSOR_OR_NOTE = /,?\s+(presented by\b.*|\(.*\))$/i;

// MLB names a channel's app, or a channel by its owner's name, where the line shows the channel.
const CHANNEL_NAMES = { "ESPN App": "ESPN", "Amazon Prime Video": "Prime Video" };

/** @param {{ name?: string }} broadcast */
const listChannelNames = (broadcast) =>
  (broadcast.name ?? "")
    .replace(SPONSOR_OR_NOTE, "")
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => CHANNEL_NAMES[name] ?? name);

const isEnglishTv = (broadcast) => broadcast.type === "TV" && broadcast.language === "en";

// National channels come first, then each club's own, the visitors' before the home club's.
const rankBroadcast = (broadcast) =>
  broadcast.isNational ? 0 : broadcast.homeAway === "away" ? 1 : 2;

/** @param {any[]} [broadcasts] */
function listNetworks(broadcasts = []) {
  const shown = broadcasts
    .filter(isEnglishTv)
    .sort((first, second) => rankBroadcast(first) - rankBroadcast(second));
  return [...new Set(shown.flatMap(listChannelNames))];
}

function normalizeGame(game) {
  const readSide = (key) => {
    const side = (game.teams && game.teams[key]) || {};
    const team = side.team || {};
    return {
      id: readClubId(team.id),
      name: team.name || "",
      score: side.score,
      starter: side.probablePitcher?.id ?? null,
      pitcherIn: readPitcherIn(game.linescore, team.id),
      record: side.leagueRecord,
    };
  };
  const status = game.status || {};
  const state = readGameState(status);
  const league = /^(AL|NL)\b/.exec(game.seriesDescription || "");
  return {
    id: String(game.gamePk),
    type: game.gameType,
    date: game.officialDate,
    start: game.gameDate,
    tbd: !!status.startTimeTBD,
    state,
    away: readSide("away"),
    home: readSide("home"),
    inning: game.linescore ? game.linescore.currentInning : undefined,
    half: readHalfInning(game.linescore),
    outs: game.linescore ? game.linescore.outs : undefined,
    detail: status.detailedState,
    delay: describeDelay(status),
    doubleheader: game.doubleHeader && game.doubleHeader !== "N" ? game.gameNumber : null,
    number: game.seriesGameNumber,
    ifNecessary: game.ifNecessary === "Y",
    league: league ? league[1] : null,
    end: state === "final" ? estimateEnd(game) : null,
    networks: listNetworks(game.broadcasts),
  };
}

// The All-Star Game's teams are its leagues'.
const ALL_STAR_LEAGUES = { 159: "AL", 160: "NL" };

/**
 * The All-Star Game, when the schedule's days hold it, with its leagues for its clubs.
 * @param {any} schedule
 */
function findAllStarGame(schedule) {
  const game = ((schedule && schedule.dates) || [])
    .flatMap((day) => day.games || [])
    .find((each) => each.gameType === "A");
  return game ? normalizeAllStarGame(game) : null;
}

/** @param {any} game MLB's listing of the All-Star Game */
function normalizeAllStarGame(game) {
  const normalized = normalizeGame(game);
  /** @param {"away" | "home"} key */
  const readLeague = (key) => ALL_STAR_LEAGUES[game.teams?.[key]?.team?.id] ?? null;
  return {
    ...normalized,
    away: { ...normalized.away, id: readLeague("away") },
    home: { ...normalized.home, id: readLeague("home") },
  };
}

// It sits beside the slate's lists rather than in them, since the header, the Updates box, and the
// store's box scores and pitchers follow the clubs' games, and only the Games view lists it.
function summarizeAllStarGame(game) {
  if (!game || game.state === "off") return null;
  const { starters, postseason, networks, ...summary } = summarizeGame(game, new Map());
  return { date: game.date, ...summary, allStar: true };
}

// A suspended game is listed again on the day it resumes; the later listing counts.
function listScheduledGames(...responses) {
  const gamesByPk = new Map();
  for (const response of responses) {
    for (const day of (response && response.dates) || []) {
      for (const game of day.games || []) {
        if (GAME_TYPES.has(game.gameType)) gamesByPk.set(game.gamePk, normalizeGame(game));
      }
    }
  }
  return [...gamesByPk.values()];
}

// The Games view lists every game of the season, which the store keeps a month to a document, apart
// from the season's record that pages follow through every live game, and saves again only as a
// game ends or the schedule changes.
/** @param {number} year */
export const nameScheduleCollection = (year) => `schedules-${year}`;

// What the schedule's games hold, raised whenever they hold more, so a past season saved before is
// read once more for it.
export const SCHEDULE_EDITION = 2;

/**
 * @param {number} year
 * @param {string} month "YYYY-MM"
 */
export const nameScheduleKey = (year, month) => `${nameScheduleCollection(year)}/${month}`;

// A postponed or suspended game is listed on the day it was to be played and again on the day it's
// played, and the later of two listings of the same day counts. MLB gives both listings the day
// it's played as their official date, so each takes the day it's listed on.
// Only the season's whole schedule names each game's ballpark, which a later listing keeps.
function listSeasonListings(...responses) {
  const listings = new Map();
  for (const day of responses.flatMap((response) => response?.dates ?? [])) {
    for (const game of day.games ?? []) {
      const key = `${game.gamePk} ${day.date}`;
      const venue = game.venue ?? listings.get(key)?.venue;
      if (LISTED_GAME_TYPES.has(game.gameType))
        listings.set(key, { ...game, officialDate: day.date, ...(venue && { venue }) });
    }
  }
  return [...listings.values()];
}

/**
 * Where a game is played, as the Games view and its search read it.
 * @param {any} venue MLB's
 */
const describeBallpark = (venue) =>
  venue?.name && venue.location?.city
    ? {
        name: venue.name,
        city: venue.location.city,
        state: venue.location.stateAbbrev ?? "",
        timeZone: venue.timeZone?.id ?? null,
      }
    : null;

// A club's own ballpark is the one it hosts most of its regular season games in, so a game it hosts
// anywhere else, like London or the Little League Classic, is at a neutral site.
function findHomeBallparks(listings) {
  const counts = new Map();
  for (const listing of listings) {
    const club = listing.teams?.home?.team?.id;
    const park = listing.venue?.id;
    if (listing.gameType !== "R" || !club || !park) continue;
    const parks = counts.get(club) ?? new Map();
    parks.set(park, (parks.get(park) ?? 0) + 1);
    counts.set(club, parks);
  }
  return new Map(
    [...counts].map(([club, parks]) => [
      club,
      [...parks].sort((first, second) => second[1] - first[1])[0][0],
    ]),
  );
}

/**
 * @param {any} listing
 * @param {Map<number, number>} homeBallparks
 */
const isAtNeutralSite = (listing, homeBallparks) => {
  const home = homeBallparks.get(listing.teams?.home?.team?.id);
  return !!home && !!listing.venue?.id && listing.venue.id !== home;
};

/** @param {{ wins?: number, losses?: number } | undefined} record */
const formatRecord = (record) =>
  isNumber(record?.wins) && isNumber(record?.losses) ? `${record.wins}-${record.losses}` : null;

// A regular season game shows each club's record as it stood with the game, which MLB gives
// after a final and before a game still to play. A postseason game's record is its series',
// which the page doesn't show, and a game called off gives the record of the day it's made up.
function listRecords(game) {
  if (game.type !== "R" || game.state === "off") return null;
  const records = [formatRecord(game.away.record), formatRecord(game.home.record)];
  return records.some(Boolean) ? records : null;
}

// Only what the row shows of each starter, his name and his arm, and his first name, which a search
// for him shows.
function listListedStarters(game, people) {
  const starters = listStarters(game, people)?.map((starter) =>
    starter?.name
      ? {
          id: starter.id,
          name: starter.name,
          hand: starter.hand,
          ...(starter.firstName && { firstName: starter.firstName }),
        }
      : null,
  );
  return starters?.some(Boolean) ? starters : null;
}

// A postseason game names its series and its game in it, and, while MLB says the series may not
// need it, that it's played only if necessary.
/**
 * @param {ReturnType<typeof normalizeGame>} game
 * @param {Map<string, string>} seriesIds each postseason game's series, by the game's id
 */
function describeSeriesPlace(game, seriesIds) {
  const series = seriesIds.get(game.id);
  if (!series) return null;
  const place = { series, number: game.number };
  return game.state === "pre" && game.ifNecessary ? { ...place, ifNecessary: true } : place;
}

// A game under way is listed as it was before it started, since the slate carries it while it's
// played, and only a final keeps its score.
/**
 * @param {any} listing MLB's listing of a game
 * @param {Map<number, any>} people each starter MLB describes, by id
 * @param {Map<string, string>} seriesIds each postseason game's series, by the game's id
 * @param {Map<number, number>} homeBallparks each club's own ballpark, by the club's MLB id
 */
function describeListedGame(listing, people, seriesIds, homeBallparks) {
  const isAllStar = listing.gameType === "A";
  const game = isAllStar ? normalizeAllStarGame(listing) : normalizeGame(listing);
  const { starters, networks, inning, half, outs, end, delay, postseason, score, ...summary } =
    summarizeGame(game, new Map());
  const records = listRecords(game);
  const listedStarters = isAllStar ? null : listListedStarters(game, people);
  const seriesPlace = postseason && !isAllStar ? describeSeriesPlace(game, seriesIds) : null;
  const ballpark = describeBallpark(listing.venue);
  return {
    date: game.date,
    ...summary,
    state: game.state === "live" ? "pre" : game.state,
    ...(game.state === "final" && { score }),
    ...(postseason && !isAllStar && { postseason }),
    ...seriesPlace,
    ...(isAllStar && { allStar: true }),
    ...(records && { records }),
    ...(listedStarters && { starters: listedStarters }),
    ...(ballpark && { ballpark }),
    ...(!isAllStar && isAtNeutralSite(listing, homeBallparks) && { neutral: true }),
  };
}

// The season's schedule names each starter it lists, and the starters' own read, the slate's.
function listScheduledPeople(responses, listings) {
  const people = new Map();
  for (const listing of listings) {
    for (const side of ["away", "home"]) {
      const person = listing.teams?.[side]?.probablePitcher;
      if (person?.useLastName) people.set(person.id, person);
    }
  }
  for (const [id, person] of listPitchers(responses)) people.set(id, person);
  return people;
}

// Once a series is decided, the games it no longer needs never happen.
function listCalledOffGameIds(gamesBySeries, log) {
  const decided = log.filter((entry) => entry.kind === "clinch").map((entry) => entry.series);
  return new Set(
    decided
      .flatMap((seriesId) => gamesBySeries[seriesId] ?? [])
      .filter((game) => game.state !== "final")
      .map((game) => game.id),
  );
}

/** @param {{ date: string }[]} games in schedule order */
function groupByMonth(games) {
  /** @type {Record<string, any[]>} */
  const months = {};
  for (const game of games) (months[game.date.slice(0, 7)] ??= []).push(game);
  return months;
}

/** @param {Record<string, { id: string }[]>} gamesBySeries */
const listSeriesIds = (gamesBySeries) =>
  new Map(
    Object.entries(gamesBySeries).flatMap(([seriesId, games]) =>
      games.map((game) => [game.id, seriesId]),
    ),
  );

// The season's whole schedule is read once a day, so the days around today, read with each update,
// and the postseason count over it.
function buildSchedule(responses, gamesBySeries, calledOff) {
  if (!responses.seasonGames) return null;
  const seasonListings = listSeasonListings(responses.seasonGames);
  const people = listScheduledPeople(responses, seasonListings);
  const seriesIds = listSeriesIds(gamesBySeries);
  const homeBallparks = findHomeBallparks(seasonListings);
  const games = listSeasonListings(responses.seasonGames, responses.postseason, responses.schedule)
    .map((listing) => describeListedGame(listing, people, seriesIds, homeBallparks))
    .filter((game) => !calledOff.has(game.id))
    .sort(compareScheduleOrder);
  return groupByMonth(games);
}

// The Worker reads the postseason feed again only now and then, so a game's listing in the
// schedule, read with each update, counts over it.
const listPostseasonGames = (responses) =>
  listScheduledGames(responses.postseason, responses.schedule).filter((game) => game.type !== "R");

const hasBothClubs = (game) => !!(game.away.id && game.home.id);
const hasClub = (game) => !!(game.away.id || game.home.id);
const isPlayedBy = (game, club) => game.away.id === club || game.home.id === club;
const compareStarts = (first, second) => Date.parse(first.start) - Date.parse(second.start);
const compareEnds = (first, second) => Date.parse(first.end) - Date.parse(second.end);
// MLB can list a doubleheader's second game with the earlier start time.
const compareScheduleOrder = (first, second) =>
  first.date.localeCompare(second.date) ||
  (first.doubleheader || 0) - (second.doubleheader || 0) ||
  compareStarts(first, second);

// A pitcher MLB couldn't describe keeps his id, so the page can still ask about him.
function describeStarter(id, pitchers) {
  if (!id) return null;
  const person = pitchers.get(id);
  if (!person) return { id };
  const line = readPitchingLine(person);
  const starter = {
    id,
    name: person.useLastName,
    hand: person.pitchHand?.code,
    era: line?.era || null,
  };
  return person.useName ? { ...starter, firstName: person.useName } : starter;
}

const isStillPitching = (game, side) =>
  game.state === "live" && side.starter !== null && side.pitcherIn === side.starter;

function describeSideStarter(game, side, pitchers) {
  const starter = describeStarter(side.starter, pitchers);
  return starter && isStillPitching(game, side) ? { ...starter, pitching: true } : starter;
}

// MLB names a game's probable starters ahead of it, and once it starts, the ones who did.
function listStarters(game, pitchers) {
  if (game.state === "off") return null;
  const starters = [game.away, game.home].map((side) => describeSideStarter(game, side, pitchers));
  return starters.some(Boolean) ? starters : null;
}

// A final that went extra innings, or was called short, says in which inning it ended.
const isOffRegulation = (game) =>
  game.state === "final" && isNumber(game.inning) && game.inning !== REGULATION_INNINGS;

// A game that has ended, or won't be played, no longer says where it's on.
const isWatchable = (game) =>
  (game.state === "pre" || game.state === "live") && game.networks.length > 0;

function summarizeGame(game, pitchers) {
  const summary = {
    id: game.id,
    away: game.away.id,
    home: game.home.id,
    state: game.state,
    start: game.start,
  };
  if (game.tbd) summary.tbd = true;
  if (game.doubleheader) summary.doubleheader = game.doubleheader;
  if (game.type !== "R") summary.postseason = true;
  if (game.state === "live" || game.state === "final")
    summary.score = [game.away.score || 0, game.home.score || 0];
  if (game.state === "live") summary.inning = game.inning || 1;
  if (game.state === "live" && game.half) summary.half = game.half;
  if (game.state === "live" && isBatting(game) && isNumber(game.outs)) summary.outs = game.outs;
  if (game.state === "final") summary.end = game.end;
  if (isOffRegulation(game)) summary.innings = game.inning;
  if (game.state === "off") summary.detail = game.detail;
  if (game.delay) summary.delay = game.delay;
  if (isWatchable(game)) summary.networks = game.networks;
  const starters = listStarters(game, pitchers);
  if (starters) summary.starters = starters;
  return summary;
}

// Every game on the dates of each club's last game before `day` and first after it, so a date
// that shows at all shows all its games.
// Postseason games list a club before its opponent is known, so one known club is enough.
function listClubGames(games, day, summarize) {
  const counted = games.filter((game) => game.state !== "off" && hasClub(game));
  const played = counted
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareScheduleOrder);
  const ahead = counted
    .filter((game) => game.state === "pre" && game.date > day)
    .sort(compareScheduleOrder);
  const previousDates = new Set();
  const nextDates = new Set();
  for (const club of Object.values(MLB_TEAM)) {
    const last = played.filter((game) => isPlayedBy(game, club)).pop();
    const first = ahead.find((game) => isPlayedBy(game, club));
    if (last) previousDates.add(last.date);
    if (first) nextDates.add(first.date);
  }
  const listGamesOn = (clubGames, dates) =>
    clubGames
      .filter((game) => dates.has(game.date))
      .map((game) => ({ date: game.date, ...summarize(game) }));
  return { previous: listGamesOn(played, previousDates), next: listGamesOn(ahead, nextDates) };
}

// Before 6am Eastern, today is still last night while any of last night's games is unfinished.
// Once they're all final, last night stays alongside until 6am, since its games still explain
// what changes then.
function buildSlate(games, clubGames, now, pitchers) {
  const summarize = (game) => summarizeGame(game, pitchers);
  const clock = readEasternDay(now);
  const playable = games.filter((game) => game.state !== "off" && hasBothClubs(game));
  const listGamesOn = (date) => playable.filter((game) => game.date === date).sort(compareStarts);
  const lastNight = addDays(clock.date, -1);
  const isNight = clock.hour < NIGHT_END_HOUR;
  const isLastNightUnfinished = listGamesOn(lastNight).some((game) => game.state !== "final");
  const day = isNight && isLastNightUnfinished ? lastNight : clock.date;
  const hasLastNightEnded = isNight && day !== lastNight;

  const nextDay = [...new Set(playable.map((game) => game.date))]
    .filter((date) => date > day)
    .sort()[0];
  const lastFinal = playable
    .filter((game) => game.state === "final" && game.date < day)
    .sort(compareEnds)
    .pop();
  const postponed = games
    .filter((game) => game.state === "off" && game.date === day && hasBothClubs(game))
    .sort(compareStarts);
  return {
    today: {
      date: day,
      games: listGamesOn(day).map(summarize),
      postponed: postponed.map(summarize),
    },
    nextDay: nextDay ? { date: nextDay, games: listGamesOn(nextDay).map(summarize) } : null,
    lastNight: hasLastNightEnded
      ? { date: lastNight, games: listGamesOn(lastNight).map(summarize) }
      : null,
    lastFinal: lastFinal ? summarize(lastFinal) : null,
    ...listClubGames(clubGames, day, summarize),
  };
}

function listStandingsRows(response) {
  const rows = [];
  for (const divisionRecord of (response && response.records) || []) {
    const division = MLB_DIVISION[divisionRecord.division && divisionRecord.division.id];
    if (!division) continue;
    for (const record of divisionRecord.teamRecords || []) {
      const id = readClubId(record.team?.id);
      if (id) rows.push({ id, division, record });
    }
  }
  return rows;
}

// A postseason game can list a club before its opponent is known, so one known club is enough.
function describeUpcomingGame(game, opponent, home) {
  const upcoming = { at: game.start, date: game.date, home, tbd: game.tbd };
  if (opponent) upcoming.opp = opponent;
  if (game.type !== "R") upcoming.postseason = true;
  return upcoming;
}

function listUpcomingGames(games) {
  const upcoming = {};
  const gamesAhead = games
    .filter((game) => game.state === "pre" && hasClub(game))
    .sort(compareStarts);
  for (const game of gamesAhead) {
    for (const [club, opponent, home] of [
      [game.away.id, game.home.id, false],
      [game.home.id, game.away.id, true],
    ]) {
      if (club)
        (upcoming[club] = upcoming[club] || []).push(describeUpcomingGame(game, opponent, home));
    }
  }
  return upcoming;
}

const readRank = (value) => Number(value) || 99;

/**
 * A club's runs and its records at home and on the road, which its sheet ranks among every club's,
 * leaving out any MLB didn't answer with.
 * @param {any} record
 * @returns {Record<string, any>}
 */
function readClubNumbers(record) {
  const splits = record.records?.splitRecords ?? [];
  /** @param {string} type */
  const readSplit = (type) => {
    const split = splits.find((/** @type {any} */ each) => each.type === type);
    return split ? `${split.wins}-${split.losses}` : null;
  };
  const numbers = {
    rs: isNumber(record.runsScored) ? record.runsScored : null,
    ra: isNumber(record.runsAllowed) ? record.runsAllowed : null,
    home: readSplit("home"),
    road: readSplit("away"),
  };
  return Object.fromEntries(Object.entries(numbers).filter(([, value]) => value !== null));
}

function buildStandingsRow(id, record) {
  const row = {
    id,
    w: record.wins,
    l: record.losses,
    pct: record.winningPercentage,
    gb: record.divisionGamesBack,
    wcgb: record.wildCardGamesBack,
    elim: record.eliminationNumber,
    wce: record.wildCardEliminationNumber,
    magic: null,
    lead: !!record.divisionLeader,
    // MLB's own marker: x a playoff spot, w a wild card, y the division, z a bye.
    clinch: record.clinchIndicator || null,
    wcrank: record.divisionLeader ? null : record.wildCardRank || null,
    rank: readRank(record.divisionRank),
  };
  return Object.assign(row, readClubNumbers(record));
}

export const SEASON_GAMES = 162;

const hasPlayedOut = (row) => row.w + row.l >= SEASON_GAMES;

// MLB's divisionChamp and its "y" marker have both named a wild card club, so a division is
// won only once every other club in it is out of the division race. A tie at the end is
// broken on paper, and MLB then names only the winner the leader but never eliminates the
// other club.
const isOutOfDivisionRace = (other, leader) =>
  other.elim === "E" || (!other.lead && hasPlayedOut(other) && hasPlayedOut(leader));

export const hasWonDivision = (row, divisionRows) =>
  row.lead && divisionRows.every((other) => other.id === row.id || isOutOfDivisionRace(other, row));

// MLB gives a club tied for the lead "-" instead of an elimination number, so a tie is
// counted the way MLB counts the rest: a tie at the end doesn't clinch.
function countEliminationNumber(leader, chaser) {
  const given = Number(chaser.elim);
  if (Number.isFinite(given)) return given;
  if (chaser.elim !== "-") return null;
  return SEASON_GAMES + 1 - leader.w - chaser.l;
}

// The division magic number is the closest chaser's elimination number; MLB's
// `magicNumber` counts toward a playoff spot instead.
function setMagicNumber(rows) {
  const leader = rows.find((row) => row.lead);
  if (!leader || leader.clinched) return;
  const chasers = rows
    .filter((row) => row !== leader)
    .map((row) => countEliminationNumber(leader, row))
    .filter(Number.isFinite);
  if (chasers.length) leader.magic = String(Math.min(...chasers));
}

// `then` lets a copy saved before `next` starts still show what follows once it is under way.
function buildStandings(response, games) {
  const upcoming = listUpcomingGames(games);
  const divisions = {};
  for (const { id, division, record } of listStandingsRows(response)) {
    const row = buildStandingsRow(id, record);
    const [next, then] = upcoming[id] || [];
    if (next) row.next = next;
    if (then) row.then = then;
    (divisions[division] = divisions[division] || []).push(row);
  }
  for (const rows of Object.values(divisions)) {
    rows.sort((first, second) => first.rank - second.rank).forEach((row) => delete row.rank);
    for (const row of rows) row.clinched = hasWonDivision(row, rows);
    setMagicNumber(rows);
  }
  return { divisions };
}

// MLB sometimes answers with no divisions, or only some, and a field projected from that
// would drop clubs that are still in it.
function hasEveryDivision(response) {
  const divisions = new Set(listStandingsRows(response).map((row) => row.division));
  return Object.values(MLB_DIVISION).every((division) => divisions.has(division));
}

// A field is known only with the standings: a projected one comes from them, and a set one takes
// its clubs' records, and which series each game belongs to, from them.
export const hasKnownField = (snapshot) => !!snapshot.standings;

// League rank breaks ties on record because it already carries MLB's tiebreakers.
function projectField(response) {
  const rows = listStandingsRows(response);
  const compareLeagueRank = (first, second) =>
    readRank(first.record.leagueRank) - readRank(second.record.leagueRank);
  const compareDivisionRank = (first, second) =>
    readRank(first.record.divisionRank) - readRank(second.record.divisionRank) ||
    compareLeagueRank(first, second);
  const comparePercentage = (first, second) =>
    Number(second.record.winningPercentage) - Number(first.record.winningPercentage) ||
    compareLeagueRank(first, second);
  const compareWildCardRank = (first, second) =>
    Number(first.record.wildCardRank) - Number(second.record.wildCardRank);

  const teams = {};
  for (const league of LEAGUES) {
    const leagueRows = rows.filter((row) => row.division.startsWith(league));
    const divisions = [...new Set(leagueRows.map((row) => row.division))];
    const leaders = divisions
      .map((division) =>
        leagueRows.filter((row) => row.division === division).sort(compareDivisionRank),
      )
      .map((divisionRows) => divisionRows[0])
      .sort(comparePercentage);
    const leaderIds = new Set(leaders.map((row) => row.id));
    const wildCards = leagueRows
      .filter((row) => !leaderIds.has(row.id) && row.record.wildCardRank)
      .sort(compareWildCardRank);
    [...leaders.slice(0, 3), ...wildCards.slice(0, 3)].forEach((row, index) => {
      teams[row.id] = { league, seed: index + 1, w: row.record.wins, l: row.record.losses };
    });
  }
  return teams;
}

// MLB lists every possible postseason game in advance under placeholders ("AL 4/5 Winner",
// then "NYY/BOS" once the wild card clubs are set). A wild card host is the 3 seed if it won its
// division, else the 4. The 1 seed, the club with the league's best record, plays every game of DS1.
function findSeriesId(game, { champions, bestRecords }) {
  if (game.type === "W") return "WS";
  const { league } = game;
  if (!league) return null;
  const names = `${game.away.name} | ${game.home.name}`;
  const bestRecord = bestRecords[league];
  switch (game.type) {
    case "F":
      if (/#3 Seed|Wild Card #3/.test(names)) return `${league}_WC1`;
      if (/Wild Card #[12]/.test(names)) return `${league}_WC2`;
      return champions.has(game.home.id) ? `${league}_WC1` : `${league}_WC2`;
    case "D":
      if (/4\/5|#1 Seed/.test(names) || (bestRecord && isPlayedBy(game, bestRecord)))
        return `${league}_DS1`;
      if (/3\/6|#2 Seed/.test(names) || (bestRecord && hasClub(game))) return `${league}_DS2`;
      return null;
    case "L":
      return `${league}_CS`;
    default:
      return null;
  }
}

function groupPostseason(games, clinches) {
  const gamesBySeries = {};
  for (const game of games) {
    const seriesId = findSeriesId(game, clinches);
    if (seriesId) (gamesBySeries[seriesId] = gamesBySeries[seriesId] || []).push(game);
  }
  return gamesBySeries;
}

function isFieldComplete(teams) {
  const seats = Object.values(teams);
  const isSeatTaken = (league, seed) =>
    seats.some((team) => team.league === league && team.seed === seed);
  return (
    seats.length === 12 &&
    LEAGUES.every((league) => [1, 2, 3, 4, 5, 6].every((seed) => isSeatTaken(league, seed)))
  );
}

// Every wild card game is at the higher seed; the 1 and 2 seeds play no wild card game.
function readOfficialField(gamesBySeries, records) {
  const teams = {};
  const seatClub = (id, league, seed) => {
    if (!id) return;
    const record = records[id];
    teams[id] = record ? { league, seed, w: record.w, l: record.l } : { league, seed };
  };
  for (const league of LEAGUES) {
    const listSeriesGames = (key) => gamesBySeries[`${league}_${key}`] || [];
    for (const [key, higherSeed, lowerSeed] of [
      ["WC1", 3, 6],
      ["WC2", 4, 5],
    ]) {
      const game = listSeriesGames(key)[0];
      if (!game) continue;
      seatClub(game.home.id, league, higherSeed);
      seatClub(game.away.id, league, lowerSeed);
    }
    const wildCardGames = [...listSeriesGames("WC1"), ...listSeriesGames("WC2")];
    const playedWildCard = (id) => wildCardGames.some((game) => isPlayedBy(game, id));
    for (const [key, seed] of [
      ["DS1", 1],
      ["DS2", 2],
    ]) {
      const host = listSeriesGames(key)
        .flatMap((game) => [game.away.id, game.home.id])
        .find((id) => id && !playedWildCard(id));
      seatClub(host, league, seed);
    }
  }
  return isFieldComplete(teams) ? teams : null;
}

const isUnderWay = (game) => game.state === "live" || game.state === "final";

const isBetween = (game, teamA, teamB) =>
  [teamA, teamB].includes(game.away.id) && [teamA, teamB].includes(game.home.id);

// A game still live past midnight Eastern is dated the day before.
function findNextGame(games, today) {
  return games
    .filter((game) => game.state === "live" || (game.state === "pre" && game.date >= today))
    .sort((first, second) => first.number - second.number || compareStarts(first, second))[0];
}

function tallySeries(seriesId, games, round, teamA, teamB, today) {
  const record = { winsA: 0, winsB: 0 };
  const log = [];
  const need = countWinsNeeded(round);
  let winner = null;
  const seriesGames =
    teamA && teamB
      ? games.filter((game) => hasBothClubs(game) && isBetween(game, teamA, teamB))
      : [];
  if (seriesGames.some(isUnderWay)) record.started = true;
  const decided = seriesGames.filter((game) => game.state === "final").sort(compareEnds);
  for (const game of decided) {
    const won = game.away.score > game.home.score ? game.away.id : game.home.id;
    const lost = won === teamA ? teamB : teamA;
    // The game's own score, winner first, beside the series score.
    const runs = [
      Math.max(game.away.score, game.home.score),
      Math.min(game.away.score, game.home.score),
    ];
    if (won === teamA) record.winsA++;
    else record.winsB++;
    const score = won === teamA ? [record.winsA, record.winsB] : [record.winsB, record.winsA];
    if (score[0] >= need) {
      winner = won;
      log.push({
        at: game.end,
        kind: "clinch",
        series: seriesId,
        team: won,
        over: lost,
        score,
        runs,
      });
      break;
    }
    log.push({
      at: game.end,
      kind: "game",
      series: seriesId,
      won,
      lost,
      game: game.number,
      score,
      runs,
    });
  }
  if (!winner) {
    const next = findNextGame(games, today);
    if (next) record.next = { at: next.start, date: next.date, tbd: next.tbd, game: next.number };
  }
  return { record, log, winner };
}

// A decided series can still list the games it didn't need.
function listNeededPostseasonGames(gamesBySeries, log) {
  const decided = new Set(
    log.filter((entry) => entry.kind === "clinch").map((entry) => entry.series),
  );
  return Object.entries(gamesBySeries).flatMap(([seriesId, games]) =>
    decided.has(seriesId) ? games.filter((game) => game.state === "final") : games,
  );
}

function buildSeries(teams, gamesBySeries, today) {
  const series = {};
  const log = [];
  resolveBracket(teams, (seriesId, round, teamA, teamB) => {
    const games = gamesBySeries[seriesId] || [];
    const tally = tallySeries(seriesId, games, round, teamA, teamB, today);
    series[seriesId] = tally.record;
    log.push(...tally.log);
    return tally.winner;
  });
  log.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
  return { series, log };
}

const readSpringStart = (seasonDates) => seasonDates?.seasons?.[0]?.springStartDate || null;
const readRegularSeasonEnd = (seasonDates) =>
  seasonDates?.seasons?.[0]?.regularSeasonEndDate || null;

const readLeague = (division) => LEAGUES.find((league) => division.startsWith(league));

// MLB marks the club that clinched its league's best record "z".
function readRecords(standings) {
  const records = {};
  const champions = new Set();
  const bestRecords = {};
  for (const { id, division, record } of listStandingsRows(standings)) {
    records[id] = { w: record.wins, l: record.losses };
    if (record.divisionRank === "1" && record.divisionLeader) champions.add(id);
    if (record.clinchIndicator === "z") bestRecords[readLeague(division)] = id;
  }
  return { records, clinches: { champions, bestRecords } };
}

const listPitchers = (responses) =>
  new Map((responses.pitchers?.people || []).map((person) => [person.id, person]));

/** @returns {ReturnType<typeof buildSlate> & { allStar?: any }} */
function buildSlateWithAllStar(responses, games, clubGames, now) {
  const slate = buildSlate(games, clubGames, now, listPitchers(responses));
  const allStar = summarizeAllStarGame(findAllStarGame(responses.schedule));
  return allStar ? { ...slate, allStar } : slate;
}

export function buildSnapshot(responses, { season, now = Date.now() }) {
  const games = responses.schedule ? listScheduledGames(responses.schedule) : [];
  const postseasonGames = listPostseasonGames(responses);
  const { records, clinches } = readRecords(responses.standings);
  const gamesBySeries = groupPostseason(postseasonGames, clinches);
  const official = readOfficialField(gamesBySeries, records);
  const hasStandings = hasEveryDivision(responses.standings);
  const teams = official || (hasStandings ? projectField(responses.standings) : {});
  const { series, log } = buildSeries(teams, gamesBySeries, readEasternDay(now).date);
  const clubGames = [
    ...games.filter((game) => game.type === "R"),
    ...listNeededPostseasonGames(gamesBySeries, log),
  ];

  return {
    version: SNAPSHOT_VERSION,
    season,
    asOf: new Date(now).toISOString(),
    projected: !official,
    springStart: readSpringStart(responses.season),
    teams,
    series,
    log,
    standings: hasStandings ? buildStandings(responses.standings, clubGames) : null,
    slate: responses.schedule ? buildSlateWithAllStar(responses, games, clubGames, now) : null,
    schedule: buildSchedule(responses, gamesBySeries, listCalledOffGameIds(gamesBySeries, log)),
    missing: findMissingFields(responses),
  };
}

const isClosingInning = (game) => game.state === "live" && game.inning >= CLOSING_INNING;

// A season with no slate, like a past one, has nothing to follow, so it's null.
export function choosePollDelay(snapshot, now = Date.now()) {
  const slate = snapshot && snapshot.slate;
  if (!slate) return null;
  const games = [
    ...[slate.today, slate.nextDay].filter(Boolean).flatMap((day) => day.games),
    slate.allStar,
  ].filter(Boolean);
  return PollSchedule.choosePollDelay({
    isLive: games.some((game) => game.state === "live"),
    starts: games
      .filter((game) => game.state === "pre" && !game.tbd)
      .map((game) => Date.parse(game.start)),
    liveMs: games.some(isClosingInning) ? POLL_CLOSING_MS : POLL_LIVE_MS,
    now,
  });
}
