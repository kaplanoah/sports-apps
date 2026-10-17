// What a search shows for its words, before the view draws it: the examples before anything is
// typed, the suggestions while words are, the pages the words name, the other ways to read them,
// and the games they find, with the line saying how it read them, and the day the list opens on.
// A word still being typed is read as the team or place the first suggestion finishes it into, once
// three letters of its name are typed, or five with one wrong, and otherwise left out until it's
// whole, even typed with an accent or a period. Runs in the page and in Node, so it uses no DOM.

import { describeSearch, findSearchGames, isAskingNothing, readSearch } from "./game-search.js";
import { SHORTEST_PREFIX, findPages, findPartGame, startsPlayerName } from "./page-search.js";
import {
  EXAMPLE_COUNT,
  listExamples,
  listOtherReadings,
  listSuggestions,
} from "./search-suggestions.js";
import { normalizeText, splitWords } from "./search-words.js";

/** @typedef {import("./game-search.js").SearchContext} SearchContext */
/** @typedef {import("./game-search.js").SearchGame} SearchGame */
/** @typedef {import("./search-suggestions.js").Suggestion} Suggestion */
/** @typedef {import("./page-search.js").SearchPages} SearchPages */
/** @typedef {import("./page-search.js").PageRow} PageRow */
/** @typedef {import("./page-search.js").GamePart} GamePart */
/**
 * A page's row as the search shows it, a game's part on the game it opens.
 * @typedef {Exclude<PageRow, { kind: "game-part" }> | { kind: "game", part: GamePart, game: SearchGame }} ShownRow
 */
/**
 * How the search stands: its season's context, the pages it can open, whether words are being
 * typed, and whether it shows only the games.
 * @typedef {{ context: SearchContext, pages: SearchPages | null, isTyping: boolean, isGamesOnly: boolean }} SearchState
 */

/**
 * Whether the last word is one the search can't read yet, as a word still being typed is, or is too
 * short to ask for anything yet, as "a" on its way to "Astros" passes over.
 * @param {string} text
 * @param {SearchContext} context
 */
function isLastWordHalfTyped(text, context) {
  const last = text.split(/\s+/).at(-1) ?? "";
  const search = readSearch(text, context);
  const isTooShort = last.length < SHORTEST_PREFIX && isAskingNothing(search);
  return search.skipped.includes(splitWords(last).at(-1) ?? "") || isTooShort;
}

/**
 * The name a half-typed team or place is finished into, as the first suggestion finishes it, even
 * when it writes the name its own way, as "jay" is the Blue Jays, and whether its typed letters run
 * past the last word's start, as "los ange" does into Los Angeles, and whether it finishes them with
 * one letter wrong; or null when the first suggestion doesn't finish one, or too little of its name
 * is typed to name one yet.
 * @param {string} text
 * @param {Suggestion[]} suggestions
 */
function finishName(text, [first]) {
  const typed = normalizeText(first?.finished ?? "");
  const words = normalizeText(text);
  const head = words.slice(0, words.length - typed.length).trim();
  const isNameFinished =
    typed.replace(/\s+/g, "").length >= SHORTEST_PREFIX &&
    words.endsWith(typed) &&
    (first?.mark.kind === "team" || first?.mark.kind === "place") &&
    normalizeText(first.text).startsWith(head);
  if (!isNameFinished) return null;
  return {
    words: first.text,
    typed,
    isAcrossWords: /\s/.test(typed),
    isForgiven: !!first.isForgiven,
  };
}

/**
 * How the line reads words while they're typed: a team's or place's name the first suggestion
 * finishes from letters across words, as "red s" is the Red Sox, even when the last word means
 * something on its own, unless they're a whole name already, as "new york" is; a half-typed team or
 * place as the name the first suggestion finishes it into; and any other half-typed word left out
 * until it's whole, rather than named as one it can't use.
 * @param {string} text
 * @param {Suggestion[]} suggestions
 * @param {SearchContext} context
 * @returns {{ readText: string, name: ReturnType<typeof finishName> }}
 */
