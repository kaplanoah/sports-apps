// MLB's words for a search of its season's games: its clubs by name, city, code, and the nicknames
// fans use, the places and ballparks its games are played in, its leagues and divisions, each
// league's own postseason rounds, its starting pitchers, the channels its games are on, extra
// innings, and how to read one of its games. Runs in the page and in Node, so it uses no DOM.

import { readMinutesIntoDay } from "#shared/days.js";
import { listSearchChannels, listVenuePlaces } from "#shared/game-search.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/game-search.js").SearchTerms} SearchTerms */
/** @typedef {import("#shared/game-search.js").SearchGame} SearchGame */
/** @typedef {import("#shared/game-search.js").SearchPlace} SearchPlace */
/** @typedef {import("#shared/game-search.js").SearchRound} SearchRound */
/** @typedef {{ name: string, city: string, state: string, timeZone?: string | null }} Ballpark */

// The city in each club's name, and the ballpark it plays in, as MLB's schedule names it, for a game
// whose listing doesn't name one yet.
/** @type {Record<string, { city: string, ballpark: Ballpark }>} */
const CLUBS = {
  ARI: { city: "Arizona", ballpark: { name: "Chase Field", city: "Phoenix", state: "AZ" } },
  ATL: { city: "Atlanta", ballpark: { name: "Truist Park", city: "Atlanta", state: "GA" } },
  BAL: {
    city: "Baltimore",
    ballpark: { name: "Oriole Park at Camden Yards", city: "Baltimore", state: "MD" },
  },
  BOS: { city: "Boston", ballpark: { name: "Fenway Park", city: "Boston", state: "MA" } },
  CHC: { city: "Chicago", ballpark: { name: "Wrigley Field", city: "Chicago", state: "IL" } },
  CWS: { city: "Chicago", ballpark: { name: "Rate Field", city: "Chicago", state: "IL" } },
  CIN: {
    city: "Cincinnati",
    ballpark: { name: "Great American Ball Park", city: "Cincinnati", state: "OH" },
  },
  CLE: {
    city: "Cleveland",
    ballpark: { name: "Progressive Field", city: "Cleveland", state: "OH" },
  },
  COL: { city: "Colorado", ballpark: { name: "Coors Field", city: "Denver", state: "CO" } },
  DET: { city: "Detroit", ballpark: { name: "Comerica Park", city: "Detroit", state: "MI" } },
  HOU: { city: "Houston", ballpark: { name: "Daikin Park", city: "Houston", state: "TX" } },
  KC: {
    city: "Kansas City",
    ballpark: { name: "Kauffman Stadium", city: "Kansas City", state: "MO" },
  },
  LAA: { city: "Los Angeles", ballpark: { name: "Angel Stadium", city: "Anaheim", state: "CA" } },
  LAD: {
    city: "Los Angeles",
    ballpark: { name: "UNIQLO Field at Dodger Stadium", city: "Los Angeles", state: "CA" },
  },
  MIA: { city: "Miami", ballpark: { name: "loanDepot park", city: "Miami", state: "FL" } },
  MIL: {
    city: "Milwaukee",
    ballpark: { name: "American Family Field", city: "Milwaukee", state: "WI" },
  },
  MIN: { city: "Minnesota", ballpark: { name: "Target Field", city: "Minneapolis", state: "MN" } },
  NYM: { city: "New York", ballpark: { name: "Citi Field", city: "Flushing", state: "NY" } },
  NYY: { city: "New York", ballpark: { name: "Yankee Stadium", city: "Bronx", state: "NY" } },
  ATH: {
    city: "",
    ballpark: { name: "Sutter Health Park", city: "Sacramento", state: "CA" },
  },
  PHI: {
    city: "Philadelphia",
    ballpark: { name: "Citizens Bank Park", city: "Philadelphia", state: "PA" },
  },
  PIT: { city: "Pittsburgh", ballpark: { name: "PNC Park", city: "Pittsburgh", state: "PA" } },
  SD: { city: "San Diego", ballpark: { name: "Petco Park", city: "San Diego", state: "CA" } },
  SF: {
    city: "San Francisco",
    ballpark: { name: "Oracle Park", city: "San Francisco", state: "CA" },
  },
  SEA: { city: "Seattle", ballpark: { name: "T-Mobile Park", city: "Seattle", state: "WA" } },
  STL: { city: "St. Louis", ballpark: { name: "Busch Stadium", city: "St. Louis", state: "MO" } },
  TB: {
    city: "Tampa Bay",
    ballpark: { name: "Tropicana Field", city: "St. Petersburg", state: "FL" },
  },
  TEX: { city: "Texas", ballpark: { name: "Globe Life Field", city: "Arlington", state: "TX" } },
  TOR: { city: "Toronto", ballpark: { name: "Rogers Centre", city: "Toronto", state: "ON" } },
  WSH: {
    city: "Washington",
    ballpark: { name: "Nationals Park", city: "Washington", state: "DC" },
  },
};

