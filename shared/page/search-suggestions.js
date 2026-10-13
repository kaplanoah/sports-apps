// What a search offers as it's typed, and before anything is. The word being typed is finished
// first, a team before a place or a date, and the team that plays soonest before another that starts
// the same; after a joining word like "in" or "at", the words that can follow it; then whole
// searches built on a team it already names, two at most, which fit where the season stands: its
// next game while it has one, its playoffs while they're on, and its last game once it's done. A
// team's name that is also a place, like "New York", has the games played there as its other
// reading. Nothing is offered that would find no games. Runs in the page and in Node, so it uses no
// DOM.

import { readMonthDays } from "./search-dates.js";
import { countGames, findSearchGames, isGameInPlace, readSearch } from "./game-search.js";
import { readTokens, splitWords } from "./search-words.js";

/** @typedef {import("./game-search.js").SearchContext} SearchContext */
/** @typedef {import("./search-words.js").Meaning} Meaning */
/**
 * A suggestion: the whole search it would run, what marks its row, and a detail at its end, like the
 * days a date covers or how many games a place has.
 * @typedef {{ text: string, mark: { kind: "team", code: string } | { kind: "date" | "place" | "search" }, detail: string }} Suggestion
 */
/** @typedef {{ text: string, meaning: Meaning | null }} Candidate */

const SUGGESTION_COUNT = 4;
// Whole searches sit over the pages and games a search finds, so only a couple show.
const WHOLE_SEARCH_COUNT = 2;
// After "in", a couple of places, then the months, so both kinds show.
const PLACE_COUNT = 2;
export const EXAMPLE_COUNT = 5;

// The kinds of word a typed one can finish into, in the order they're offered.
const FINISHED_KINDS = [
  "team",
  "starter",
  "place",
  "range",
  "month",
  "weekday",
  "weekdays",
  "group",
  "round",
  "kind",
  "state",
  "pick",
  "side",
  "time",
  "landmark",
];
// After "in", only a place or a month fits, and after "at" or "vs", a team, or home.
const KINDS_AFTER = { in: ["place", "month"], at: ["team", "side"], vs: ["team"] };
const DATE_KINDS = new Set(["range", "month", "weekday", "weekdays", "time", "landmark"]);
const NAME_KINDS = new Set(["team", "starter", "place", "month", "weekday", "round", "group"]);

/**
 * The search's own words as typed, each with where it starts.
 * @param {string} text
 */
const listTypedWords = (text) =>
  [...text.matchAll(/\S+/g)].map((match) => ({ word: match[0], at: match.index ?? 0 }));

/** @param {string} text */
const readWords = (text) => splitWords(text).join(" ");

/**
 * What a search finds.
 * @param {string} text
 * @param {SearchContext} context
 */
function findGames(text, context) {
  const search = readSearch(text, context);
  return { search, found: findSearchGames(search, context) };
}

/**
 * When a team next plays, or last did, against another team when one is named, for offering the
 * soonest first.
 * @param {SearchContext} context
 * @param {string} code
 * @param {string | null} [rival]
 */
function readNextStart(context, code, rival = null) {
  const hasTeam = (
    /** @type {import("./game-search.js").SearchGame} */ game,
    /** @type {string} */ team,
  ) => game.away === team || game.home === team;
  const games = context.games.filter(
    (game) => hasTeam(game, code) && (!rival || hasTeam(game, rival)),
  );
  const next = games.find((game) => game.state !== "final");
  return next ? next.startMs : Number.MAX_SAFE_INTEGER - (games.at(-1)?.startMs ?? 0);
}

/**
 * The joining word a search's last word is, as read: "in", "at", or "vs", or null.
 * @param {string} word
 * @param {SearchContext} context
 */
function readJoin(word, context) {
  const meanings = context.dictionary.get(readWords(word)) ?? [];
  if (meanings.some((meaning) => meaning.kind === "in")) return "in";
  return (
    meanings.find((meaning) => meaning.kind === "join" && meaning.value !== "or")?.value ?? null
  );
}

/**
 * How a finished word is written: its name, or, when that doesn't start as typed, the word it
 * finished, as "Vegas" for the Aces.
 * @param {string} phrase
 * @param {Meaning} meaning
 * @param {string} fragment
 */
