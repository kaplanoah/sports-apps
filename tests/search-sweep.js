import { readSearch } from "#shared/game-search.js";
import { readTypedSearch } from "#shared/search-reading.js";
import { splitWords } from "#shared/search-words.js";

// Types what fans search for, the way they type it on a phone: in lowercase, a key at a time, each
// name of a team and a place, by its city, its nickname, or its venue, a team's name after its
// city's short name, as "la dodgers", alone and inside the searches fans make of it, like
// "yankees at red sox" or "games in boston". At each key it lists where what search shows breaks a
// rule a fan counts on:
// - fewer than three letters of a name find no games, unless they're a whole word search knows;
// - a team's suggestion, read whole, names that team alone;
// - letters the line reads as the whole search find what the whole search does;
// - letters past the first word of a name start no player's;
// - a team's name after any name of its city finds what the team's name does.

const SHORTEST_GUESS = 3;

/** @typedef {import("#shared/game-search.js").SearchContext} SearchContext */
/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/search-suggestions.js").Suggestion} Suggestion */
/** @typedef {ReturnType<typeof readTypedSearch>} Shown */
/**
 * A search a fan makes, the words they type before a name whole, the name typed a key at a time,
 * and a search that finds the same, when there's one.
 * @typedef {{ head: string, name: string, sameAs?: string }} Phrasing
 */

/** @param {string} text */
const readWords = (text) => splitWords(text).join(" ");

/**
 * What a search says it found, as the line over its games does.
 * @param {Shown} shown
 */
const describeFound = ({ read }) => (read ? [read.lead, ...read.facts].join(" | ") : "nothing");

/**
 * A team's name after each name of the place it plays in, as "la dodgers" or "ny mets", each to
 * find what the team's own name does.
 * @param {SearchContext} context
 * @returns {Phrasing[]}
 */
const listPlacedTeams = ({ terms }) =>
  terms.teams.flatMap((team) =>
    terms.places
      .filter((place) => !place.isArena && place.cities.includes(team.homeCity))
      .flatMap((place) => place.words)
      .map((word) => ({ head: "", name: `${word} ${team.name}`.toLowerCase(), sameAs: team.name })),
  );

/**
 * The searches fans make of a league's teams and places: each name alone, a team's after its
 * city's, a team's after another team's "at", and a place's after "games in".
 * @param {SearchContext} context
 * @param {string} rival a team's name to search a game against, as "yankees" for "yankees at"
 * @returns {Phrasing[]}
 */
export function listPhrasings(context, rival) {
  const teamNames = context.terms.teams.flatMap((team) => [team.name, ...team.words]);
  const placeNames = context.terms.places.map((place) => place.name);
  const names = [...new Set([...teamNames, ...placeNames].map((name) => name.toLowerCase()))];
  const fullNames = context.terms.teams.map((team) => team.words.find((word) => /\s/.test(word)));
  return [
    ...names.map((name) => ({ head: "", name })),
    ...listPlacedTeams(context),
    ...fullNames.flatMap((name) => (name ? [{ head: `${rival} at `, name }] : [])),
    ...placeNames.map((name) => ({ head: "games in ", name: name.toLowerCase() })),
  ];
}

/**
 * The teams a suggestion's finished words name, read whole.
 * @param {Suggestion} suggestion
 * @param {string} typed
 * @param {SearchContext} context
 */
function readFinishedTeams(suggestion, typed, context) {
  const head = typed.slice(0, typed.length - (suggestion.finished ?? "").length);
  const written = suggestion.text.slice(head.length);
  return readSearch(written, context).teams.flatMap((team) => team.codes);
}

/**
 * What breaks a rule as the first letters of a phrasing's name are typed after its head.
 * @param {Shown} shown what search shows for `head` and `typedName`
 * @param {Phrasing & { typedName: string, whole: Shown }} step
 * @param {SearchContext} context
 */
function listBrokenRules(shown, { head, name, typedName, whole }, context) {
  const typed = `${head}${typedName}`;
  const letters = typedName.replace(/\s+/g, "").length;
  const isKnownWord = context.dictionary.has(readWords(typedName));
  const broken = [];
  if (letters < SHORTEST_GUESS && !isKnownWord && !head && shown.games.length)
    broken.push("finds games from fewer than three letters");
  for (const suggestion of shown.suggestions) {
    if (suggestion.mark.kind !== "team" || !suggestion.finished) continue;
    const teams = readFinishedTeams(suggestion, typed, context);
    if (teams.length !== 1 || teams[0] !== suggestion.mark.code)
      broken.push(`suggests ${suggestion.text} for ${suggestion.mark.code}, which names ${teams}`);
  }
  const isReadWhole = typedName !== name && readWords(shown.readText) === readWords(head + name);
  if (isReadWhole && describeFound(shown) !== describeFound(whole))
    broken.push(
      `finds ${describeFound(shown)}, but the whole search finds ${describeFound(whole)}`,
    );
  const isPastFirstWord = /\s\S/.test(typedName);
  if (isPastFirstWord && shown.rows.some((row) => row.kind === "player"))
    broken.push("lists a player");
  return broken;
}

/**
 * Each broken rule as each phrasing's name is typed a key at a time, as "typed (of search): rule".
 * @param {Phrasing[]} phrasings
 * @param {{ context: SearchContext, pages: SearchPages }} search
 */
export function sweepPhrasings(phrasings, { context, pages }) {
  /** @type {Map<string, Shown>} */
  const shownByText = new Map();
  /**
   * @param {string} text
   * @param {boolean} isTyping
   */
  const show = (text, isTyping) => {
    const key = `${isTyping}:${text}`;
    if (!shownByText.has(key))
      shownByText.set(key, readTypedSearch(text, { context, pages, isTyping, isGamesOnly: false }));
    return /** @type {Shown} */ (shownByText.get(key));
  };
  return phrasings.flatMap(({ head, name, sameAs }) => {
    const whole = show(`${head}${name}`, false);
    const same = sameAs ? describeFound(show(sameAs, false)) : describeFound(whole);
    const isSame = describeFound(whole) === same;
    return [
      ...(isSame ? [] : [`${head}${name}: finds ${describeFound(whole)}, but ${sameAs} ${same}`]),
      ...Array.from({ length: name.length }, (_, index) => name.slice(0, index + 1))
        .filter((typedName) => !/\s$/.test(typedName))
        .flatMap((typedName) =>
          listBrokenRules(
            show(`${head}${typedName}`, true),
            { head, name, typedName, whole },
            context,
          ).map((rule) => `${head}${typedName} (of ${head}${name}): ${rule}`),
        ),
    ];
  });
}
