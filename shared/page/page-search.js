// Reading a search's words into the pages they ask for, beside the games they find: a team's sheet
// and its section, like a WNBA team's Roster, a player's sheet, and the league's places, like the
// Standings lists and settings, and a game's parts, like a final's Highlights or MLB's Matchup. A
// team's name lists its sheet and its section, as it does beside "record", and the section's name
// beside it lists the section alone. A game part's name lists the part of the game the rest of the
// words find, or the season's: the latest final for a final's part, or the next game for one before
// it. A player's name lists her sheet, even with one letter wrong in a name of five letters or
// more, and finds no games, since nobody knows yet which games she'll play, unless a search of games
// knows the name, as MLB's knows a starter's, finding his starts. A team's name beside a number
// some player of its wears, as "Valkyries 2" or "Valkyries #2", lists the sheet of each who wears
// it, over the team's games, since a fan asking for an hour writes it as one, as "2pm", "2 pm", or
// "at 2" are. Words like "out" or "injured" list who is out, alone, on a team beside its name, or
// the player they name, saying whether she is. A team's name beside the News tab's words lists the
// tab and the newest stories about the team. A place's words list it, and leave the games to any of
// them that a search of games reads, as "East" finds the East's standings and its games. Words that
// ask for anything else, like a second team, a day, or "at", ask for games, and list no page. While
// a search is typed, though, any word may also start a word of a player's name, even one a search
// of games knows, as a phone's search reads it, and the players it starts list after the rows the
// words find on their own, as "may" lists Maya Caldwell over May's games. A league hands it its
// teams, players, and places, and the search's dictionary, so a team is named here by the same
// words it is in a search of games. Runs in the page and in Node, so it uses no DOM.

import { describeCount } from "./game-search.js";
import { hasKind, isForgivenTypo, readTokens, splitWords } from "./search-words.js";

/** @typedef {{ code: string, name: string, fullName: string, record?: string }} PageTeam */
/**
 * Why a player is out, while she is: what the injury report says, and whether for the season.
 * @typedef {{ reason: string | null, isForSeason: boolean }} PlayerOut
 */
/** @typedef {{ id: string, team: string, firstName: string, lastName: string, number: string | null, out?: PlayerOut | null }} PagePlayer */
/**
 * A place in the app a search can open, the words of its row, the words that find it, and the
 * icon of the button it's otherwise opened from.
 * @typedef {{ key: string, name: string[], words: string[], icon: "bracket" | "standings" | "news" | "settings" }} PagePlace
 */
/**
 * A part of a game's sheet a search can open, by its key and name, the words that find it, and
 * which game it opens: the latest final, or the next game, the one under way or the first to come.
 * @typedef {{ key: string, name: string, words: string[], game: "latest-final" | "next" }} GamePart
 */
/**
 * What a league hands a search's pages: its teams and players, the section a team's sheet opens on
 * beside its first, by its key and name, its places, the parts of a game's sheet it can open, and
 * pages to offer as examples.
 * @typedef {object} SearchPages
 * @property {PageTeam[]} teams
 * @property {PagePlayer[]} players
 * @property {{ key: string, name: string } | null} section
 * @property {PagePlace[]} places
 * @property {GamePart[]} gameParts
 * @property {string[]} examples
 * @property {boolean} isOutKnown whether its players say who is out, or the words that ask find
 *   their pages without saying
 * @property {{ place: PagePlace, stories: import("./news-picks.js").NewsStory[] }} [news] the News
 *   tab, and the stories it shows, newest first, so a team's news lists the newest about it
 */
/**
 * A page a search lists: a team's sheet or its section, a player's sheet, a place, or a game's
 * part, of the game the words left for a search of games find, or of the season's when none are
 * left. A player's row asked who is out says why she is: in a list of who's out, just why, and for
 * a player named, that she's out and why. A place's row can say whose it's asked for, as a team's
 * news names the team, and a story's row opens the story.
 * @typedef {{ kind: "team" | "section", team: PageTeam } | { kind: "player", team: PageTeam, player: PagePlayer, out?: "listed" | "named" } | { kind: "place", place: PagePlace, detail?: string } | { kind: "story", story: import("./news-picks.js").NewsStory } | { kind: "game-part", part: GamePart, gameText: string | null }} PageRow
 */