// What fans call a club besides its name, its city, and its code, which a search reads but never
// writes. Both Sox go by "Sox", which finds either's games.
const NICKNAMES = {
  ARI: ["dbacks", "d backs", "phoenix diamondbacks"],
  ATH: ["oakland", "sacramento athletics"],
  BOS: ["sox"],
  COL: ["denver rockies"],
  CWS: ["sox"],
  LAA: ["anaheim angels"],
  MIN: ["minneapolis twins"],
  NYM: ["ny mets", "nyc mets", "new york city mets", "queens mets", "flushing mets"],
  NYY: ["bronx bombers", "ny yankees", "nyc yankees", "new york city yankees", "bronx yankees"],
  PHI: ["phils", "philly phillies"],
  SF: ["sf giants"],
  STL: ["cards", "saint louis cardinals"],
  TB: ["tampa", "tampa rays"],
  TEX: ["dallas rangers", "arlington rangers"],
  TOR: ["jays"],
  WSH: ["nats", "dc nationals", "washington dc nationals"],
};

// A club's name after its city's short name, which a suggestion writes for one typed that way.
const SHORT_NAMES = {
  LAA: ["LA Angels"],
  LAD: ["LA Dodgers"],
};

// The places a search can name that span more than one ballpark city, or go by another name. A
// part of a place finds only its own ballpark, and the place finds each of its parts'.
/** @type {SearchPlace[]} */
const PLACES = [
  {
    name: "New York",
    words: ["new york", "ny", "nyc", "new york city"],
    cities: ["Flushing", "Bronx", "New York"],
  },
  { name: "The Bronx", words: ["bronx", "the bronx"], cities: ["Bronx"] },
  { name: "Queens", words: ["queens", "flushing"], cities: ["Flushing"] },
  {
    name: "Los Angeles",
    words: ["los angeles", "la"],
    cities: ["Los Angeles", "Anaheim"],
  },
  { name: "Anaheim", words: ["anaheim"], cities: ["Anaheim"] },
  { name: "San Francisco", words: ["san francisco", "sf"], cities: ["San Francisco"] },
  { name: "Washington", words: ["washington", "dc", "washington dc"], cities: ["Washington"] },
  {
    name: "Tampa Bay",
    words: ["tampa bay", "tampa", "st pete"],
    cities: ["St. Petersburg", "Tampa"],
  },
  { name: "Dallas", words: ["dallas", "arlington"], cities: ["Arlington", "Dallas"] },
  { name: "Philadelphia", words: ["philadelphia", "philly"], cities: ["Philadelphia"] },
  { name: "Minneapolis", words: ["minneapolis", "twin cities"], cities: ["Minneapolis"] },
  { name: "St. Louis", words: ["st louis", "saint louis"], cities: ["St. Louis"] },
  { name: "California", words: ["california", "cali"], cities: [], states: ["CA"] },
  { name: "Florida", words: ["florida"], cities: [], states: ["FL"] },
  { name: "Ohio", words: ["ohio"], cities: [], states: ["OH"] },
  { name: "Pennsylvania", words: ["pennsylvania"], cities: [], states: ["PA"] },
  { name: "Missouri", words: ["missouri"], cities: [], states: ["MO"] },
  { name: "Canada", words: ["canada"], cities: [], states: ["ON"] },
];

// The word ending a ballpark's name that every ballpark has.
const BALLPARK_WORD = /\s+(park|field|stadium|ballpark|centre)$/i;

