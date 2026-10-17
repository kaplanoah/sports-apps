// Reading a search's words into the pages they ask for, beside the games they find: a team's sheet
// and its section, like a WNBA team's Roster, a player's sheet, and the league's places, like the
// Standings lists and settings, and a game's parts, like a final's Highlights or MLB's Matchup. A
// team's name lists its sheet and its section, as it does beside "record", and the section's name
// beside it lists the section alone. A game part's name lists the part of the game the rest of the
// words find, or the season's: the latest final for a final's part, or the next game for one before
// it. A player's name lists her sheet, even with one letter wrong in a name of five letters or
// more, and finds no games, since nobody knows yet which games she'll play, unless a search of games
// knows the name, as MLB's knows a starter's, finding his starts. Words like "out" or "injured" list
// who is out, alone, on a team beside its name, or the player they name, saying whether she is. A
// team's name beside the News tab's words lists the tab and the newest stories about the team. A
// place's words list it, and leave the games to any of them that a search of games reads, as "East"
// finds the East's standings and its games. Words that ask for anything else, like a second team, a
// day, or "at", ask for games, and list no page. A league hands it its teams, players, and places,
// and the search's dictionary, so a team is named here by the same words it is in a search of
// games. Runs in the page and in Node, so it uses no DOM.

import { describeCount } from "./game-search.js";
import { hasKind, isForgivenTypo, readTokens, splitWords } from "./search-words.js";

/** @typedef {{ code: string, name: string, fullName: string, record?: string }} PageTeam */
/**
 * Why a player is out, while she is: what the injury report says, and whether for the season.
 * @typedef {{ reason: string | null, isForSeason: boolean }} PlayerOut
 */
/** @typedef {{ id: string, team: string, firstName: string, lastName: string, number: string, out?: PlayerOut | null }} PagePlayer */
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
 * they are, as the games line does: its lead, then its facts.
 * @typedef {{ rows: PageRow[], gameText: string | null, read?: { lead: string, facts: string[] } }} FoundPages
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

// Words after a last name that a fan may leave off.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Each player's names, read once, since a search reads every player's on every key.
/** @type {WeakMap<PagePlayer, string[][]>} */
const playerNames = new WeakMap();

/**
 * The words a player can be named by: her whole name, her last name, or her first, each with or
 * without a suffix after her last name, like "Jr.".
 * @param {PagePlayer} player
 */
function listPlayerNames(player) {
  const kept = playerNames.get(player);
  if (kept) return kept;
  const names = readPlayerNames(player);
  playerNames.set(player, names);
  return names;
}