/**
 * What a search's words find: the pages they list, the words left for a search of games, or null
 * when they ask for none, and, for an answer like who is out, the line that says over its rows what
 * they are, as the games line does: its lead, then its facts, and whether its rows show over the
 * suggestions, as the players a team's number names do, since the words name them as typed.
 * @typedef {{ rows: PageRow[], gameText: string | null, read?: { lead: string, facts: string[] }, isFirst?: boolean }} FoundPages
 */

/**
 * Where the store keeps the list of a season's players a search finds.
 * @param {number} season
 */
export const namePlayerIndexKey = (season) => `player-index/${season}`;

/**
 * @param {PagePlayer} first
 * @param {PagePlayer} second
 */
const compareNames = (first, second) =>
  first.lastName.localeCompare(second.lastName) ||
  first.firstName.localeCompare(second.firstName) ||
  first.id.localeCompare(second.id);

/**
 * A season's list of players as the store keeps it, by name.
 * @param {number} season
 * @param {PagePlayer[]} players
 */
export const describePlayerIndex = (season, players) => ({
  season,
  players: players.toSorted(compareNames),
});

/**
 * The list of a season's players the store keeps beside its rosters, or null for one the page
 * can't read.
 * @param {any} index
 */
export const readPlayerIndex = (index) => (Array.isArray(index?.players) ? index : null);

// A word this short only finds a team, a name, or a place once it's whole, or it would find too
// many.
export const SHORTEST_PREFIX = 3;
// The words beside a team's name that ask for its sheet, which leads with its record.
const RECORD_WORDS = ["record", "standing"];
// How many of a team's newest stories its news lists, under the News tab's row.
const TEAM_STORIES = 3;

/**
 * Whether a typed word names a word: as written, as a plural's single unless plurals aren't read,
 * or as its start once it's `shortestStart` letters long.
 * @param {string} typed
 * @param {string} word
 * @param {{ shortestStart: number, isPluralRead?: boolean }} reading
 */
const isWordOf = (typed, word, { shortestStart, isPluralRead = true }) =>
  typed === word ||
  (isPluralRead && typed.endsWith("s") && typed.slice(0, -1) === word) ||
  (typed.length >= shortestStart && word.startsWith(typed));

// How a word that may be only the start of one names it, from its third letter.
const AS_START = { shortestStart: SHORTEST_PREFIX };

// Words after a last name that a fan may leave off.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Each player's names, read once, since a search reads every player's on every key.
/** @type {WeakMap<PagePlayer, string[][]>} */
const playerNames = new WeakMap();

/**
 * The words a player can be named by: each run of her name's words, from her whole name to each
 * word alone, as a phone's search finds "Lou" in Katie Lou Samuelson and "Ododa" in Nelson-Ododa,
 * with or without a suffix after her last name, like "Jr.".
 * @param {PagePlayer} player
 */
function listPlayerNames(player) {
  const kept = playerNames.get(player);
  if (kept) return kept;
  const names = readPlayerNames(player);
  playerNames.set(player, names);
  return names;
}

/**
 * Each run of a player's words, but for a word alone that is the suffix after her last name, or
 * too short to start a name, as "De" in De La Cruz is, unless it's her whole first or last name, as
 * "Jo" is.
 * @param {PagePlayer} player
 */
function readPlayerNames(player) {
  const first = splitWords(player.firstName);
  const last = splitWords(player.lastName);
  const hasSuffix = last.length > 1 && NAME_SUFFIXES.has(last[last.length - 1]);
  const words = [...first, ...last];
  const wholes = [first, hasSuffix ? last.slice(0, -1) : last].map((each) => each.join(" "));
  const isNamingAlone = (/** @type {number} */ at) =>
    !(hasSuffix && at === words.length - 1) &&
    (words[at].length >= SHORTEST_PREFIX || wholes.includes(words[at]));
  return words.flatMap((_, start) =>
    Array.from({ length: words.length - start }, (_, index) =>
      words.slice(start, start + index + 1),
    ).filter((run) => run.length > 1 || isNamingAlone(start)),
  );
}