const LEAGUES = {
  AL: ["american league", "junior circuit"],
  NL: ["national league", "senior circuit"],
};
const LEAGUE_NAMES = { AL: "American League", NL: "National League" };

// Each round, the words for both leagues', and each league's name for its own.
const ROUNDS = [
  {
    round: 1,
    key: "WC",
    name: "Wild Card Series",
    words: ["wild card", "wild card series", "wildcard", "wc", "wcs"],
    leagueName: (/** @type {string} */ league) => `${league} Wild Card Series`,
    leagueWords: (/** @type {string} */ league) => [
      `${league} wild card`,
      `${league} wild card series`,
      `${LEAGUE_NAMES[league]} wild card`,
    ],
  },
  {
    round: 2,
    key: "DS",
    name: "Division Series",
    words: ["division series", "ds"],
    leagueName: (/** @type {string} */ league) => `${league}DS`,
    leagueWords: (/** @type {string} */ league) => [
      `${league}ds`,
      `${league} division series`,
      `${LEAGUE_NAMES[league]} division series`,
    ],
  },
  {
    round: 3,
    key: "CS",
    name: "LCS",
    words: ["lcs", "championship series", "league championship series"],
    leagueName: (/** @type {string} */ league) => `${league}CS`,
    leagueWords: (/** @type {string} */ league) => [
      `${league}cs`,
      `${league} pennant`,
      `${LEAGUE_NAMES[league]} championship series`,
    ],
  },
  {
    round: 4,
    key: "WS",
    name: "World Series",
    words: ["world series", "ws", "fall classic"],
  },
];

// Searches to tap before anything is typed, each offered only when it finds a game.
const EXAMPLES = [
  "Mets next game",
  "Mets at Phillies",
  "Yankees in Boston",
  "Games this weekend",
  "World Series",
  "Mets last game",
  "Postseason",
];

/** @param {string} code */
function listTeamWords(code) {
  const { city } = CLUBS[code];
  const { name } = TEAMS[code];
  const names = city ? [city, `${city} ${name}`] : [];
  return [name, ...names, code, ...(NICKNAMES[code] ?? [])].map((word) => word.toLowerCase());
}

/** @returns {SearchRound[]} */
const listRounds = () =>
  ROUNDS.flatMap(({ round, name, words, leagueName, leagueWords }) => [
    { round, name, words },
    ...(leagueName && leagueWords
      ? Object.keys(LEAGUES).map((league) => ({
          round,
          name: leagueName(league),
          words: leagueWords(league),
          conference: league,
        }))
      : []),
  ]);

/**
 * Each league, and each division from the standings.
 * @param {Record<string, { id: string }[]>} divisions
 */
function listGroups(divisions) {
  const leagues = Object.entries(LEAGUES).map(([league, words]) => ({
    name: league,
    words: [league.toLowerCase(), `${league.toLowerCase()} teams`, ...words],
    codes: Object.keys(TEAMS).filter((code) => TEAMS[code].league === league),
  }));
  const named = Object.entries(divisions).map(([division, rows]) => {
    const [league, part] = division.split(" ");
    return {
      name: division,
      words: [division.toLowerCase(), `${LEAGUE_NAMES[league]} ${part}`.toLowerCase()],
      codes: rows.map((row) => row.id),
    };
  });
  return [...leagues, ...named];
}

/**
 * Each starter the season's games name, by his whole name and his last.
 * @param {any[]} games
 */
function listStarters(games) {
  const starters = new Map();
  for (const starter of games.flatMap((game) => game.starters ?? []))
    if (starter?.name && !starters.has(starter.id)) starters.set(starter.id, starter);
  return [...starters.values()].map((starter) => {
    const name = starter.firstName ? `${starter.firstName} ${starter.name}` : starter.name;
    return { id: String(starter.id), name, words: [...new Set([name, starter.name])] };
  });
}

/**
 * Every ballpark the season's games are played in, and each club's own.
 * @param {any[]} games
 */
const listBallparks = (games) => [
  ...Object.values(CLUBS).map((club) => club.ballpark),
  ...games.flatMap((game) => (game.ballpark ? [game.ballpark] : [])),
];

const EXTRA_INNINGS = {
  name: "Extra innings",
  words: ["extra innings", "extra inning", "extras", "extra frames", "free baseball"],
  games: "extra-inning games",
};
const REGULATION_INNINGS = 9;

