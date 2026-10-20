import { findSearchGames, readSearch } from "#shared/game-search.js";
import { readTypedSearch } from "#shared/search-reading.js";
import { FORGIVING_LENGTH, isOneEditApart, normalizeText } from "#shared/search-words.js";

// Types what fans search for, the way they type it on a phone: in lowercase, a key at a time, each
// name of a team and a place, by its city, its nickname, or its venue, a team's name after its
// city's short name, as "la dodgers", alone and inside the searches fans make of it, like
// "yankees at red sox" or "games in boston". At each key it lists where what search shows breaks a
// rule a fan counts on:
// - fewer than three letters of a name find no games, unless they're a whole word search knows;
// - a suggestion writes a team or a place only by a name of its own, never a nickname;
// - a team's suggestion, read whole, names that team alone;
// - letters the line reads as the whole search find what the whole search does;
// - letters past the first word of a name start no player's;
// - a space between a name's words still shows what its letters found;
// - a team's name after any name of its city finds what the team's name does.
// It also types each name of one word long enough to forgive a wrong letter with one letter wrong,
// each way a thumb gets one wrong, and lists where it finds another name's games: a wrong letter
// finds the name's, or, when it's as near another name, nothing.
// And it types each team's name beside each number its players wear, each way fans write it, and
// lists where it doesn't list just the team's players who wear it, or, while the number is last,
// each number it starts, over suggestions that each keep the number.
// And it types each player's first, last, and whole name, and lists where a key from its third
// letter on doesn't list the player.

const SHORTEST_GUESS = 3;
// A phone's keyboard, a row at a time, for the key a thumb lands on beside the one it meant.
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** @typedef {import("#shared/game-search.js").SearchContext} SearchContext */
/** @typedef {import("#shared/page-search.js").SearchPages} SearchPages */
/** @typedef {import("#shared/search-suggestions.js").Suggestion} Suggestion */
/** @typedef {ReturnType<typeof readTypedSearch>} Shown */
/**
 * A search a fan makes, the words they type before a name whole, the name typed a key at a time,
 * and a search that finds the same, when there's one.
 * @typedef {{ head: string, name: string, sameAs?: string }} Phrasing
 */

/**
 * What a search says it found, as the line over its games does.
 * @param {Shown} shown
 */
const describeFound = ({ read }) => (read ? [read.lead, ...read.facts].join(" | ") : "nothing");

/**
 * A team's name after its city's, as fans write it, like "la dodgers", each to find what the
 * team's own name does.
 * @param {SearchContext} context
 * @returns {Phrasing[]}
 */