/**
 * Whether a word starts one of a player's names as typed, as "castr" does Castro's, so it isn't read
 * as another name with one letter wrong.
 * @param {string} word
 * @param {SearchPages} pages
 */
export const startsPlayerName = (word, pages) =>
  pages.players.some((player) =>
    listPlayerNames(player).some((name) => name.some((part) => part.startsWith(word))),
  );

/**
 * A word of a search, whether a search of games knows it, as it knows "east" or "NL", and whether
 * it passes over it, as it does "the" or "will".
 * @typedef {{ word: string, isKnown: boolean, isPassedOver: boolean }} ReadWord
 */

/**
 * A search's words, each as `ReadWord` reads it.
 * @param {import("./search-words.js").Token[]} tokens
 * @returns {ReadWord[]}
 */
const readWords = (tokens) =>
  tokens.flatMap((token) =>
    token.words.map((word) => ({
      word,
      isKnown: token.meanings.length > 0,
      isPassedOver: hasKind(token, "filler"),
    })),
  );

/**
 * How a typed word names a word of a name: as written, as its start when it may be only that, or,
 * when a search of games doesn't know it, as a plural's single or with one wrong letter, so
 * "Angels" names the club rather than each Angel; or not at all.
 * @param {ReadWord} typed
 * @param {string} part
 * @param {boolean} isPartial
 * @returns {"exact" | "begun" | "typo" | null}
 */
function matchNamePart({ word, isKnown }, part, isPartial) {
  if (isWordOf(word, part, { shortestStart: Infinity, isPluralRead: !isKnown })) return "exact";
  if (isPartial && part.startsWith(word)) return "begun";
  return !isKnown && isForgivenTypo(word, part) ? "typo" : null;
}

/**
 * Whether words can be a name's as they match its words: one only begun once three of its letters
 * are typed, as "mara s" starts Mara Stone's but "a f" no Jose A. Ferrer's, and one of only words a
 * search of games passes over, as "will" is Will Smith's, only while every word is such a one and
 * still being typed, so "when will trout return" finds Trout alone.
 * @param {ReadWord[]} typed the words that match the name's
 * @param {("exact" | "begun" | "typo")[]} matches
 * @param {{ words: ReadWord[], isTyping: boolean }} search
 */
function isNaming(typed, matches, { words, isTyping }) {
  const letters = typed.reduce((count, each) => count + each.word.length, 0);
  const isBegunEnough = matches.at(-1) !== "begun" || letters >= SHORTEST_PREFIX;
  const isPassedOverOnly = typed.every((each) => each.isPassedOver);
  const isAllPassedOver = isTyping && words.every((each) => each.isPassedOver);
  return isBegunEnough && (!isPassedOverOnly || isAllPassedOver);
}

/**
 * How words name a player: by how many of them, whether any has a wrong letter, and whether the
 * last is a word a search of games knows read only as the start of one of her name's.
 * @typedef {{ length: number, hasTypo: boolean, isKnownBegun: boolean }} NameMatch
 */

/**
 * How the words from `start` name the player, by the most words of her name, and then without a
 * wrong letter, or null. While words are typed, the last may be the start of a word of her name,
 * even one a search of games knows whole, as "may" starts Maya's and "will" Williams, as a phone's
 * search lists every name a word starts, as `isNaming` allows.
 * @param {ReadWord[]} words
 * @param {number} start
 * @param {PagePlayer} player
 * @param {boolean} isTyping
 * @returns {NameMatch | null}
 */
