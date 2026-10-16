// The WNBA's words for a search of its season's games: its teams by name, city, code, and the
// nicknames fans use, the places its games are played, its playoff rounds, the channels its games
// are on, and how to read one of its games. Runs in the page and in Node, so it uses no DOM.

import { formatCalendarDate, readMinutesIntoDay } from "#shared/days.js";
import { listSearchChannels, listVenuePlaces } from "#shared/game-search.js";
import { readGameDay } from "./days.js";
import { LEAGUE_WORDS } from "./league-words.js";
import { isCupFinal, ROUNDS } from "./snapshot.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/game-search.js").SearchTerms} SearchTerms */
/** @typedef {import("#shared/game-search.js").SearchGame} SearchGame */
/** @typedef {import("#shared/game-search.js").SearchPlace} SearchPlace */
/** @typedef {import("./games-view.js").Game} Game */

// The city of each team's own arena, as the league's schedule names it.
const HOME_CITIES = {
  ATL: "Atlanta",
  CHI: "Chicago",
  CON: "Uncasville",
  DAL: "Arlington",
  GSV: "San Francisco",
  IND: "Indianapolis",
  LAS: "Los Angeles",
  LVA: "Las Vegas",
  MIN: "Minneapolis",
  NYL: "Brooklyn",
  PDX: "Portland",
  PHX: "Phoenix",
  SEA: "Seattle",
  TOR: "Toronto",
  WAS: "Washington",
};

// What fans call a team besides its name, its city, and its code, which a search reads but never
// writes.
const NICKNAMES = {
  ATL: ["atl dream"],
  CON: ["ct sun"],
  DAL: ["arlington wings"],
  GSV: ["valks", "gs", "san francisco valkyries", "sf valkyries"],
  IND: ["indianapolis fever"],
  LAS: ["la"],
  LVA: ["vegas", "lv", "vegas aces", "lv aces"],
  MIN: ["minneapolis lynx"],
  NYL: ["ny", "nyc", "ny liberty", "nyc liberty", "brooklyn liberty"],
  WAS: ["dc", "dc mystics", "washington dc mystics"],
};

// A team's name after its city's short name, which a suggestion writes for one typed that way.
const SHORT_NAMES = {
  LAS: ["LA Sparks"],
};

// The places a search can name, each with the arena cities in it.
/** @type {SearchPlace[]} */
const PLACES = [
  {
    name: "New York",
    words: ["new york", "ny", "nyc", "brooklyn"],
    cities: ["Brooklyn", "New York"],
  },
  {
    name: "San Francisco",
    words: ["san francisco", "sf", "golden state"],
    cities: ["San Francisco"],
  },
  { name: "Las Vegas", words: ["las vegas", "vegas", "lv"], cities: ["Las Vegas"] },
  { name: "Washington", words: ["washington", "dc", "washington dc"], cities: ["Washington"] },
  { name: "Atlanta", words: ["atlanta", "atl"], cities: ["Atlanta", "College Park"] },
  { name: "Dallas", words: ["dallas", "arlington"], cities: ["Arlington", "Dallas"] },
  { name: "Minnesota", words: ["minnesota", "minneapolis"], cities: ["Minneapolis"] },
  { name: "Indiana", words: ["indiana", "indianapolis"], cities: ["Indianapolis"] },
  { name: "Connecticut", words: ["connecticut", "ct"], cities: ["Uncasville"] },
  { name: "Los Angeles", words: ["los angeles", "la"], cities: ["Los Angeles"] },
  { name: "Chicago", words: ["chicago"], cities: ["Chicago"] },
  { name: "Seattle", words: ["seattle"], cities: ["Seattle"] },
  { name: "Phoenix", words: ["phoenix"], cities: ["Phoenix"] },
  { name: "Portland", words: ["portland"], cities: ["Portland"] },
  { name: "Toronto", words: ["toronto"], cities: ["Toronto"] },
];

