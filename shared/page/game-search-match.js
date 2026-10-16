// Finding the games a search asks for. What the search asks is worked out once, its teams, its
// days, and the season's landmarks, and then held against each game of the season, so a search
// does the same work for each game however long the season is. Runs in the page and in Node, so it
// uses no DOM.

import { isInRange, isOnWeekdays, overlapRanges } from "./search-dates.js";
import { isUnread } from "./game-search-read.js";

/** @typedef {import("./game-search.js").Search} Search */
/** @typedef {import("./game-search.js").SearchContext} SearchContext */
/** @typedef {import("./game-search.js").SearchGame} SearchGame */
/** @typedef {import("./game-search.js").SearchPlace} SearchPlace */
/** @typedef {import("./game-search.js").SearchChannel} SearchChannel */
/** @typedef {(game: SearchGame) => boolean} GameCheck */

/**
 * Whether a game has a team in it, or one of the teams one word names.
 * @param {SearchGame} game
 * @param {string[]} codes
 */
const hasTeam = (game, codes) =>
  (!!game.away && codes.includes(game.away)) || (!!game.home && codes.includes(game.home));

/**
 * Who a search's teams are and how they're joined: one, one visiting another, both either way, or
 * any of them. Each is the teams one word names, as "Sox" names two.
 * @param {Search} search
 * @returns {{ how: "one" | "at" | "vs" | "or", slots: (string[] | null)[] } | null}
 */
export function readTeamsAsked({ teams }) {
  if (!teams.length) return null;
  const slots = [...new Map(teams.map((team) => [team.codes.join(), team.codes])).values()];
  if (slots.length === 1) {
    const isHostOnly = teams[0].join === "at";
    return { how: isHostOnly ? "at" : "one", slots: isHostOnly ? [null, slots[0]] : slots };
  }
  if (teams.some((team) => team.join === "or") || slots.length > 2) return { how: "or", slots };
  return { how: teams[1].join === "at" ? "at" : "vs", slots };
}

/**
 * The days every range a search names covers, or null when they don't meet, or undefined when it
 * names none.
 * @param {Search} search
 */
export const readRangeAsked = ({ ranges }) =>
  ranges.length ? ranges.reduce((all, each) => all && overlapRanges(all, each)) : undefined;

/**
 * Whether a code is one of a slot's teams.
 * @param {string | null} code
 * @param {string[] | null} slot
 */
const isIn = (code, slot) => !!code && !!slot?.includes(code);

/**
 * The teams "home" or "away" is about: each of the teams "or" names, as in "Mets or Yankees at
 * home", and otherwise the first, as in "Mets vs Braves at home".
 * @param {NonNullable<ReturnType<typeof readTeamsAsked>>} asked
 */
const listSidedSlots = ({ how, slots }) => (how === "or" ? slots : slots.slice(0, 1));

/**
 * Whether a game has the teams a search asks for, on the side it asks, leaving aside a home game
 * at a neutral site, which `createHomeElsewhereCheck` names.
 * @param {Search} search
 * @returns {GameCheck}
 */
function createTeamsCheck(search) {
  const asked = readTeamsAsked(search);
  const rivals = search.group?.codes ?? null;
  if (!asked) return (game) => !rivals || hasTeam(game, rivals);
  const { side } = search;
  const [first, second] = asked.slots;
  const others = rivals?.filter((code) => !first?.includes(code)) ?? null;
  const checks = {
    one: (/** @type {SearchGame} */ game) =>
      hasTeam(game, /** @type {string[]} */ (first)) && (!others || hasTeam(game, others)),
    at: (/** @type {SearchGame} */ game) =>
      (first === null || isIn(game.away, first)) && isIn(game.home, second) && !game.isNeutral,
    vs: (/** @type {SearchGame} */ game) =>
      hasTeam(game, /** @type {string[]} */ (first)) &&
      hasTeam(game, /** @type {string[]} */ (second)),
    or: (/** @type {SearchGame} */ game) =>
      asked.slots.some((slot) => hasTeam(game, /** @type {string[]} */ (slot))),
  };
  const hasTeams = checks[asked.how];
  const sided = listSidedSlots(asked);
  const sides = {
    home: (/** @type {SearchGame} */ game) =>
      sided.some((slot) => isIn(game.home, slot)) && !game.isNeutral,
    away: (/** @type {SearchGame} */ game) => sided.some((slot) => isIn(game.away, slot)),
  };
  const isOnSide = side ? sides[side] : null;
  return (game) => hasTeams(game) && (!isOnSide || isOnSide(game));
}