function readWhileTyping(text, suggestions, context) {
  const name = finishName(text, suggestions);
  const isNameStarted = !!name?.isAcrossWords && !context.dictionary.has(name.typed);
  if (isNameStarted) return { readText: /** @type {{ words: string }} */ (name).words, name };
  if (!isLastWordHalfTyped(text, context)) return { readText: text, name: null };
  const last = text.split(/\s+/).at(-1) ?? "";
  return { readText: name?.words ?? text.slice(0, text.length - last.length).trim(), name };
}

/**
 * The suggestions for words as they're typed, a word that starts a player's name finishing no other
 * name with one letter wrong.
 * @param {string} query
 * @param {SearchContext} context
 * @param {SearchPages | null} pages
 */
const suggest = (query, context, pages) =>
  listSuggestions(query, context, (word) => !!pages && startsPlayerName(word, pages));

/**
 * Rows of both lists, each once, those of the first first.
 * @param {PageRow[]} first
 * @param {PageRow[]} second
 */
function joinRows(first, second) {
  const shown = new Set(first.map((row) => JSON.stringify(row)));
  return [...first, ...second.filter((row) => !shown.has(JSON.stringify(row)))];
}

/**
 * The pages the words ask for, the words left for the search of games, or null when they ask for
 * no games, and the line an answer says over its rows. A half-typed word finished into a name lists
 * that name's pages, then any other the word starts on its own, like a player's, unless letters
 * before it are part of the name, or those others first when it finishes it with one letter wrong,
 * since the word matches them as typed. Any other half-typed word may start a player's name or a
 * place's, so the words as typed go first, and the words as the line reads them only when those
 * find no page.
 * @param {string} text
 * @param {ReturnType<typeof readWhileTyping>} reading
 * @param {SearchState} state
 * @returns {import("./page-search.js").FoundPages}
 */
function readPages(text, { readText, name }, { context, pages, isTyping }) {
  if (!pages) return { rows: [], gameText: readText };
  const search = { dictionary: context.dictionary, pages, isTyping };
  if (name) {
    const named = findPages(readText, search);
    if (name.isAcrossWords) return named;
    const typed = findPages(text, search).rows;
    const rows = name.isForgiven ? joinRows(typed, named.rows) : joinRows(named.rows, typed);
    return { ...named, rows };
  }
  const typed = findPages(text, search);
  const isTypedEnough = typed.rows.length > 0 || text === readText;
  return isTypedEnough ? typed : findPages(readText, search);
}

/**
 * The rows to show, each game's part on the game it opens of those the words left for it find, and
 * left out when there's none.
 * @param {PageRow[]} rows
 * @param {SearchContext} context
 * @returns {ShownRow[]}
 */
const placeGameParts = (rows, context) =>
  rows.flatMap((row) => {
    if (row.kind !== "game-part") return [/** @type {ShownRow} */ (row)];
    const games =
      row.gameText === null
        ? context.games
        : findSearchGames(readSearch(row.gameText, context), context).games;
    const game = findPartGame(games, row.part);
    return game ? [/** @type {ShownRow} */ ({ kind: "game", part: row.part, game })] : [];
  });

/**
 * The suggestions less a team whose page shows under them, since its page's row stands for it.
 * @param {Suggestion[]} suggestions
 * @param {ShownRow[]} rows
 */
function dropTeamsShown(suggestions, rows) {
  const shown = new Set(rows.flatMap((row) => (row.kind === "team" ? [row.team.code] : [])));
  return suggestions.filter(({ mark }) => mark.kind !== "team" || !shown.has(mark.code));
}

/**
 * The games from today on, or, when none are left, all of them.
 * @param {SearchGame[]} games
 * @param {string} today
 */
function listFromToday(games, today) {
  const ahead = games.filter((game) => game.day >= today);
  return ahead.length ? ahead : games;
}

