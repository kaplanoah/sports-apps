// Reading a search's words into the pages they ask for, beside the games they find: a team's sheet
// and its section, like a WNBA team's Roster, a player's sheet, and the league's places, like the
// Standings lists and settings, and a game's part, like a WNBA final's Highlights. A team's name
// lists its sheet and its section, and the section's name beside it lists the section alone. A game
// part's name lists the part of the latest final the rest of the words find, or of the season's. A player's name lists her sheet, and finds no games,
// since nobody knows yet which games she'll play. A place's words list it, and leave the games to
// any of them that a search of games reads, as "East" finds the East's standings and its games.
// Words that ask for anything else, like a second team, a day, or "at", ask for games, and list no
// page. A league hands it its teams, players, and places, and the search's dictionary, so a team is
// named here by the same words it is in a search of games. Runs in the page and in Node, so it uses
// no DOM.

import { readTokens, splitWords } from "./search-words.js";

/** @typedef {{ code: string, name: string, fullName: string }} PageTeam */
/** @typedef {{ id: string, team: string, firstName: string, lastName: string, number: string }} PagePlayer */
/**
 * A place in the app a search can open, the words of its row, the words that find it, and the
 * icon of the button it's otherwise opened from.
 * @typedef {{ key: string, name: string[], words: string[], icon: "bracket" | "standings" | "news" | "settings" }} PagePlace
 */
/**
 * A part of a finished game's sheet a search can open, by its key and name, and the words that
 * find it.
 * @typedef {{ key: string, name: string, words: string[] }} GamePart
 */
/**
 * What a league hands a search's pages: its teams and players, the section a team's sheet opens on
 * beside its first, by its key and name, its places, the part of a final's sheet it can open, and
 * pages to offer as examples.
 * @typedef {object} SearchPages
 * @property {PageTeam[]} teams
 * @property {PagePlayer[]} players
 * @property {{ key: string, name: string } | null} section
 * @property {PagePlace[]} places
 * @property {GamePart | null} gamePart
 * @property {string[]} examples
 */
/**
 * A page a search lists: a team's sheet or its section, a player's sheet, a place, or a game's
 * part, of the latest final the words left for a search of games find, or of the season's when
 * none are left.
 * @typedef {{ kind: "team" | "section", team: PageTeam } | { kind: "player", team: PageTeam, player: PagePlayer } | { kind: "place", place: PagePlace } | { kind: "game-part", part: GamePart, gameText: string | null }} PageRow
 */

// A word this short only finds a name or a place once it's whole, or it would find too many.
const SHORTEST_PREFIX = 3;

/**
 * Whether a typed word names a word: as written, as a plural's single, or, when it may be only the
 * start of one, as its start.
 * @param {string} typed
 * @param {string} word
 * @param {boolean} isPartial
 */
const isWordOf = (typed, word, isPartial) =>
  typed === word ||
  (typed.endsWith("s") && typed.slice(0, -1) === word) ||
  (isPartial && typed.length >= SHORTEST_PREFIX && word.startsWith(typed));

/**
 * The words a player can be named by: her whole name, her last name, or her first.
 * @param {PagePlayer} player
 */
function listPlayerNames(player) {
  const first = splitWords(player.firstName);
  const last = splitWords(player.lastName);
  return [[...first, ...last], last, first].filter((name) => name.length > 0);
}

/**
 * How many words from `start` name the player, as her whole name, last name, or first, or 0. While
 * words are typed, the last may be the start of her name.
 * @param {string[]} words
 * @param {number} start
 * @param {PagePlayer} player
 * @param {boolean} isTyping
 */
function measurePlayerAt(words, start, player, isTyping) {
  for (const name of listPlayerNames(player)) {
    if (start + name.length > words.length) continue;
    const isNamed = name.every((part, offset) =>
      isWordOf(
        words[start + offset],
        part,
        isTyping && start + offset === words.length - 1 && offset === name.length - 1,
      ),
    );
    if (isNamed) return name.length;
  }
  return 0;
}

/**
 * The players the words name, keeping only those named by the most words, so a whole name finds
 * her alone rather than everyone who shares her first name.
 * @param {string[]} words
 * @param {PagePlayer[]} players
 * @param {boolean} isTyping
 */
function findPlayers(words, players, isTyping) {
  const found = players.flatMap((player) => {
    for (let start = 0; start < words.length; start += 1) {
      const length = measurePlayerAt(words, start, player, isTyping);
      if (length) return [{ player, length }];
    }
    return [];
  });
  const longest = Math.max(0, ...found.map((each) => each.length));
  return found.filter((each) => each.length === longest).map((each) => each.player);
}

/**
 * Whether every one of the typed words is one of the words, each perhaps only the start of one.
 * @param {string[]} typed
 * @param {string[]} words
 */
const isEveryWordOf = (typed, words) => {
  const parts = words.flatMap(splitWords);
  return typed.every((word) => parts.some((part) => isWordOf(word, part, true)));
};

/**
 * The places every one of the typed words finds.
 * @param {string[]} typed
 * @param {PagePlace[]} places
 */
