// Saying how a search read its words: the line under the field, what it's about in bold and then
// what else it asks and how many games it found, and what the list says when it finds none. Runs
// in the page and in Node, so it uses no DOM.

import { joinNames } from "./html.js";
import { isUnread } from "./game-search-read.js";
import { readRangeAsked, readTeamsAsked } from "./game-search-match.js";

/** @typedef {import("./game-search.js").Search} Search */
/** @typedef {import("./game-search.js").SearchContext} SearchContext */
/** @typedef {import("./game-search.js").SearchGame} SearchGame */
/** @typedef {ReturnType<typeof import("./game-search-match.js").findSearchGames>} FoundGames */

const KIND_LABELS = { playoffs: "Playoffs", regular: "Regular season" };
const STATE_LABELS = { live: "Live", pre: "Upcoming", final: "Results" };
const OUTCOME_LABELS = { win: "Wins", loss: "Losses" };

/**
 * @param {SearchContext} context
 * @param {string} code
 */
const nameTeam = (context, code) => context.teamsByCode.get(code)?.name ?? code;

/**
 * The teams one word names, as the line says them: "Red Sox or White Sox".
 * @param {SearchContext} context
 * @param {string[]} codes
 */
const nameTeams = (context, codes) =>
  joinNames(
    codes.map((code) => nameTeam(context, code)),
    "or",
  );

// How the line says the side a search asks for, and how the list says it before "games".
const LINE_SIDES = { home: " at home", away: " away" };
const NO_GAMES_SIDES = { home: " home", away: " away" };

/**
 * What the line calls the teams a search asks for: "Liberty", "Liberty at home", "Liberty vs Dream",
 * "Liberty vs Dream at home", "Liberty @ Dream", "Liberty or Aces", or "Liberty or Aces away".
 * @param {Search} search
 * @param {SearchContext} context
 * @param {typeof LINE_SIDES} sides how the side a search asks for reads after the teams
 */
function describeTeams(search, context, sides) {
  const asked = readTeamsAsked(search);
  if (!asked) return search.group ? `${search.group.name} teams` : null;
  const names = asked.slots.map((slot) => (slot ? nameTeams(context, slot) : null));
  const side = sides[search.side] ?? "";
  const labels = {
    one: () => `${names[0]}${search.group ? ` vs ${search.group.name}` : ""}${side}`,
    at: () => (names[0] ? `${names[0]} @ ${names[1]}` : `${names[1]} at home`),
    vs: () => `${names[0]} vs ${names[1]}${side}`,
    or: () => `${joinNames(/** @type {string[]} */ (names), "or")}${side}`,
  };
  return labels[asked.how]();
}

/**
 * The channels a search names, as the line says them: "ESPN" or "ESPN or ABC".
 * @param {Search} search
 */
const describeChannels = (search) =>
  joinNames(
    search.channels.map((channel) => channel.name),
    "or",
  );

/**
 * Each condition but the teams, as the line says it.
 * @param {Search} search
 * @param {SearchContext} context
 */
function listConditionLabels(search, context) {
  const range = readRangeAsked(search);
  const kindNames = {
    ...KIND_LABELS,
    cup: context.terms.words.cup,
    "all-star": context.terms.words.allStar,
  };
  return [
    ...search.kinds.map((kind) => kindNames[kind]),
    ...search.rounds.map((round) => round.name),
    search.isCrossConference && context.terms.words.crossConference?.name,
    search.gameNumber !== null && `Game ${search.gameNumber}`,
    search.isIfNeeded && "If necessary",
    search.isDoubleheader && "Doubleheaders",
    ...search.places.map((place) => `In ${place.name}`),
    ...search.times.map((time) => time.label),
    search.ranges.length &&
      (range ? (search.ranges.length === 1 ? search.ranges[0].label : range.label) : "No days"),
    search.weekdays?.label,
    search.landmark?.label,
    ...search.states.map((state) => STATE_LABELS[state]),
    search.outcome && OUTCOME_LABELS[search.outcome],
    search.isPastRegulation && context.terms.words.pastRegulation.name,
    search.channels.length && `On ${describeChannels(search)}`,
  ].filter(Boolean);
}

/**
 * @param {{ which: "next" | "last", count: number }} pick
 * @param {string} noun "game", or "start" for a starter's
 */
function describePick({ which, count }, noun) {
  const first = which === "next" ? "Next" : "Last";
  return count === 1 ? `${first} ${noun}` : `${first} ${count} ${noun}s`;
}

/**
 * How many of something there are, as the line says it: "1 game", "3 games", or "No games".
 * @param {number} count
 * @param {string} [noun]
 * @param {string} [plural]
 */