/**
 * Whether a game is a home game a search would find but for being at a neutral site.
 * @param {Search} search
 * @returns {GameCheck}
 */
function createHomeElsewhereCheck(search) {
  const asked = readTeamsAsked(search);
  if (!asked) return () => false;
  const [first, second] = asked.slots;
  const hosts = asked.how === "at" ? [second] : listSidedSlots(asked);
  const isHomeAsked = search.side === "home" || asked.how === "at";
  if (!isHomeAsked) return () => false;
  return (game) =>
    game.isNeutral &&
    hosts.some((host) => isIn(game.home, host)) &&
    (asked.how !== "at" || first === null || (!!game.away && first.includes(game.away)));
}

/**
 * The city a game is played in: its arena's, or, until the league names one, its home team's.
 * @param {SearchContext} context
 * @param {SearchGame} game
 */
function readGameCity(context, game) {
  if (game.arena) return { city: game.arena.city, state: game.arena.state };
  const home = game.home && context.teamsByCode.get(game.home);
  return home && !game.isNeutral ? { city: home.homeCity, state: home.homeState ?? "" } : null;
}

/**
 * @param {SearchPlace} place
 * @param {{ city: string, state: string } | null} where
 */
const isInPlace = (place, where) =>
  !!where &&
  (place.cities.some((city) => city.toLowerCase() === where.city.toLowerCase()) ||
    !!place.states?.some((state) => state.toLowerCase() === where.state.toLowerCase()));

/**
 * Whether a game is played in a place.
 * @param {SearchPlace} place
 * @param {SearchGame} game
 * @param {SearchContext} context
 */
export const isGameInPlace = (place, game, context) =>
  isInPlace(place, readGameCity(context, game));

/**
 * The teams whose own arena is in a place, as the Dodgers and the Angels are in Los Angeles and
 * every club in a state is in it; none for an arena, which names where games are played, not a
 * place teams are from.
 * @param {SearchPlace} place
 * @param {SearchContext} context
 */
export const listPlaceTeams = (place, context) =>
  place.isArena
    ? []
    : context.terms.teams.filter((team) =>
        isInPlace(place, { city: team.homeCity, state: team.homeState ?? "" }),
      );

/**
 * The All-Star break's days, from the last day of games before the All-Star Game to the first
 * after it, or null in a season without one.
 * @param {SearchGame[]} regular the season's regular-season games, in order of start
 * @param {SearchGame | undefined} allStar
 */
function findBreak(regular, allStar) {
  if (!allStar) return null;
  const from = regular.findLast((game) => game.day < allStar.day)?.day ?? allStar.day;
  const to = regular.find((game) => game.day > allStar.day)?.day ?? allStar.day;
  return { from, to };
}

/**
 * Whether a game is on the day a landmark of the season names, in the All-Star break, or on one
 * side of it, from the season's opener, finale, and All-Star Game, found once.
 * @param {SearchContext} context
 * @param {string} name
 * @returns {GameCheck}
 */
function createLandmarkCheck(context, name) {
  const regular = context.games.filter((each) => each.kind === "regular");
  const allStar = context.games.find((each) => each.kind === "all-star");
  const opener = regular[0]?.day;
  const finale = regular.at(-1)?.day;
  const allStarBreak = findBreak(regular, allStar);
  const checks = {
    opener: (/** @type {SearchGame} */ game) => game.kind === "regular" && game.day === opener,
    finale: (/** @type {SearchGame} */ game) => game.kind === "regular" && game.day === finale,
    break: (/** @type {SearchGame} */ game) =>
      !!allStarBreak && game.day >= allStarBreak.from && game.day <= allStarBreak.to,
    "before-break": (/** @type {SearchGame} */ game) =>
      !!allStar && game.day < allStar.day && game.kind !== "all-star",
    "after-break": (/** @type {SearchGame} */ game) => !!allStar && game.day > allStar.day,
  };
  return checks[name];
}

/**
 * Whether a playoff game is in one of the rounds a search asks for, in its conference when the
 * round is one conference's own.
 * @param {Search["rounds"]} rounds
 * @param {SearchGame} game
 */
const isInRoundAsked = (rounds, game) =>
  game.kind === "playoffs" &&
  rounds.some(
    (round) =>
      round.round === game.round && (!round.conference || round.conference === game.conference),
  );

/**
 * Whether a game is between teams of different conferences, as MLB's interleague games are.
 * @param {SearchContext} context
 * @param {SearchGame} game
 */
function isCrossConference(context, game) {
  const away = game.away && context.teamsByCode.get(game.away);
  const home = game.home && context.teamsByCode.get(game.home);
  return !!away && !!home && away.conference !== home.conference;
}