function writeFinished(phrase, meaning, fragment) {
  if (readWords(meaning.display).startsWith(fragment)) return meaning.display;
  if (!NAME_KINDS.has(meaning.kind)) return phrase;
  return phrase.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/** @param {Meaning} meaning */
const nameMeaning = (meaning) => `${meaning.kind}:${JSON.stringify(meaning.value)}`;

/**
 * Each word the dictionary knows that a typed fragment starts, written whole: a team whose name it
 * starts before one it finds by city or nickname, and the one that plays soonest first.
 * @param {string} fragment the last word or two, as read
 * @param {string[]} kinds
 * @param {SearchContext} context
 */
function listFinishedWords(fragment, kinds, context) {
  /** @type {Map<string, { written: string, meaning: Meaning, isName: boolean }>} */
  const words = new Map();
  for (const [phrase, meanings] of context.dictionary) {
    if (phrase === fragment || !phrase.startsWith(fragment)) continue;
    const meaning = meanings.find((each) => kinds.includes(each.kind) && each.display);
    if (!meaning) continue;
    const written = writeFinished(phrase, meaning, fragment);
    const isName = written === meaning.display;
    const kept = words.get(nameMeaning(meaning));
    if (!kept || (isName && !kept.isName))
      words.set(nameMeaning(meaning), { written, meaning, isName });
  }
  const readSoonest = (/** @type {Meaning} */ meaning) =>
    meaning.kind === "team" ? readNextStart(context, meaning.value) : 0;
  return [...words.values()].sort(
    (first, second) =>
      kinds.indexOf(first.meaning.kind) - kinds.indexOf(second.meaning.kind) ||
      Number(second.isName) - Number(first.isName) ||
      readSoonest(first.meaning) - readSoonest(second.meaning),
  );
}

/**
 * The word being typed, finished, unless it's a joining word already whole, or ends a phrase
 * already whole that nothing longer starts, as "weekend" does "this weekend".
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Candidate[]}
 */
function listFinishingCandidates(text, context) {
  const typed = listTypedWords(text);
  if (/\s$/.test(text) || readJoin(typed.at(-1)?.word ?? "", context)) return [];
  for (const length of [2, 1]) {
    if (typed.length < length) continue;
    const start = typed[typed.length - length];
    const before = typed[typed.length - length - 1];
    const kinds = KINDS_AFTER[before ? readJoin(before.word, context) : ""] ?? FINISHED_KINDS;
    const head = text.slice(0, start.at);
    const fragment = readWords(text.slice(start.at));
    const finished = listFinishedWords(fragment, kinds, context);
    if (finished.length)
      return finished.map(({ written, meaning }) => ({ text: `${head}${written}`, meaning }));
    if (context.dictionary.has(fragment)) return [];
  }
  return [];
}

/**
 * The months the season is played in, from the current one on, then the ones gone by.
 * @param {SearchContext} context
 * @returns {Meaning[]}
 */
function listSeasonMonths(context) {
  const first = Number(context.seasonStart.slice(5, 7));
  const last = Number(context.seasonEnd.slice(5, 7));
  const now = Number(context.today.slice(5, 7));
  const months = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const ordered = [
    ...months.filter((month) => month >= now),
    ...months.filter((month) => month < now),
  ];
  return ordered.map((month) => ({
    kind: "month",
    value: month,
    display: readMonthDays(month, context.year).label,
  }));
}

/**
 * The places a search could go on to, the ones with the most of its games first, leaving out its
 * team's own city, which "at home" offers.
 * @param {string} head the search so far
 * @param {string | null} team the one team the search names
 * @param {SearchContext} context
 * @returns {Meaning[]}
 */
function listBusiestPlaces(head, team, context) {
  const games = findGames(head, context).found.games;
  const home = team && context.teamsByCode.get(team)?.homeCity;
  return context.terms.places
    .filter((place) => !place.isArena && !place.cities.includes(home))
    .map((place) => ({
      meaning: { kind: "place", value: place, display: place.name },
      count: games.filter((game) => isGameInPlace(place, game, context)).length,
    }))
    .filter(({ count }) => count)
    .sort((first, second) => second.count - first.count)
    .slice(0, PLACE_COUNT)
    .map(({ meaning }) => meaning);
}

/**
 * What can follow a joining word: after "in", the busiest places, then the months; after "at",
 * each team, the one the search's team meets soonest first, and home; after "vs", each team.
 * @param {string} join
 * @param {string} head the search before its joining word
 * @param {SearchContext} context
 * @returns {Meaning[]}
 */
function listNextWords(join, head, context) {
  const rival = findOnlyTeam(head, context);
  const teams = context.terms.teams
    .filter((team) => team.code !== rival)
    .map((team) => ({ team, start: readNextStart(context, team.code, rival) }))
    .sort((first, second) => first.start - second.start)
    .map(({ team }) => ({ kind: "team", value: team.code, display: team.name }));
  const words = {
    in: () => [...listBusiestPlaces(head, rival, context), ...listSeasonMonths(context)],
    at: () => [...teams, { kind: "side", value: "home", display: "home" }],
    vs: () => teams,
  };
  return words[join]?.() ?? [];
}

/**
 * After a joining word, each word that can follow it.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Candidate[]}
 */
function listFollowingCandidates(text, context) {
  const last = listTypedWords(text).at(-1);
  const join = last ? readJoin(last.word, context) : null;
  if (!last || !join) return [];
  const head = text.slice(0, last.at).trimEnd();
  return listNextWords(join, head, context).map((meaning) => ({
    text: `${text.trimEnd()} ${meaning.display}`,
    meaning,
  }));
}

/**
 * The opponent a team plays next, or last did.
 * @param {SearchContext} context
 * @param {string} code
 */
function findOpponent(context, code) {
  const games = context.games.filter(
    (game) => (game.away === code || game.home === code) && game.away && game.home,
  );
  const game = games.find((each) => each.state !== "final") ?? games.at(-1);
  return game ? (game.away === code ? game.home : game.away) : null;
}

/**
 * The one team a search names and nothing else, or null.
 * @param {string} text
 * @param {SearchContext} context
 */
function findOnlyTeam(text, context) {
  const search = readSearch(text, context);
  const asksMore = [
    search.skipped,
    search.starters,
    search.places,
    search.ranges,
    search.times,
    search.kinds,
    search.states,
  ].some((list) => list.length);
  const [team] = search.teams;
  const isOnlyTeam =
    search.teams.length === 1 &&
    team.codes.length === 1 &&
    !asksMore &&
    !search.pick &&
    !search.side;
  return isOnlyTeam ? team.codes[0] : null;
}

/**
 * The one starter a search names and nothing else, or null.
 * @param {string} text
 * @param {SearchContext} context
 */
function findOnlyStarter(text, context) {
  const search = readSearch(text, context);
  const [starter] = search.starters;
  const isOnly =
    search.starters.length === 1 &&
    !search.teams.length &&
    !search.skipped.length &&
    !search.pick &&
    !search.ranges.length;
  return isOnly ? starter : null;
}

/**
 * Whole searches about the one starter a search names: his next start, once it's announced, and
 * his last.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Candidate[]}
 */
function listStarterSearchCandidates(text, context) {
  const starter = findOnlyStarter(text, context);
  if (!starter) return [];
  return [`${starter.name} next start`, `${starter.name} last start`].map((search) => ({
    text: search,
    meaning: null,
  }));
}

/**
 * Whole searches about the one team a search names, fitting where the season stands.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Candidate[]}
 */
function listTeamSearchCandidates(text, context) {
  const code = findOnlyTeam(text, context);
  if (!code) return [];
  const team = context.teamsByCode.get(code)?.name ?? code;
  const games = context.games.filter((game) => game.away === code || game.home === code);
  const hasNext = games.some((game) => game.state !== "final");
  const isInPlayoffs = games.some((game) => game.kind === "playoffs" && game.state !== "final");
  const opponent = findOpponent(context, code);
  const opponentName = opponent && context.teamsByCode.get(opponent)?.name;
  return [
    hasNext ? `${team} next game` : `${team} last game`,
    isInPlayoffs && `${team} playoffs`,
    `${team} at home`,
    opponentName && `${team} vs ${opponentName}`,
  ]
    .filter(Boolean)
    .map((search) => ({ text: search, meaning: null }));
}

/**
 * What marks a suggestion's row, and its detail: a team's dot, a date's days, or a place's or a
 * month's games.
 * @param {Meaning | null} meaning the finished word's, or null for a whole search
 * @param {ReturnType<typeof findGames>} result
 * @returns {Pick<Suggestion, "mark" | "detail">}
 */
function describeRow(meaning, { search, found }) {
  const count = countGames(found.games.length);
  if (meaning?.kind === "team") return { mark: { kind: "team", code: meaning.value }, detail: "" };
  if (meaning?.kind === "place") return { mark: { kind: "place" }, detail: count };
  if (meaning?.kind === "month") return { mark: { kind: "date" }, detail: count };
  if (meaning && DATE_KINDS.has(meaning.kind))
    return { mark: { kind: "date" }, detail: search.ranges.at(-1)?.label ?? "" };
  return { mark: { kind: "search" }, detail: "" };
}

/**
 * Each candidate that finds a game and differs from what's typed, once, as a row.
 * @param {Candidate[]} candidates
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Suggestion[]}
 */
function listUseful(candidates, text, context) {
  const seen = new Set([readWords(text)]);
  const useful = [];
  let wholeSearches = 0;
  for (const candidate of candidates) {
    const key = readWords(candidate.text);
    const isWholeSearch = !candidate.meaning;
    if (seen.has(key) || (isWholeSearch && wholeSearches === WHOLE_SEARCH_COUNT)) continue;
    seen.add(key);
    const result = findGames(candidate.text, context);
    if (!result.found.games.length) continue;
    useful.push({ text: candidate.text, ...describeRow(candidate.meaning, result) });
    if (isWholeSearch) wholeSearches += 1;
    if (useful.length === SUGGESTION_COUNT) break;
  }
  return useful;
}

/**
 * Suggestions as a search is typed: its word finished, or what can follow its joining word, with
 * whole searches on its one team right after the word that names it.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Suggestion[]}
 */
export function listSuggestions(text, context) {
  if (!text.trim()) return [];
  const [first, ...others] = [
    ...listFinishingCandidates(text, context),
    ...listFollowingCandidates(text, context),
  ];
  const searches = [
    ...listTeamSearchCandidates(first?.text ?? text, context),
    ...listStarterSearchCandidates(first?.text ?? text, context),
  ];
  return listUseful([first, ...searches, ...others].filter(Boolean), text, context);
}

/**
 * The league's example searches that find a game, to offer before anything is typed, as many as
 * there's `room` for.
 * @param {SearchContext} context
 * @param {number} [room]
 */
export const listExamples = (context, room = EXAMPLE_COUNT) =>
  context.terms.examples
    .filter((example) => findGames(example, context).found.games.length)
    .slice(0, room);

/**
 * A search's word as another reading writes it: a team by its name, and anything else as typed.
 * @param {import("./search-words.js").Token} token
 */
function writeToken(token) {
  const teams = token.meanings.filter((meaning) => meaning.kind === "team");
  return teams.length === 1 && token.meanings.length === 1
    ? (teams[0].display ?? token.text)
    : token.text;
}

/**
 * The other way to read a search whose words name a team that is also a place, as "New York"
 * names the Liberty, or the games played in New York: the same search with the place for the
 * team, when it finds games.
 * @param {string} text
 * @param {SearchContext} context
 * @returns {Suggestion[]}
 */
export function listOtherReadings(text, context) {
  const tokens = readTokens(text, context.dictionary);
  return tokens.flatMap((token, index) => {
    const place = token.meanings.find((meaning) => meaning.kind === "place");
    const isTeam = token.meanings.some((meaning) => meaning.kind === "team");
    const isAfterIn = tokens[index - 1]?.meanings.some((meaning) => meaning.kind === "in");
    if (!place || !isTeam || isAfterIn) return [];
    const words = tokens
      .map((each, at) => (at === index ? `in ${place.display}` : writeToken(each)))
      .join(" ");
    const reading = words.startsWith("in ") ? `Games ${words}` : words;
    const { found } = findGames(reading, context);
    if (!found.games.length) return [];
    return [{ text: reading, mark: { kind: "search" }, detail: countGames(found.games.length) }];
  });
}