function measurePlayerAt(words, start, player, isTyping) {
  /** @type {NameMatch | null} */
  let best = null;
  for (const name of listPlayerNames(player)) {
    if (start + name.length > words.length) continue;
    const typed = words.slice(start, start + name.length);
    const isEndTyped = isTyping && start + name.length === words.length;
    const matches = name.map((part, offset) =>
      matchNamePart(typed[offset], part, isEndTyped && offset === name.length - 1),
    );
    if (matches.includes(null)) continue;
    const named = /** @type {("exact" | "begun" | "typo")[]} */ (matches);
    if (!isNaming(typed, named, { words, isTyping })) continue;
    const isKnownBegun = named.at(-1) === "begun" && typed[typed.length - 1].isKnown;
    const match = { length: name.length, hasTypo: named.includes("typo"), isKnownBegun };
    if (!best || compareMatches(match, best) < 0) best = match;
  }
  return best;
}

/**
 * Orders matches by the most words, then those without a wrong letter.
 * @param {NameMatch} first
 * @param {NameMatch} second
 */
const compareMatches = (first, second) =>
  second.length - first.length || Number(first.hasTypo) - Number(second.hasTypo);

/**
 * Whether only words a search of games passes over, like "the", sit beside a name's, or, but for a
 * name whose last word is a known one only begun, also words it doesn't know, like "stats", so
 * "great american bal" starts no Balcazar's.
 * @param {ReadWord[]} words
 * @param {number} start
 * @param {NameMatch} match
 */
const isRestFree = (words, start, match) =>
  words.every(
    (each, index) =>
      (index >= start && index < start + match.length) ||
      each.isPassedOver ||
      (!each.isKnown && !match.isKnownBegun),
  );

/**
 * The players the words name, keeping only those named by the most words, so a whole name finds
 * her alone rather than everyone who shares her first name, and, of those, the ones named without
 * a wrong letter, so a name a letter off another's finds only its own. Words a search of games
 * knows beside a name ask for something else, as "NL East" does, so they name no player.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {PagePlayer[]} players
 * @param {boolean} isTyping
 */
function findPlayers(tokens, players, isTyping) {
  const words = readWords(tokens);
  const found = players.flatMap((player) => {
    for (let start = 0; start < words.length; start += 1) {
      const match = measurePlayerAt(words, start, player, isTyping);
      if (match && isRestFree(words, start, match)) return [{ player, match }];
    }
    return [];
  });
  const best = found.map((each) => each.match).toSorted(compareMatches)[0];
  return found
    .filter((each) => best && compareMatches(each.match, best) === 0)
    .map((each) => each.player);
}

/**
 * The rows of players' sheets, each on her team, and, for words asking who is out, saying whether
 * she is.
 * @param {PagePlayer[]} players
 * @param {SearchPages} pages
 * @param {"named"} [out]
 * @returns {PageRow[]}
 */
function listPlayerRows(players, pages, out) {
  const teams = new Map(pages.teams.map((team) => [team.code, team]));
  return players.flatMap((player) => {
    const team = teams.get(player.team);
    if (!team) return [];
    const row = /** @type {const} */ ({ kind: "player", team, player });
    return [/** @type {PageRow} */ (out ? { ...row, out } : row)];
  });
}

/**
 * Whether every one of the typed words is one of the words, each perhaps only the start of one.
 * @param {string[]} typed
 * @param {string[]} words
 */
const isEveryWordOf = (typed, words) => {
  const parts = words.flatMap(splitWords);
  return typed.every((word) => parts.some((part) => isWordOf(word, part, AS_START)));
};

/**
 * The places every one of the typed words finds.
 * @param {string[]} typed
 * @param {PagePlace[]} places
 */
const findPlaces = (typed, places) => places.filter((place) => isEveryWordOf(typed, place.words));

/**
 * The game of the games, which come in order of start, that a game's part opens, or null when
 * there is none: the latest final, or the next game, the one under way or the first to come.
 * @template {{ state: string }} Game
 * @param {Game[]} games
 * @param {GamePart} part
 * @returns {Game | null}
 */
export const findPartGame = (games, part) =>
  (part.game === "latest-final"
    ? games.findLast((game) => game.state === "final")
    : games.find((game) => game.state !== "final")) ?? null;