const findPlaces = (typed, places) => places.filter((place) => isEveryWordOf(typed, place.words));

/**
 * The latest final of the games, which come in order of start, or null when none has ended.
 * @template {{ state: string }} Game
 * @param {Game[]} games
 * @returns {Game | null}
 */
export const findLatestFinal = (games) => games.findLast((game) => game.state === "final") ?? null;

/**
 * @param {import("./search-words.js").Token} token
 * @param {string} kind
 */
const hasKind = (token, kind) => token.meanings.some((meaning) => meaning.kind === kind);

/**
 * The words left for a search of games once some have found a page: all but those the search of
 * games doesn't know, or null when none is left.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {import("./search-words.js").Token[]} taken the tokens that found a page
 */
function leaveGameText(tokens, taken) {
  const left = tokens.filter((token) => !taken.includes(token) || token.meanings.length);
  return left.some((token) => !hasKind(token, "filler"))
    ? left.map((token) => token.text).join(" ")
    : null;
}

/**
 * The rows for a team named alone, or with its section's name.
 * @param {PageTeam} team
 * @param {string[]} typed the words beside the team's name
 * @param {SearchPages} pages
 * @returns {PageRow[]}
 */
function listTeamRows(team, typed, pages) {
  const section = pages.section;
  /** @type {PageRow[]} */
  const sectionRow = section ? [{ kind: "section", team }] : [];
  if (!typed.length) return [{ kind: "team", team }, ...sectionRow];
  const sectionWords = section ? splitWords(section.name) : [];
  const isSection = typed.every((word) => sectionWords.some((part) => isWordOf(word, part, true)));
  return isSection ? sectionRow : [];
}

/**
 * The pages a search's words ask for, and the words left for its search of games, or null when
 * the words ask for no games.
 * @param {string} text
 * @param {{ dictionary: import("./search-words.js").Dictionary, pages: SearchPages, isTyping: boolean }} search
 * @returns {{ rows: PageRow[], gameText: string | null }}
 */
export function findPages(text, { dictionary, pages, isTyping }) {
  const tokens = readTokens(text, dictionary);
  const teamTokens = tokens.filter((token) => hasKind(token, "team"));
  const otherTokens = tokens.filter(
    (token) => !hasKind(token, "team") && !hasKind(token, "filler"),
  );
  const otherWords = otherTokens.flatMap((token) => token.words);
  const part = pages.gamePart;
  if (part && otherWords.length && isEveryWordOf(otherWords, part.words)) {
    const gameText = leaveGameText(tokens, otherTokens);
    return { rows: [{ kind: "game-part", part, gameText }], gameText: null };
  }
  if (teamTokens.length) return findTeamPages(teamTokens, otherWords, { text, tokens, pages });
  if (!otherWords.length) return findPassedOverPlaces(tokens, text, pages);
  const teams = new Map(pages.teams.map((team) => [team.code, team]));
  const players = findPlayers(otherWords, pages.players, isTyping).flatMap((player) => {
    const team = teams.get(player.team);
    return team ? [/** @type {PageRow} */ ({ kind: "player", team, player })] : [];
  });
  if (players.length) return { rows: players, gameText: null };
  const places = findPlaces(otherWords, pages.places);
  if (!places.length) return { rows: [], gameText: text };
  return {
    rows: places.map((place) => ({ kind: "place", place })),
    gameText: leaveGameText(tokens, otherTokens),
  };
}

/**
 * The places that words a search of games passes over find, as "season" finds the Season picker,
 * leaving no words for games, or, when they find none, the words left for games.
 * @param {import("./search-words.js").Token[]} tokens
 * @param {string} text
 * @param {SearchPages} pages
 * @returns {{ rows: PageRow[], gameText: string | null }}
 */
function findPassedOverPlaces(tokens, text, pages) {
  const words = tokens.flatMap((token) => token.words);
  const places = words.length ? findPlaces(words, pages.places) : [];
  if (!places.length) return { rows: [], gameText: text };
  return { rows: places.map((place) => ({ kind: "place", place })), gameText: null };
}

/**
 * The pages of the one team the words name, alone or with its section's name.
 * @param {import("./search-words.js").Token[]} teamTokens
 * @param {string[]} otherWords
 * @param {{ text: string, tokens: import("./search-words.js").Token[], pages: SearchPages }} search
 * @returns {{ rows: PageRow[], gameText: string | null }}
 */
function findTeamPages(teamTokens, otherWords, { text, tokens, pages }) {
  const codes = new Set(
    teamTokens.flatMap((token) =>
      token.meanings.flatMap((meaning) => (meaning.kind === "team" ? [meaning.value] : [])),
    ),
  );
  const team =
    codes.size === 1 && teamTokens.length === 1
      ? pages.teams.find((each) => codes.has(each.code))
      : undefined;
  const rows = team ? listTeamRows(team, otherWords, pages) : [];
  if (!rows.length) return { rows: [], gameText: text };
  const taken = tokens.filter((token) => !teamTokens.includes(token) && !hasKind(token, "filler"));
  return { rows, gameText: leaveGameText(tokens, taken) };
}