/** @param {PagePlayer} player */
function readPlayerNames(player) {
  const first = splitWords(player.firstName);
  const last = splitWords(player.lastName);
  const hasSuffix = last.length > 1 && NAME_SUFFIXES.has(last[last.length - 1]);
  const lasts = hasSuffix ? [last, last.slice(0, -1)] : [last];
  return [...lasts.map((each) => [...first, ...each]), ...lasts, first].filter(
    (name) => name.length > 0,
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
 * A word of a search, and whether a search of games knows it, as it knows "east" or "NL".
 * @typedef {{ word: string, isKnown: boolean }} ReadWord
 */

/**
 * How a typed word names a word of a name: as written or begun, as `isWordOf` reads it, or with one
 * wrong letter when a search of games doesn't know it, or not at all.
 * @param {ReadWord} typed
 * @param {string} part
 * @param {boolean} isPartial
 * @returns {"exact" | "typo" | null}
 */
function matchNamePart({ word, isKnown }, part, isPartial) {
  if (isWordOf(word, part, isPartial)) return "exact";
  return !isKnown && isForgivenTypo(word, part) ? "typo" : null;
}

/**
 * How words name a player: by how many of them, and whether any has a wrong letter.
 * @typedef {{ length: number, hasTypo: boolean }} NameMatch
 */

/**
 * How the words from `start` name the player, as her whole name, last name, or first, by the most
 * words, and then without a wrong letter, or null. While words are typed, the last may be the start
 * of her name, unless a search of games knows it whole.
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
    const matches = name.map((part, offset) => {
      const typed = words[start + offset];
      const isLast = start + offset === words.length - 1 && offset === name.length - 1;
      return matchNamePart(typed, part, isTyping && isLast && !typed.isKnown);
    });
    if (matches.includes(null)) continue;
    const match = { length: name.length, hasTypo: matches.includes("typo") };
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
 * Whether only words a search of games doesn't know, like "stats", sit beside a name's.
 * @param {ReadWord[]} words
 * @param {number} start
 * @param {number} length
 */
const isRestUnknown = (words, start, length) =>
  words.every((each, index) => (index >= start && index < start + length) || !each.isKnown);

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
  const words = tokens.flatMap((token) =>
    token.words.map((word) => ({ word, isKnown: token.meanings.length > 0 })),
  );
  const found = players.flatMap((player) => {
    for (let start = 0; start < words.length; start += 1) {
      const match = measurePlayerAt(words, start, player, isTyping);
      if (match && isRestUnknown(words, start, match.length)) return [{ player, match }];
    }
    return [];
  });
  const best = found.map((each) => each.match).toSorted(compareMatches)[0];
  return found
    .filter((each) => best && compareMatches(each.match, best) === 0)
    .map((each) => each.player);
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
    !!word && OUT_WORDS.some((outWord) => isWordOf(word, outWord, true));
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
  if (!teamTokens.length) return outRest && findOutPages(outRest, { text, pages, isTyping });
  const team = findOneTeam(teamTokens, pages);
  const otherWords = otherTokens.flatMap((token) => token.words);
  if (!team || !otherWords.length) return null;
  if (outRest?.length === 0) return findTeamOutPages(team, pages);
  if (pages.news && isEveryWordOf(otherWords, pages.news.place.words))
    return findTeamNews(team, pages.news);
  if (isEveryWordOf(otherWords, RECORD_WORDS))
    return { rows: listTeamRows(team, [], pages), gameText: leaveGameText(tokens, otherTokens) };
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
 * The pages the search's words find, read word by word.
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
  const found = findGamePart(tokens, pages.gameParts);
  if (found) {
    const gameText = leaveGameText(tokens, found.named);
    return { rows: [{ kind: "game-part", part: found.part, gameText }], gameText: null };
  }
  if (teamTokens.length) return findTeamPages(teamTokens, otherTokens, { text, tokens, pages });
  if (!otherWords.length) return findPassedOverPlaces(tokens, text, pages);
  const teams = new Map(pages.teams.map((team) => [team.code, team]));
  const players = findPlayers(otherTokens, pages.players, isTyping).flatMap((player) => {
    const team = teams.get(player.team);
    return team ? [/** @type {PageRow} */ ({ kind: "player", team, player })] : [];
  });
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
 * Who is out, when the words ask with no name, or the players they name, each saying whether
 * she's out, or no page when they name no one.
 * @param {import("./search-words.js").Token[]} rest the tokens besides those that ask who is out
 * @param {{ text: string, pages: SearchPages, isTyping: boolean }} search
 * @returns {FoundPages}
 */
function findOutPages(rest, { text, pages, isTyping }) {
  if (!rest.length) {
    const rows = listOutRows(pages.players, pages);
    if (!rows.length) return { rows: [], gameText: text };
    return { rows, gameText: null, read: describeWhoIsOut(rows) };
  }
  const teams = new Map(pages.teams.map((team) => [team.code, team]));
  const players = findPlayers(rest, pages.players, isTyping);
  const rows = players.flatMap((player) => {
    const team = teams.get(player.team);
    return team ? [/** @type {PageRow} */ ({ kind: "player", team, player, out: "named" })] : [];
  });
  if (!rows.length) return { rows: [], gameText: text };
  const [player] = players;
  const read =
    players.length === 1
      ? { lead: `${player.firstName} ${player.lastName}`, facts: [player.out ? "Out" : "Not out"] }
      : describeWhoIsOut(rows);
  return { rows, gameText: null, read };
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
 * The pages of the one team the words name, alone or with its section's name.
 * @param {import("./search-words.js").Token[]} teamTokens
 * @param {import("./search-words.js").Token[]} otherTokens
 * @param {{ text: string, tokens: import("./search-words.js").Token[], pages: SearchPages }} search
 * @returns {FoundPages}
 */
function findTeamPages(teamTokens, otherTokens, { text, tokens, pages }) {
  const otherWords = otherTokens.flatMap((token) => token.words);
  const team = findOneTeam(teamTokens, pages);
  const rows = team ? listTeamRows(team, otherWords, pages) : [];
  if (!rows.length) return { rows: [], gameText: text };
  const taken = tokens.filter((token) => !teamTokens.includes(token) && !hasKind(token, "filler"));
  return { rows, gameText: leaveGameText(tokens, taken) };
}

/**
 * Who is out on a team, or, when no one is, its section, which lists every player.
 * @param {PageTeam} team
 * @param {SearchPages} pages
 * @returns {FoundPages}
 */
function findTeamOutPages(team, pages) {
  const rows = listOutRows(
    pages.players.filter((player) => player.team === team.code),
    pages,
  );
  const read = { lead: team.name, facts: ["Who's out", describeCount(rows.length, "player")] };
  if (rows.length) return { rows, gameText: null, read };
  return { rows: pages.section ? [{ kind: "section", team }] : [], gameText: null, read };
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