const ROUND_WORDS = {
  1: ["first round", "1st round", "round 1", "round one", "opening round", "1st rd"],
  2: ["semifinals", "semifinal", "semis", "semi finals", "second round", "2nd round", "round 2"],
  3: ["finals", "wnba finals", "the finals", "championship", "final round"],
};

// Searches to tap before anything is typed, each offered only when it finds a game.
const EXAMPLES = [
  "Dream at Valkyries",
  "Aces in New York",
  "Games this weekend",
  "Finals",
  "Liberty last game",
  "Liberty next game",
  "Playoffs",
];

/** @param {string} code */
function listTeamWords(code) {
  const { city, name } = TEAMS[code];
  return [name, city, `${city} ${name}`, code, ...(NICKNAMES[code] ?? [])].map((word) =>
    word.toLowerCase(),
  );
}

// The word ending an arena's name that every arena has.
const ARENA_WORD = /\s+(center|arena|fieldhouse|coliseum|garden)$/i;

/** @param {Game[]} games */
const listArenas = (games) => games.flatMap((game) => (game.arena ? [game.arena] : []));

/**
 * The WNBA's terms for a season's search, with each team's conference from its standings.
 * @param {{ games: Game[], standings?: { team: string, conference: string }[] }} season
 * @returns {SearchTerms}
 */
export function createSearchTerms({ games, standings = [] }) {
  const conferences = new Map(standings.map((row) => [row.team, row.conference]));
  return {
    teams: Object.keys(TEAMS).map((code) => ({
      code,
      name: TEAMS[code].name,
      words: listTeamWords(code),
      shownNames: [`${TEAMS[code].city} ${TEAMS[code].name}`, ...(SHORT_NAMES[code] ?? [])],
      homeCity: HOME_CITIES[code],
      conference: conferences.get(code) ?? "",
    })),
    places: [...PLACES, ...listVenuePlaces(listArenas(games), PLACES, ARENA_WORD)],
    rounds: Object.entries(ROUNDS).map(([round, { name }]) => ({
      round: Number(round),
      name,
      words: ROUND_WORDS[round],
    })),
    examples: EXAMPLES,
    channels: listSearchChannels(games),
    words: LEAGUE_WORDS,
  };
}

/** @param {Game} game */
function readKind(game) {
  if (game.allStar) return "all-star";
  if (isCupFinal(game)) return "cup";
  return game.round ? "playoffs" : "regular";
}

/** @param {Game} game */
function readWinner(game) {
  if (game.state !== "final" || game.away.score === null || game.home.score === null) return null;
  return game.away.score > game.home.score ? game.away.team : game.home.team;
}

/**
 * A game's start in minutes after midnight on the viewer's clock, or null until its time is set.
 * @param {Game} game
 */
function readStartMinutes(game) {
  const start = new Date(game.start ?? "");
  if (!game.isTimeSet || Number.isNaN(start.getTime())) return null;
  return readMinutesIntoDay(start);
}

/**
 * A WNBA game as a search reads it, or null for one without a day.
 * @param {Game} game
 * @param {Record<string, number> | null} overtimes how many overtimes each final that went past
 *   regulation played, by its id, as the store keeps them
 * @returns {SearchGame | null}
 */
export function readSearchGame(game, overtimes) {
  const day = readGameDay(game);
  if (!day) return null;
  return {
    id: game.id,
    day: formatCalendarDate(day),
    minutes: readStartMinutes(game),
    startMs: Date.parse(game.start ?? "") || day.getTime(),
    away: game.allStar ? null : game.away.team,
    home: game.allStar ? null : game.home.team,
    state: /** @type {"pre" | "live" | "final"} */ (game.state),
    winner: game.allStar ? null : readWinner(game),
    kind: readKind(game),
    round: game.round,
    number: game.number,
    isIfNeeded: game.isIfNeeded,
    arena: game.arena ?? null,
    isNeutral: !!game.isNeutral,
    networks: game.networks ?? [],
    isPastRegulation: !!overtimes?.[game.id],
    game,
  };
}
