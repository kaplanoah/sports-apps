// Reading a search of a season's games, like "Liberty at Dream", "Dream in NY", or "Liberty this
// weekend", into what each word asks of a game, finding the games that ask fits, and saying how it
// read the words. A league hands it what differs: its teams, places, rounds, and example searches,
// any groups of teams and starters it has, and how to read one of its games. Everything runs on the
// phone, from the season the page already holds, so a search never waits on the network. Its
// phrases are in game-search-dictionary.js, reading them in game-search-read.js, finding the games
// in game-search-match.js, and the line in game-search-describe.js. Runs in the page and in Node, so
// it uses no DOM.
//
// Joining words decide roles: "A at B" and "A @ B" have A visiting B, while "A B", "A vs B", and
// "A and B" find their games either way, and "A or B" either team's. "In" takes a place or a month,
// and a game is where its arena is, so "home" is a team's own arena and a home game the league plays
// at a neutral site is left out and named. "Home" or "away" is the first team's, or, after "A or B",
// each one's. Every condition must hold, and "next" and "last" then pick from what's left. A game
// whose time isn't set yet counts in a search of its day, and in a search for a time of day it's
// listed by date with the rest and counted apart, since it may yet fit.
// A word two teams share, like "Sox", finds either's games, and a starter's name finds the games he's
// named to start, his next only once it's announced. A channel's name finds the games on it, and a
// league's word for a final past regulation, like "overtime", finds those finals.

import { formatCalendarDate } from "./days.js";

export {
  createSearchDictionary,
  listSearchChannels,
  listVenuePlaces,
} from "./game-search-dictionary.js";
export { isAskingNothing, isTownMeaning, readSearch } from "./game-search-read.js";
export { findSearchGames, isGameInPlace, listPlaceTeams } from "./game-search-match.js";
export { describeCount, describeNoGames, describeSearch } from "./game-search-describe.js";

/** @typedef {import("./search-dates.js").DayRange} DayRange */
/** @typedef {import("./search-dates.js").TimeOfDay} TimeOfDay */
/**
 * A league's game as a search reads it: the day the list shows it under, its start in minutes on
 * the viewer's clock, or null until its time is set, and where it's played, once the league says.
 * @typedef {object} SearchGame
 * @property {string} id
 * @property {string} day "YYYY-MM-DD"
 * @property {number | null} minutes
 * @property {number} startMs
 * @property {string | null} away
 * @property {string | null} home
 * @property {"pre" | "live" | "final"} state
 * @property {string | null} winner
 * @property {"regular" | "playoffs" | "all-star" | "cup"} kind
 * @property {number | null} round
 * @property {number | null} number
 * @property {boolean} isIfNeeded
 * @property {{ name: string, city: string, state: string } | null} arena
 * @property {boolean} isNeutral
 * @property {string | null} [conference] the conference a playoff game's series is in, for a league
 *   whose rounds are each conference's own
 * @property {{ id: string, name: string }[]} [starters] the starters it names, once announced
 * @property {number | null} [localMinutes] its start in minutes on the clock where it's played
 * @property {boolean} [isDoubleheader]
 * @property {string[]} [networks] the channels it's on, as the league lists them
 * @property {boolean} [isPastRegulation] whether a final went past regulation, as into overtime
 * @property {any} game the league's own game
 */
/**
 * A team as a search knows it: the words that name it, the names besides its own a suggestion may
 * write for it, like "Los Angeles Dodgers" or, after "LA", "LA Dodgers", the city and state of its
 * arena, and its conference.
 * @typedef {{ code: string, name: string, words: string[], shownNames?: string[], homeCity: string, homeState?: string, conference: string }} SearchTeam
 */
/**
 * A place, the words that name it, and the arena cities and states that are in it, or an arena by
 * its own name.
 * @typedef {{ name: string, words: string[], cities: string[], states?: string[], isArena?: boolean }} SearchPlace
 */