/**
 * Whether each starter a search names starts a game.
 * @param {Search["starters"]} starters
 * @param {SearchGame} game
 */
const hasStartersAsked = (starters, game) =>
  starters.every(({ ids }) => !!game.starters?.some((starter) => ids.includes(starter.id)));

/**
 * Whether a game is on a channel, by any name the league lists it by.
 * @param {SearchChannel} channel
 * @param {SearchGame} game
 */
const isOnChannel = (channel, game) =>
  !!game.networks?.some((network) => channel.listings.includes(network));

/**
 * Whether a final went the way a search asks for its one team.
 * @param {Search} search
 * @returns {GameCheck}
 */
function createOutcomeCheck(search) {
  const teams = search.teams[0]?.codes;
  const isWinAsked = search.outcome === "win";
  return (game) =>
    !!teams &&
    game.state === "final" &&
    !!game.winner &&
    teams.includes(game.winner) === isWinAsked;
}

/**
 * Whether a game fits every condition but the teams and the time of day: a check for each
 * condition the search names.
 * @param {Search} search
 * @param {SearchContext} context
 * @returns {GameCheck}
 */
function createConditionsCheck(search, context) {
  const range = readRangeAsked(search);
  const { weekdays, places, kinds, rounds, starters, gameNumber, states, landmark, channels } =
    search;
  /** @type {(GameCheck | false)[]} */
  const checks = [
    range !== undefined && ((game) => !!range && isInRange(range, game.day, game.minutes)),
    !!weekdays && ((game) => isOnWeekdays(weekdays.value, game.day, game.minutes)),
    places.length > 0 && ((game) => places.some((place) => isGameInPlace(place, game, context))),
    kinds.length > 0 && ((game) => kinds.includes(game.kind)),
    rounds.length > 0 && ((game) => isInRoundAsked(rounds, game)),
    search.isCrossConference && ((game) => isCrossConference(context, game)),
    starters.length > 0 && ((game) => hasStartersAsked(starters, game)),
    gameNumber !== null && ((game) => game.number === gameNumber),
    search.isIfNeeded && ((game) => game.isIfNeeded),
    search.isDoubleheader && ((game) => !!game.isDoubleheader),
    states.length > 0 && ((game) => states.includes(game.state)),
    !!search.outcome && createOutcomeCheck(search),
    !!landmark && createLandmarkCheck(context, landmark.name),
    channels.length > 0 && ((game) => channels.some((channel) => isOnChannel(channel, game))),
    search.isPastRegulation && ((game) => !!game.isPastRegulation),
  ];
  const applying = /** @type {GameCheck[]} */ (checks.filter(Boolean));
  return (game) => applying.every((check) => check(game));
}

/**
 * Whether a game starts in every time of day a search asks for, or null when its time isn't set.
 * @param {Search} search
 * @returns {(game: SearchGame) => boolean | null}
 */
function createTimeCheck({ times }) {
  if (!times.length) return () => true;
  return (game) => {
    if (game.minutes === null) return null;
    return times.every(({ from, to, isLocal }) => {
      const minutes = isLocal ? (game.localMinutes ?? game.minutes) : game.minutes;
      return minutes >= from && minutes < to;
    });
  };
}

/**
 * The games "next" or "last" picks, in order of start.
 * @param {{ which: "next" | "last", count: number }} pick
 * @param {SearchGame[]} games
 */
function pickGames({ which, count }, games) {
  if (which === "next") return games.filter((game) => game.state !== "final").slice(0, count);
  return games.filter((game) => game.state === "final").slice(-count);
}

/**
 * The games a search finds, in order of start, with those whose time isn't set yet that a search for
 * a time of day may yet find, and the home games it leaves out for being at a neutral site.
 * @param {Search} search
 * @param {SearchContext} context
 */
export function findSearchGames(search, context) {
  if (isUnread(search)) return { games: [], timeUnset: [], leftOut: [] };
  const fitsConditions = createConditionsCheck(search, context);
  const hasTeams = createTeamsCheck(search);
  const isHomeElsewhere = createHomeElsewhereCheck(search);
  const fitsTime = createTimeCheck(search);
  const fitting = context.games.filter(fitsConditions);
  const found = fitting.filter((game) => hasTeams(game) && fitsTime(game) !== false);
  const picked = search.pick ? pickGames(search.pick, found) : found;
  const timeUnset = search.times.length ? picked.filter((game) => game.minutes === null) : [];
  const leftOut = fitting.filter((game) => isHomeElsewhere(game) && fitsTime(game) !== false);
  return { games: picked, timeUnset, leftOut };
}