/**
 * The words left for a search of games once some have found a page: all but those the search of
 * games doesn't know, or null when none is left.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {import("./search-words.js").Token[]} taken the tokens that found a page
 */
function leaveGameText(tokens, taken) {
  const left = tokens.filter(
    (token) =>
      !taken.includes(token) || token.meanings.some((meaning) => meaning.kind !== "filler"),
  );
  return left.some((token) => !hasKind(token, "filler"))
    ? left.map((token) => token.text).join(" ")
    : null;
}

// The words a fan may put before a player's number, as in "No. 2" or "number 2".
const NUMBER_WORDS = ["number", "no"];

/**
 * The player's number the words name, as "2", "#2", "No. 2", or "number 2", or null.
 * @param {string[]} typed
 */
function readPlayerNumber(typed) {
  const number = typed.at(-1) ?? "";
  const before = typed.slice(0, -1);
  const isLedRight =
    before.length === 0 || (before.length === 1 && isEveryWordOf(before, NUMBER_WORDS));
  return /^\d{1,2}$/.test(number) && isLedRight ? number : null;
}

/**
 * Orders numbers as a roster does, shortest first, then by value, so "2" comes before "22".
 * @param {string} first
 * @param {string} second
 */
const compareNumbers = (first, second) =>
  first.length - second.length || Number(first) - Number(second);

/**
 * The rows of a team's players who wear a number, or, while it may be the start of one, each
 * number it starts, the number itself first.
 * @param {PageTeam} team
 * @param {string} number
 * @param {boolean} isPartial
 * @param {SearchPages} pages
 * @returns {PageRow[]}
 */
const listNumberRows = (team, number, isPartial, pages) =>
  pages.players
    .filter(
      (player) =>
        player.team === team.code &&
        (player.number === number || (isPartial && !!player.number?.startsWith(number))),
    )
    .toSorted((first, second) => compareNumbers(first.number, second.number))
    .map((player) => ({ kind: "player", team, player }));

/**
 * The rows for a team named alone, with its section's name, or with a player's number, which may
 * be the start of one while it's the last word typed.
 * @param {PageTeam} team
 * @param {string[]} typed the words beside the team's name
 * @param {{ pages: SearchPages, isNumberPartial: boolean }} search
 * @returns {PageRow[]}
 */
function listTeamRows(team, typed, { pages, isNumberPartial }) {
  const section = pages.section;
  /** @type {PageRow[]} */
  const sectionRow = section ? [{ kind: "section", team }] : [];
  if (!typed.length) return [{ kind: "team", team }, ...sectionRow];
  const number = readPlayerNumber(typed);
  if (number !== null) return listNumberRows(team, number, isNumberPartial, pages);
  const sectionWords = section ? splitWords(section.name) : [];
  const isSection = typed.every((word) =>
    sectionWords.some((part) => isWordOf(word, part, AS_START)),
  );
  return isSection ? sectionRow : [];
}

// The words that ask who is out, each from its third letter, and the one that does after one of
// them, as "injury report" does.
const OUT_WORDS = ["out", "injured", "injury", "injuries", "hurt", "sidelined", "inactive"];
const AFTER_OUT_WORDS = ["report", "list"];

/**
 * The tokens besides those that ask who is out, or null when none ask.
 * @param {import("./search-words.js").Token[]} tokens
 */
function readOutAsked(tokens) {
  const words = tokens.flatMap((token) => token.words);
  const isOutWord = (/** @type {string | undefined} */ word) =>
    !!word && OUT_WORDS.some((outWord) => isWordOf(word, outWord, AS_START));
  const isAsking = words.map(
    (word, index) =>
      isOutWord(word) || (AFTER_OUT_WORDS.includes(word) && isOutWord(words[index - 1])),
  );
  let start = 0;
  const isAskingToken = tokens.map((token) => {
    const isAsked = token.words.every((word, offset) => isAsking[start + offset]);
    start += token.words.length;
    return isAsked;
  });
  const rest = tokens.filter((token, index) => !isAskingToken[index]);
  return rest.length < tokens.length ? rest : null;
}