/**
 * Teams a search can name together, like a conference or a division, and the words that name them.
 * @typedef {{ name: string, words: string[], codes: string[] }} SearchGroup
 */
/**
 * A playoff round, the words that name it, and, when it's one conference's own, which.
 * @typedef {{ round: number, name: string, words: string[], conference?: string }} SearchRound
 */
/**
 * A player who starts games, like a starting pitcher, and the words that name him.
 * @typedef {{ id: string, name: string, words: string[] }} SearchStarter
 */
/**
 * What a league hands a search. Without groups, its teams' conferences are its groups.
 * @typedef {object} SearchTerms
 * @property {SearchTeam[]} teams
 * @property {SearchPlace[]} places
 * @property {SearchRound[]} rounds
 * @property {import("./league-words.js").LeagueWords} words what the league calls things
 * @property {string[]} examples whole searches to offer before anything is typed
 * @property {SearchGroup[]} [groups]
 * @property {SearchStarter[]} [starters]
 * @property {SearchChannel[]} [channels] the channels its games are on
 */
/**
 * A channel games are on, as the line names it, the words that name it, and each name the league
 * lists it by.
 * @typedef {{ name: string, words: string[], listings: string[] }} SearchChannel
 */
/**
 * @typedef {object} SearchContext
 * @property {SearchTerms} terms
 * @property {import("./search-words.js").Dictionary} dictionary
 * @property {SearchGame[]} games the season's games, in order of start
 * @property {string} today
 * @property {string} seasonStart
 * @property {string} seasonEnd
 * @property {Map<string, SearchTeam>} teamsByCode
 */
/**
 * What a search asks of a game.
 * @typedef {object} Search
 * @property {{ codes: string[], join: string | null }[]} teams each team, or the teams one word names,
 *   like "Sox", with the joining word before it
 * @property {{ ids: string[], name: string }[]} starters each starter, or the starters one name names
 * @property {SearchGroup | null} group
 * @property {boolean} isCrossConference
 * @property {"home" | "away" | null} side
 * @property {SearchPlace[]} places
 * @property {DayRange[]} ranges
 * @property {{ value: number[], label: string } | null} weekdays
 * @property {TimeOfDay[]} times
 * @property {string[]} kinds
 * @property {SearchRound[]} rounds
 * @property {number | null} gameNumber
 * @property {boolean} isIfNeeded
 * @property {boolean} isDoubleheader
 * @property {string[]} states
 * @property {"win" | "loss" | null} outcome
 * @property {{ which: "next" | "last", count: number } | null} pick
 * @property {{ name: string, label: string } | null} landmark
 * @property {SearchChannel[]} channels
 * @property {boolean} isPastRegulation
 * @property {string[]} skipped the words it couldn't use, each phrase as read, like a date the
 *   calendar doesn't have
 */

/**
 * A league's games as a search reads them, in order of start, leaving out any it can't read, like
 * one without a day.
 * @template Game
 * @param {Game[]} games
 * @param {(game: Game) => SearchGame | null} readGame
 * @returns {SearchGame[]}
 */
export const listSearchGames = (games, readGame) =>
  games
    .map(readGame)
    .filter((game) => game !== null)
    .sort((first, second) => first.startMs - second.startMs);

/**
 * What a search needs to know of the season, read once for each drawing.
 * @param {{ terms: SearchTerms, dictionary: import("./search-words.js").Dictionary, games: SearchGame[], now: number }} season
 *   its games in order of start, as `listSearchGames` lists them
 * @returns {SearchContext}
 */
export function createSearchContext({ terms, dictionary, games, now }) {
  const today = formatCalendarDate(new Date(now));
  const days = games.map((game) => game.day);
  const seasonStart = days[0] ?? today;
  return {
    terms,
    dictionary,
    games,
    today,
    seasonStart,
    seasonEnd: days.at(-1) ?? today,
    teamsByCode: new Map(terms.teams.map((team) => [team.code, team])),
  };
}