/**
 * The days a search lists, in the order it shows them: the latest first when they're all past and
 * rows sit over them, so the most recent game is the first under the rows, and otherwise by date.
 * @template {{ day: string }} Day
 * @param {Day[]} days in order of date
 * @param {boolean} isNewestFirst
 * @returns {Day[]}
 */
export const orderListedDays = (days, isNewestFirst) =>
  isNewestFirst ? [...days].reverse() : days;

/**
 * Where a new search places the list, and the day it rests on, which the days drawn whole are
 * around: at its top on its first day when rows sit over the games, on its first day from today,
 * or at its end on its last day when every one is past.
 * @param {{ day: string }[]} days in the order the list shows them
 * @param {string} today
 * @param {boolean} isOverGames
 * @returns {{ at: "top" | "day" | "end", day: string | null }}
 */
export function findListPlace(days, today, isOverGames) {
  if (isOverGames) return { at: "top", day: days[0]?.day ?? null };
  const ahead = days.find(({ day }) => day >= today);
  if (ahead) return { at: "day", day: ahead.day };
  return { at: "end", day: days.at(-1)?.day ?? null };
}

/**
 * The examples to offer before anything is typed: the league's searches of games that find a
 * game, then its pages' that find a page, as many as there's room for.
 * @param {SearchContext} context
 * @param {SearchPages | null} pages
 */
export function listShownExamples(context, pages) {
  const pageExamples = (pages?.examples ?? []).filter(
    (example) =>
      findPages(example, { dictionary: context.dictionary, pages, isTyping: false }).rows.length,
  );
  return [...listExamples(context, EXAMPLE_COUNT - pageExamples.length), ...pageExamples];
}

/**
 * What the search shows for words in the field: while they're typed, suggestions over the pages
 * they name, or under them when the words name them as typed, other readings, and a line over the
 * games they find from today on, or, when none are left, every one, the latest first; otherwise,
 * or once nothing sits over them, every game they find.
 * @param {string} query the words as typed
 * @param {SearchState} state
 */
export function readTypedSearch(query, state) {
  const { context, isTyping, isGamesOnly } = state;
  const text = query.trim();
  const typed = isTyping ? suggest(query, context, state.pages) : [];
  const reading = isTyping ? readWhileTyping(text, typed, context) : { readText: text, name: null };
  const { readText } = reading;
  const { rows: pageRows, gameText, read: answer, isFirst } = readPages(text, reading, state);
  const rows = placeGameParts(pageRows, context);
  const suggestions = dropTeamsShown(typed, rows);
  const others = gameText && !isGamesOnly ? listOtherReadings(gameText, context) : [];
  const search = gameText ? readSearch(gameText, context) : null;
  const found = search && findSearchGames(search, context);
  const read = search && found && describeSearch(search, found, context);
  const isOverGames =
    !isGamesOnly && (suggestions.length > 0 || rows.length > 0 || others.length > 0);
  const overGames = read && found ? listFromToday(found.games, context.today) : [];
  const games = isOverGames ? overGames : (found?.games ?? []);
  const isNewestFirst = isOverGames && games.length > 0 && games.at(-1).day < context.today;
  return {
    suggestions,
    readText,
    rows,
    isRowsFirst: !!isFirst,
    answer,
    others,
    search,
    read,
    isOverGames,
    games,
    isNewestFirst,
  };
}

/**
 * The words the Search key sends: a half-typed last word finished when it starts a team or a place,
 * as the line read it while typing, unless it finishes it with one letter wrong and the words as
 * typed find a page, as "mation" does Phil Maton's, and otherwise the words as typed.
 * @param {string} query
 * @param {SearchContext} context
 * @param {SearchPages | null} pages
 */
export function readSentWords(query, context, pages) {
  const text = query.trim();
  const { name } = readWhileTyping(text, suggest(query, context, pages), context);
  const isTypedFound =
    !!pages &&
    findPages(text, { dictionary: context.dictionary, pages, isTyping: false }).rows.length > 0;
  return name && !(name.isForgiven && isTypedFound) ? name.words : query;
}