/**
 * The rows of the players out, by team and then last name, each saying why.
 * @param {PagePlayer[]} players
 * @param {SearchPages} pages
 * @returns {PageRow[]}
 */
function listOutRows(players, pages) {
  const teams = new Map(pages.teams.map((team) => [team.code, team]));
  return players
    .flatMap((player) => {
      const team = teams.get(player.team);
      return team && player.out ? [{ player, team }] : [];
    })
    .sort(
      (first, second) =>
        first.team.name.localeCompare(second.team.name) ||
        first.player.lastName.localeCompare(second.player.lastName),
    )
    .map(({ player, team }) => ({ kind: "player", team, player, out: "listed" }));
}

/**
 * The game's part the words name, and the tokens that name it: each word but a team's is one of
 * the part's words, or one a search of games passes over, as "matchup" is, and one at least is the
 * part's.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {GamePart[]} parts
 */
function findGamePart(tokens, parts) {
  const others = tokens.filter((token) => !hasKind(token, "team"));
  for (const part of parts) {
    const named = others.filter((token) => isEveryWordOf(token.words, part.words));
    const isRestPassedOver = others.every(
      (token) => named.includes(token) || hasKind(token, "filler"),
    );
    if (named.length && isRestPassedOver) return { part, named };
  }
  return null;
}

/**
 * The pages a search's words ask for, and the words left for its search of games, or null when
 * the words ask for no games. The places the rest of the words find list first, beside what else
 * the words name, as "stan" starts Standings and a player's name, and "the athletic" names The
 * Athletic's setting and, a letter off, MLB's Athletics. The rest leave out the words a search of
 * games passes over, and a team's own name, which names only the team.
 * @param {string} text
 * @param {{ dictionary: import("./search-words.js").Dictionary, pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages}
 */
export function findPages(text, search) {
  const asked = findAskedPages(text, search);
  if (asked) return asked;
  const isTeamName = (/** @type {import("./search-words.js").Token} */ token) =>
    (search.dictionary.get(token.text) ?? []).some((meaning) => meaning.kind === "team");
  const words = readTokens(text, search.dictionary)
    .filter((token) => !hasKind(token, "filler") && !isTeamName(token))
    .flatMap((token) => token.words);
  const places = words.length ? findPlaces(words, search.pages.places) : [];
  const found = findWordPages(text, search);
  const rest = found.rows.filter((row) => !(row.kind === "place" && places.includes(row.place)));
  return {
    rows: [...places.map((place) => /** @type {PageRow} */ ({ kind: "place", place })), ...rest],
    gameText: found.gameText,
    isFirst: found.isFirst,
  };
}

/**
 * The pages that answer a question the words ask, taking every word, or null when they ask none:
 * who is out, alone, on a team, or by name, and a team's record or its news.
 * @param {string} text
 * @param {{ dictionary: import("./search-words.js").Dictionary, pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages | null}
 */
function findAskedPages(text, { dictionary, pages, isTyping }) {
  const tokens = readTokens(text, dictionary);
  const teamTokens = tokens.filter((token) => hasKind(token, "team"));
  const otherTokens = tokens.filter(
    (token) => !hasKind(token, "team") && !hasKind(token, "filler"),
  );
  const outRest = readOutAsked(otherTokens);
  if (!teamTokens.length)
    return outRest && findOutPages(outRest, { text, tokens, pages, isTyping });
  const team = findOneTeam(teamTokens, pages);
  const otherWords = otherTokens.flatMap((token) => token.words);
  if (!team || !otherWords.length) return null;
  if (outRest?.length === 0) return findTeamOutPages(team, pages);
  if (pages.news && isEveryWordOf(otherWords, pages.news.place.words))
    return findTeamNews(team, pages.news);
  if (isEveryWordOf(otherWords, RECORD_WORDS))
    return {
      rows: listTeamRows(team, [], { pages, isNumberPartial: false }),
      gameText: leaveGameText(tokens, otherTokens),
    };
  return null;
}