const listPlacedTeams = ({ terms }) =>
  terms.teams.flatMap((team) =>
    (team.shownNames ?? [])
      .filter((name) => name !== team.name)
      .map((name) => ({
        head: "",
        name: name.toLowerCase(),
        sameAs: team.name,
      })),
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
 * The key beside a letter on a phone's keyboard, or null for a character on no row.
 * @param {string} letter
 */
function findKeyBeside(letter) {
  const row = KEY_ROWS.find((keys) => keys.includes(letter));
  if (!row) return null;
  const at = row.indexOf(letter);
  return row[at + 1] ?? row[at - 1];
}

/**
 * A name with its letter at `at` wrong each way a thumb gets one wrong: the key beside it, the next
 * letter first, the letter left out, or the letter twice, leaving out a slip that only shortens it
 * to its start.
 * @param {string} name
 * @param {number} at
 * @returns {string[]}
 */
function listMisspellings(name, at) {
  const [before, letter, next, after] = [
    name.slice(0, at),
    name[at],
    name[at + 1] ?? "",
    name.slice(at + 2),
  ];
  const beside = findKeyBeside(letter);
  return [
    beside ? `${before}${beside}${next}${after}` : "",
    next && next !== letter ? `${before}${next}${letter}${after}` : "",
    next ? `${before}${next}${after}` : "",
    `${before}${letter}${letter}${next}${after}`,
  ].filter(Boolean);
}

/**
 * Each name of one word long enough to forgive a wrong letter, a team's or a place's.
 * @param {SearchContext} context
 */
function listForgivingNames({ terms }) {
  const teamNames = terms.teams.flatMap((team) => [team.name, ...team.words]);
  const placeNames = terms.places.map((place) => place.name);
  const names = [...teamNames, ...placeNames].map((name) => name.toLowerCase());
  return [...new Set(names)].filter(
    (name) => /^[a-z]+$/.test(name) && name.length >= FORGIVING_LENGTH,
  );
}

/**
 * The keys of a misspelled name that show whether its wrong letter is forgiven: the first that
 * types it once enough letters are typed to forgive one, and the last.
 * @param {string} misspelled
 * @param {number} at
 */
function listWrongKeys(misspelled, at) {
  const first = misspelled.slice(0, Math.max(at + 1, FORGIVING_LENGTH));
  return [...new Set([first, misspelled])];
}

/**
 * Each key, as "typed (of misspelled, meaning name): what it finds", where a name with a letter
 * wrong, as it's typed, finds a game the name's own letters find at no key, unless its letters start
 * another name as typed, as "arlin" of "marlins" starts Arlington's, or are another whole name with
 * one letter wrong, as "anger" of "rangers" is "angel".
 * @param {{ context: SearchContext, pages: SearchPages }} search
 */
export function sweepMisspellings({ context, pages }) {
  const phrases = [...context.dictionary.keys()];
  /** @type {Map<string, Shown>} */
  const shownByText = new Map();
  /**
   * @param {string} text
   * @param {boolean} [isTyping]
   */
  const show = (text, isTyping = true) => {
    const key = `${isTyping}:${text}`;
    if (!shownByText.has(key))
      shownByText.set(key, readTypedSearch(text, { context, pages, isTyping, isGamesOnly: false }));
    return /** @type {Shown} */ (shownByText.get(key));
  };
  /**
   * @param {string} typed
   * @param {string} name
   */
  const isOtherName = (typed, name) =>
    phrases.some(
      (phrase) =>
        phrase.startsWith(typed) || (!name.startsWith(phrase) && isOneEditApart(typed, phrase)),
    );
  /** @param {Shown} shown */
  const listFound = ({ search }) => (search ? findSearchGames(search, context).games : []);
  /** @param {string} name */
  const listNameGames = (name) => {
    const keys = Array.from({ length: name.length - SHORTEST_GUESS + 1 }, (_, index) =>
      show(name.slice(0, SHORTEST_GUESS + index)),
    );
    const found = [...keys, show(name, false)].flatMap(listFound);
    return new Set(found.map((game) => game.id));
  };
  return listForgivingNames(context).flatMap((name) => {
    const nameGames = listNameGames(name);
    return [...name].flatMap((_, at) =>
      listMisspellings(name, at).flatMap((misspelled) =>
        listWrongKeys(misspelled, at)
          .filter((typed) => !isOtherName(typed, name))
          .flatMap((typed) => {
            const shown = show(typed);
            const isOthers = shown.games.some((game) => !nameGames.has(game.id));
            return isOthers
              ? [`${typed} (of ${misspelled}, meaning ${name}): finds ${describeFound(shown)}`]
              : [];
          }),
      ),
    );
  });
}

/**
 * The ways fans write a team's name beside a player's number, each with the name it's written with:
 * each way with its own name, and its other names, like its full name or its code, just beside the
 * number.
 * @param {string[]} names the team's own name first
 * @param {string} number
 */
const listNumberPhrasings = ([name, ...others], number) => [
  ...[
    `${name} ${number}`,
    `${name} #${number}`,
    `${number} ${name}`,
    `${name} No. ${number}`,
    `${name} number ${number}`,
  ].map((text) => ({ name, text })),
  ...others.map((other) => ({ name: other, text: `${other} ${number}` })),
];

/**
 * A team's names that name it alone, its own first, as "Dodgers" does, but not "Los Angeles".
 * @param {import("#shared/game-search.js").SearchTeam} team
 * @param {SearchContext} context
 */
function listOwnNames(team, { dictionary }) {
  const isOwn = (/** @type {string} */ name) => {
    const meanings = (dictionary.get(normalizeText(name)) ?? []).filter(
      (meaning) => meaning.kind === "team",
    );
    return meanings.length > 0 && meanings.every((meaning) => meaning.value === team.code);
  };
  const names = [team.name, ...team.words, ...(team.shownNames ?? [])].map((name) =>
    name.toLowerCase(),
  );
  return [...new Set(names)].filter(isOwn);
}

/**
 * The ids of the players who wear a number or, while it's being typed, a number it starts, the
 * number itself first, then by number.
 * @param {import("#shared/page-search.js").PagePlayer[]} players
 * @param {string} number
 * @param {boolean} isStart
 */
const listWearing = (players, number, isStart) =>
  players
    .filter((player) => player.number === number || (isStart && player.number.startsWith(number)))
    .toSorted(
      (first, second) =>
        first.number.length - second.number.length || Number(first.number) - Number(second.number),
    )
    .map((player) => player.id);

/**
 * What breaks a rule in what a search of a team's name beside a number shows: it lists just the
 * team's players who wear the number, or, as it's typed with the number last, every number it
 * starts, over its suggestions, which each keep the number, and finds the games the name alone does.
 * @param {Shown} shown
 * @param {{ text: string, expected: string[], nameGames: string | undefined }} search
 */
function listBrokenNumberRules(shown, { text, expected, nameGames }) {
  const listed = shown.rows.map((row) => (row.kind === "player" ? row.player.id : row.kind));
  const found = describeFound(shown);
  const number = text.match(/\d+/)?.[0] ?? "";
  const ignoring = shown.suggestions.filter((suggestion) => !suggestion.text.includes(number));
  return [
    ...(listed.join() === expected.join()
      ? []
      : [`${text}: lists ${listed.join(", ")}, not ${expected.join(", ")}`]),
    ...(shown.isRowsFirst ? [] : [`${text}: lists its players under its suggestions`]),
    ...ignoring.map((suggestion) => `${text}: suggests ${suggestion.text}, without its number`),
    ...(found === nameGames ? [] : [`${text}: finds ${found}, not ${nameGames}`]),
  ];
}

/**
 * Each search of a team's name beside each number its players wear, as it's typed, and the plain
 * one as it's sent, as "search: what's wrong", where it breaks a rule `listBrokenNumberRules` names.
 * @param {{ context: SearchContext, pages: SearchPages }} search
 */
export function sweepPlayerNumbers({ context, pages }) {
  /**
   * @param {string} text
   * @param {boolean} isTyping
   */
  const show = (text, isTyping) =>
    readTypedSearch(text, { context, pages, isTyping, isGamesOnly: false });
  return context.terms.teams.flatMap((team) => {
    const players = pages.players.filter((player) => player.team === team.code && player.number);
    const names = listOwnNames(team, context);
    const nameGames = new Map(names.map((name) => [name, describeFound(show(name, false))]));
    return [...new Set(players.map((player) => player.number))].flatMap((number) => {
      const typed = listNumberPhrasings(names, number).flatMap(({ name, text }) =>
        listBrokenNumberRules(show(text, true), {
          text,
          expected: listWearing(players, number, text.endsWith(number)),
          nameGames: nameGames.get(name),
        }),
      );
      const sentText = `${names[0]} ${number}`;
      const sent = listBrokenNumberRules(show(sentText, false), {
        text: `${sentText} sent`,
        expected: listWearing(players, number, false),
        nameGames: nameGames.get(names[0]),
      });
      return [...typed, ...sent];
    });
  });
}

/**
 * Each player's first name, last name, and whole name, typed a key at a time, as "typed (of name)"
 * where it doesn't list her from its third letter on.
 * @param {{ context: SearchContext, pages: SearchPages }} search
 */
export function sweepPlayerNames({ context, pages }) {
  /** @type {Map<string, Set<string>>} */
  const listedByText = new Map();
  /** @param {string} text */
  const listListed = (text) => {
    if (!listedByText.has(text)) {
      const { rows } = readTypedSearch(text, {
        context,
        pages,
        isTyping: true,
        isGamesOnly: false,
      });
      const ids = rows.flatMap((row) => (row.kind === "player" ? [row.player.id] : []));
      listedByText.set(text, new Set(ids));
    }
    return /** @type {Set<string>} */ (listedByText.get(text));
  };
  return pages.players.flatMap((player) => {
    const names = [player.firstName, player.lastName, `${player.firstName} ${player.lastName}`];
    return [...new Set(names.map(normalizeText))].flatMap((name) =>
      Array.from({ length: name.length }, (_, index) => name.slice(0, index + 1))
        .filter((typed) => typed.replace(/\s+/g, "").length >= SHORTEST_GUESS)
        .filter((typed) => !listListed(typed).has(player.id))
        .map((typed) => `${typed} (of ${name})`),
    );
  });
}

/**
 * The words a suggestion finished, as it writes them.
 * @param {Suggestion} suggestion
 * @param {string} typed
 */
const writeFinishedName = (suggestion, typed) =>
  suggestion.text.slice(typed.length - (suggestion.finished ?? "").length);

/**
 * The names a suggestion may write for what it marks: a team's own and the ones it shows, like
 * "LA Dodgers", or a place's own; or null for anything else, which it writes as it's typed.
 * @param {Suggestion["mark"]} mark
 * @param {SearchContext} context
 * @returns {string[] | null}
 */
function listShownNames(mark, context) {
  if (mark.kind === "team") {
    const team = context.teamsByCode.get(mark.code);
    return team ? [team.name, ...(team.shownNames ?? [])] : [];
  }
  return mark.kind === "place" ? context.terms.places.map((place) => place.name) : null;
}

/**
 * The teams a suggestion's finished words name, read whole.
 * @param {Suggestion} suggestion
 * @param {string} typed
 * @param {SearchContext} context
 */
function readFinishedTeams(suggestion, typed, context) {
  return readSearch(writeFinishedName(suggestion, typed), context).teams.flatMap(
    (team) => team.codes,
  );
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
  const isKnownWord = context.dictionary.has(normalizeText(typedName));
  const broken = [];
  if (letters < SHORTEST_GUESS && !isKnownWord && !head && shown.games.length)
    broken.push("finds games from fewer than three letters");
  for (const suggestion of shown.suggestions) {
    if (!suggestion.finished) continue;
    const written = writeFinishedName(suggestion, typed);
    const names = listShownNames(suggestion.mark, context);
    if (names && !names.includes(written))
      broken.push(`writes ${written}, which isn't a name search shows`);
    if (suggestion.mark.kind !== "team") continue;
    const teams = readFinishedTeams(suggestion, typed, context);
    if (teams.length !== 1 || teams[0] !== suggestion.mark.code)
      broken.push(`suggests ${suggestion.text} for ${suggestion.mark.code}, which names ${teams}`);
  }
  const isReadWhole =
    typedName !== name && normalizeText(shown.readText) === normalizeText(head + name);
  if (isReadWhole && describeFound(shown) !== describeFound(whole))
    broken.push(
      `finds ${describeFound(shown)}, but the whole search finds ${describeFound(whole)}`,
    );
  const isBetweenWords = /\s$/.test(typedName);
  const isShowingNothing = !shown.suggestions.length && !shown.rows.length && !shown.games.length;
  if (isBetweenWords && isShowingNothing && whole.games.length)
    broken.push("shows nothing between its words");
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
      ...Array.from({ length: name.length }, (_, index) => name.slice(0, index + 1)).flatMap(
        (typedName) =>
          listBrokenRules(
            show(`${head}${typedName}`, true),
            { head, name, typedName, whole },
            context,
          ).map((rule) => `${head}${typedName} (of ${head}${name}): ${rule}`),
      ),
    ];
  });
}