export const describeCount = (count, noun = "game", plural = `${noun}s`) =>
  count ? `${count} ${count === 1 ? noun : plural}` : `No ${plural}`;

/**
 * The starters a search names, as the line says them: "Paul Skenes".
 * @param {Search} search
 */
const describeStarters = (search) =>
  search.starters.length
    ? joinNames(
        search.starters.map((starter) => starter.name),
        "and",
      )
    : null;

/**
 * Whether a search asks for a starter's next start before it's announced.
 * @param {Search} search
 * @param {FoundGames} found
 */
const isStartUnannounced = (search, found) =>
  search.starters.length > 0 && search.pick?.which === "next" && !found.games.length;

/**
 * The line's note on home games at a neutral site: "1 in Vancouver left out".
 * @param {SearchGame[]} leftOut
 */
function describeLeftOut(leftOut) {
  if (!leftOut.length) return null;
  const cities = [...new Set(leftOut.map((game) => game.arena?.city).filter(Boolean))];
  const where = cities.length === 1 ? `in ${cities[0]}` : "played elsewhere";
  return `${leftOut.length} ${where} left out`;
}

/**
 * The line's note on the words a search couldn't use: "'fireworks' unrecognized, skipped".
 * @param {string[]} skipped
 */
const describeSkipped = (skipped) =>
  skipped.length
    ? `${joinNames(
        skipped.map((word) => `'${word}'`),
        "and",
      )} unrecognized, skipped`
    : null;

/**
 * How the line under the field reads a search: what it's about, in bold, then what else it asks,
 * how many games it found, and anything it found only maybe, left out, or couldn't use.
 * @param {Search} search
 * @param {FoundGames} found
 * @param {SearchContext} context
 * @returns {{ lead: string, facts: string[] }}
 */
export function describeSearch(search, found, context) {
  if (isUnread(search))
    return { lead: "No results", facts: [/** @type {string} */ (describeSkipped(search.skipped))] };
  const starters = describeStarters(search);
  const teams = describeTeams(search, context, LINE_SIDES);
  const conditions = listConditionLabels(search, context);
  const lead = starters ?? teams ?? conditions.shift() ?? (search.pick ? null : "All games");
  const noun = starters ? "start" : "game";
  const pick = search.pick && describePick(search.pick, noun);
  const sure = found.games.length - found.timeUnset.length;
  const facts = [
    starters && teams && `vs ${teams}`,
    ...conditions,
    ...(lead === null ? [] : [pick]),
    isStartUnannounced(search, found) && "Not yet announced",
    !search.pick && describeCount(sure, noun),
    found.timeUnset.length && `${found.timeUnset.length} with no time yet`,
    describeLeftOut(found.leftOut),
    describeSkipped(search.skipped),
  ].filter(Boolean);
  return { lead: lead ?? /** @type {string} */ (pick), facts: /** @type {string[]} */ (facts) };
}

/**
 * When a search's one run of days is, in words that follow "games": "in March", "on Thu, Jun 11", or
 * "Oct 2-4".
 * @param {Search} search
 */
function describeWhen(search) {
  const range = search.ranges.length === 1 ? search.ranges[0] : null;
  if (!range) return "";
  if (range.from === range.to) return ` on ${range.label}`;
  return /\d/.test(range.label) ? ` ${range.label}` : ` in ${range.label}`;
}

/**
 * What the games a search asks for are called: "games", or the league's own words for a final past
 * regulation, like "overtime games".
 * @param {Search} search
 * @param {SearchContext} context
 */
const nameGamesAsked = (search, context) =>
  search.isPastRegulation ? context.terms.words.pastRegulation.games : "games";

/**
 * What the list says when a search finds nothing: "No Liberty games in March".
 * @param {Search} search
 * @param {SearchContext} context
 */
export function describeNoGames(search, context) {
  if (isUnread(search)) return "Check the spelling or try a new search";
  const teams = describeTeams(search, context, NO_GAMES_SIDES);
  const where = `${search.places.length ? ` in ${search.places[0].name}` : ""}${
    search.channels.length ? ` on ${describeChannels(search)}` : ""
  }`;
  const starters = describeStarters(search);
  if (starters && search.pick?.which === "next")
    return `${starters}'s next start isn't announced yet`;
  if (starters)
    return `No ${starters} starts${teams ? ` vs ${teams}` : ""}${where}${describeWhen(search)}`;
  return `No ${teams ? `${teams} ` : ""}${nameGamesAsked(search, context)}${where}${describeWhen(search)}`;
}