/**
 * The one team the words name, or undefined when they name none or more than one.
 * @param {import("./search-words.js").Token[]} teamTokens
 * @param {SearchPages} pages
 */
function findOneTeam(teamTokens, pages) {
  const codes = new Set(
    teamTokens.flatMap((token) =>
      token.meanings.flatMap((meaning) => (meaning.kind === "team" ? [meaning.value] : [])),
    ),
  );
  return codes.size === 1 && teamTokens.length === 1
    ? pages.teams.find((each) => codes.has(each.code))
    : undefined;
}

/**
 * The pages the search's words find, read word by word: a game's part, a team's pages, or the
 * places only words a search of games passes over find, each with the players the words name after
 * them, as "fox" starts Foxworth's after the Foxes' pages, but for the players a team's number
 * names, as "Sky 24" does; or else the players the words name, or the places they find.
 * @param {string} text
 * @param {{ dictionary: import("./search-words.js").Dictionary, pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages}
 */
function findWordPages(text, { dictionary, pages, isTyping }) {
  const tokens = readTokens(text, dictionary);
  const teamTokens = tokens.filter((token) => hasKind(token, "team"));
  const otherTokens = tokens.filter(
    (token) => !hasKind(token, "team") && !hasKind(token, "filler"),
  );
  const otherWords = otherTokens.flatMap((token) => token.words);
  const players = listPlayerRows(findPlayers(tokens, pages.players, isTyping), pages);
  const found = findGamePart(tokens, pages.gameParts);
  if (found) {
    const gameText = leaveGameText(tokens, found.named);
    const partRow = /** @type {PageRow} */ ({ kind: "game-part", part: found.part, gameText });
    return { rows: [partRow, ...players], gameText: null };
  }
  if (teamTokens.length) {
    const teamPages = findTeamPages(teamTokens, otherTokens, { text, tokens, pages, isTyping });
    if (teamPages.isFirst) return teamPages;
    return { ...teamPages, rows: [...teamPages.rows, ...players] };
  }
  if (!otherWords.length) {
    const places = findPassedOverPlaces(tokens, text, pages);
    return players.length ? { rows: [...places.rows, ...players], gameText: null } : places;
  }
  if (players.length) {
    const isKnownToGames = otherTokens.some((token) => token.meanings.length > 0);
    return { rows: players, gameText: isKnownToGames ? text : null };
  }
  const places = findPlaces(otherWords, pages.places);
  if (!places.length) return { rows: [], gameText: text };
  return {
    rows: places.map((place) => ({ kind: "place", place })),
    gameText: leaveGameText(tokens, otherTokens),
  };
}

/**
 * Who is out, when the words ask with no name, then any other player whose name they start as
 * they're typed, as "hurt" starts Hurter's; or the players they name beside them, each out saying
 * why; or no page when they name no one. A line over the rows says they're who's out only when
 * each is, and a player named alone, whether she is. A league whose players don't say who is out
 * lists no one for the words alone, and the players named without a word on it.
 * @param {import("./search-words.js").Token[]} rest the tokens besides those that ask who is out
 * @param {{ text: string, tokens: import("./search-words.js").Token[], pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages}
 */
function findOutPages(rest, { text, tokens, pages, isTyping }) {
  if (!rest.length) {
    const rows = pages.isOutKnown ? listOutRows(pages.players, pages) : [];
    const listed = new Set(rows.map((row) => row.kind === "player" && row.player.id));
    const others = findPlayers(tokens, pages.players, isTyping).filter(
      (player) => !listed.has(player.id),
    );
    const started = listPlayerRows(others, pages);
    if (!rows.length) return { rows: started, gameText: text };
    if (started.length) return { rows: [...rows, ...started], gameText: null };
    return { rows, gameText: null, read: describeWhoIsOut(rows) };
  }
  const players = findPlayers(rest, pages.players, isTyping);
  const rows = listPlayerRows(players, pages, "named");
  if (!rows.length) return { rows: [], gameText: text };
  if (!pages.isOutKnown) return { rows, gameText: null };
  const read = describeNamedOut(players, rows);
  return read ? { rows, gameText: null, read } : { rows, gameText: null };
}