/**
 * MLB's terms for a season's search, with each division from its standings.
 * @param {{ games: any[], divisions?: Record<string, { id: string }[]> }} season
 * @returns {SearchTerms}
 */
export function createSearchTerms({ games, divisions = {} }) {
  return {
    teams: Object.keys(TEAMS).map((code) => ({
      code,
      name: TEAMS[code].name,
      words: listTeamWords(code),
      shownNames: [nameClubFully(code), ...(SHORT_NAMES[code] ?? [])],
      homeCity: CLUBS[code].ballpark.city,
      homeState: CLUBS[code].ballpark.state,
      conference: TEAMS[code].league,
    })),
    places: [...PLACES, ...listVenuePlaces(listBallparks(games), PLACES, BALLPARK_WORD)],
    groups: listGroups(divisions),
    crossConference: { name: "Interleague", words: ["interleague", "inter league"] },
    rounds: listRounds(),
    starters: listStarters(games),
    kindNames: { cup: "Cup", allStar: "All-Star Game" },
    examples: EXAMPLES,
    channels: listSearchChannels(games),
    pastRegulation: EXTRA_INNINGS,
  };
}

const ROUND_NUMBERS = { WC: 1, DS: 2, CS: 3, WS: 4 };

/**
 * A postseason series' round and league, from its id, like "AL_DS1" or "WS".
 * @param {string | undefined} series
 */
function readSeries(series) {
  if (!series) return { round: null, conference: null };
  if (series === "WS") return { round: ROUND_NUMBERS.WS, conference: null };
  const [league, key = ""] = series.split("_");
  return { round: ROUND_NUMBERS[key.replace(/\d+$/, "")] ?? null, conference: league };
}

/**
 * A start's minutes after midnight on a clock, or null until its time is set.
 * @param {any} game
 * @param {string} [timeZone] the viewer's own when not given
 */
function readStartMinutes(game, timeZone) {
  const start = new Date(game.start ?? "");
  if (game.tbd || Number.isNaN(start.getTime())) return null;
  return readMinutesIntoDay(start, timeZone);
}

/** @param {any} game */
function readWinner(game) {
  if (game.state !== "final" || !game.score) return null;
  return game.score[0] > game.score[1] ? game.away : game.home;
}

/** @param {any} game */
const readKind = (game) => {
  if (game.allStar) return "all-star";
  return game.postseason ? "playoffs" : "regular";
};

/**
 * A club's name with its city, as "New York Mets", or its name alone when its city isn't in it.
 * @param {string} code
 */
export const nameClubFully = (code) =>
  [CLUBS[code].city, TEAMS[code].name].filter(Boolean).join(" ");

/**
 * An MLB game as a search reads it, or null for one called off, which is played on another day.
 * @param {any} game
 * @returns {SearchGame | null}
 */
export function readSearchGame(game) {
  if (!game.date || game.state === "off") return null;
  const { round, conference } = readSeries(game.series);
  const minutes = readStartMinutes(game);
  const timeZone = game.ballpark?.timeZone;
  return {
    id: game.id,
    day: game.date,
    minutes,
    localMinutes: timeZone ? readStartMinutes(game, timeZone) : minutes,
    startMs: Date.parse(game.start ?? "") || Date.parse(`${game.date}T12:00:00Z`),
    away: game.allStar ? null : (game.away ?? null),
    home: game.allStar ? null : (game.home ?? null),
    state: game.state === "live" || game.state === "final" ? game.state : "pre",
    winner: game.allStar ? null : readWinner(game),
    kind: readKind(game),
    round,
    conference,
    number: game.number ?? null,
    isIfNeeded: !!game.ifNecessary,
    isDoubleheader: !!game.doubleheader,
    arena: game.ballpark
      ? { name: game.ballpark.name, city: game.ballpark.city, state: game.ballpark.state }
      : null,
    isNeutral: !!game.neutral,
    networks: game.networks ?? [],
    isPastRegulation: game.state === "final" && (game.innings ?? 0) > REGULATION_INNINGS,
    starters: (game.starters ?? [])
      .filter(Boolean)
      .map((/** @type {any} */ starter) => ({ id: String(starter.id), name: starter.name })),
    game,
  };
}