/**
 * The line over the players named beside words asking who is out: whether she's out, for one, or
 * who's out, when each of them is, or none when some aren't.
 * @param {PagePlayer[]} players
 * @param {PageRow[]} rows
 */
function describeNamedOut(players, rows) {
  const [player] = players;
  if (players.length === 1)
    return {
      lead: `${player.firstName} ${player.lastName}`,
      facts: [player.out ? "Out" : "Not out"],
    };
  return players.every((each) => each.out) ? describeWhoIsOut(rows) : undefined;
}

/**
 * Who is out, as the line over its rows says it: "Who's out", and how many players.
 * @param {PageRow[]} rows
 */
const describeWhoIsOut = (rows) => ({
  lead: "Who's out",
  facts: [describeCount(rows.length, "player")],
});

/**
 * The places that words a search of games passes over find, each a whole word of the place's as
 * typed, as "season" finds the Season picker, leaving no words for games, or, when they find none,
 * the words left for games. A word so common is no start of another, nor its plural, so "games"
 * finds no Night Game theme.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {string} text
 * @param {SearchPages} pages
 * @returns {FoundPages}
 */
function findPassedOverPlaces(tokens, text, pages) {
  const words = tokens.flatMap((token) => token.words);
  const places = words.length
    ? pages.places.filter((place) => {
        const parts = place.words.flatMap(splitWords);
        return words.every((word) => parts.includes(word));
      })
    : [];
  if (!places.length) return { rows: [], gameText: text };
  return { rows: places.map((place) => ({ kind: "place", place })), gameText: null };
}

/**
 * The pages of the one team the words name, alone, with its section's name, or with a player's
 * number, whose players' rows show first.
 * @param {import("./search-words.js").Token[]} teamTokens
 * @param {import("./search-words.js").Token[]} otherTokens
 * @param {{ text: string, tokens: import("./search-words.js").Token[], pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages}
 */
function findTeamPages(teamTokens, otherTokens, { text, tokens, pages, isTyping }) {
  const otherWords = otherTokens.flatMap((token) => token.words);
  const team = findOneTeam(teamTokens, pages);
  const isNumberPartial = isTyping && tokens.at(-1) === otherTokens.at(-1);
  const rows = team ? listTeamRows(team, otherWords, { pages, isNumberPartial }) : [];
  if (!rows.length) return { rows: [], gameText: text };
  const taken = tokens.filter((token) => !teamTokens.includes(token) && !hasKind(token, "filler"));
  const isFirst = rows[0].kind === "player";
  return { rows, gameText: leaveGameText(tokens, taken), isFirst };
}

/**
 * Who is out on a team, or, when no one is or its players don't say, its section, which lists
 * every player.
 * @param {PageTeam} team
 * @param {SearchPages} pages
 * @returns {FoundPages}
 */
function findTeamOutPages(team, pages) {
  const section = pages.section ? [/** @type {PageRow} */ ({ kind: "section", team })] : [];
  if (!pages.isOutKnown) return { rows: section, gameText: null };
  const rows = listOutRows(
    pages.players.filter((player) => player.team === team.code),
    pages,
  );
  const read = { lead: team.name, facts: ["Who's out", describeCount(rows.length, "player")] };
  return { rows: rows.length ? rows : section, gameText: null, read };
}

/**
 * A team's news: the News tab, and the newest stories about the team.
 * @param {PageTeam} team
 * @param {NonNullable<SearchPages["news"]>} news
 * @returns {FoundPages}
 */
function findTeamNews(team, { place, stories }) {
  const about = stories.filter((story) => story.teams.includes(team.code)).slice(0, TEAM_STORIES);
  return {
    rows: [
      { kind: "place", place, detail: team.name },
      ...about.map((story) => /** @type {PageRow} */ ({ kind: "story", story })),
    ],
    gameText: null,
    read: { lead: team.name, facts: ["News", describeCount(about.length, "story", "stories")] },
  };
}
