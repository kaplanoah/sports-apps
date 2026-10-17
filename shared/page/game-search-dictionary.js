// Every phrase a league's search of games knows: the words every league's searches share, for how
// words join and for a game's state and kind, the calendar's, and the league's own, its teams,
// places and venues, rounds, groups of teams, starters, and channels. Runs in the page and in Node,
// so it uses no DOM.

import { CALENDAR_ENTRIES } from "./search-dates.js";
import { describeChannel } from "./network-logos.js";
import { createDictionary } from "./search-words.js";

/** @typedef {import("./search-words.js").Meaning} Meaning */
/** @typedef {import("./game-search.js").SearchTerms} SearchTerms */
/** @typedef {import("./game-search.js").SearchTeam} SearchTeam */
/** @typedef {import("./game-search.js").SearchPlace} SearchPlace */
/** @typedef {import("./game-search.js").SearchGroup} SearchGroup */
/** @typedef {import("./game-search.js").SearchChannel} SearchChannel */

// Words every league's searches pass over; a league hands any of its own in its words.
const FILLER = [
  "a",
  "an",
  "the",
  "games",
  "when",
  "whens",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "will",
  "what",
  "whats",
  "who",
  "whos",
  "show",
  "me",
  "schedule",
  "of",
  "for",
  "team",
  "teams",
  "match",
  "matchup",
  "matchups",
  "see",
  "find",
  "all",
  "any",
  "every",
  "please",
  "list",
  "my",
  "i",
  "can",
  "where",
  "there",
  "that",
  "with",
  "day",
  "days",
  "this",
  "season",
  "s",
  "start",
  "starts",
  "starting",
];

// What every league's searches share: how words join, and words for a game's state and kind.
/** @type {{ phrase: string, meaning: Meaning }[]} */
const GENERAL_ENTRIES = [
  { phrase: "game", meaning: { kind: "game" } },
  ...["at", "@"].map((phrase) => ({ phrase, meaning: { kind: "join", value: "at" } })),
  ...[
    "vs",
    "v",
    "versus",
    "against",
    "play",
    "plays",
    "playing",
    "face",
    "faces",
    "facing",
    "meet",
    "meets",
    "host",
    "hosts",
    "hosting",
  ].map((phrase) => ({ phrase, meaning: { kind: "join", value: "vs" } })),
  { phrase: "and", meaning: { kind: "join", value: "and" } },
  { phrase: "or", meaning: { kind: "join", value: "or" } },
  { phrase: "in", meaning: { kind: "in" } },
  { phrase: "on", meaning: { kind: "on" } },
  ...["home", "at home", "home games"].map((phrase) => ({
    phrase,
    meaning: { kind: "side", value: "home", display: "at home" },
  })),
  ...["away", "road", "on the road", "away games", "road games"].map((phrase) => ({
    phrase,
    meaning: { kind: "side", value: "away", display: "away" },
  })),
  ...["next", "upcoming game"].map((phrase) => ({
    phrase,
    meaning: { kind: "pick", value: "next", display: "next game" },
  })),
  ...["last", "previous", "latest", "most recent"].map((phrase) => ({
    phrase,
    meaning: { kind: "pick", value: "last", display: "last game" },
  })),
  ...["live", "on now", "right now", "now", "in progress"].map((phrase) => ({
    phrase,
    meaning: { kind: "state", value: "live", display: "live" },
  })),
  ...["upcoming", "remaining", "left", "future", "unplayed", "to come"].map((phrase) => ({
    phrase,
    meaning: { kind: "state", value: "pre", display: "upcoming" },
  })),
  ...["results", "result", "scores", "score", "final", "played", "finished", "past"].map(
    (phrase) => ({ phrase, meaning: { kind: "state", value: "final", display: "results" } }),
  ),
  ...["playoffs", "playoff", "postseason", "post season"].map((phrase) => ({
    phrase,
    meaning: { kind: "kind", value: "playoffs", display: "playoffs" },
  })),
  {
    phrase: "regular season",
    meaning: { kind: "kind", value: "regular", display: "regular season" },
  },
  ...["all star", "allstar", "all star game", "asg"].map((phrase) => ({
    phrase,
    meaning: { kind: "kind", value: "all-star", display: "All-Star" },
  })),
  ...["if needed", "if necessary"].map((phrase) => ({
    phrase,
    meaning: { kind: "if-needed", display: "if necessary" },
  })),
  ...["win", "wins", "won", "victory", "victories", "beat"].map((phrase) => ({
    phrase,
    meaning: { kind: "outcome", value: "win", display: "wins" },
  })),
  ...["loss", "losses", "lost", "lose", "defeat", "defeats"].map((phrase) => ({
    phrase,
    meaning: { kind: "outcome", value: "loss", display: "losses" },
  })),
  ...["season finale", "finale", "last game of the season", "final game of the season"].map(
    (phrase) => ({
      phrase,
      meaning: { kind: "landmark", value: "finale", display: "season finale" },
    }),
  ),
  ...["all star break", "allstar break", "break"].map((phrase) => ({
    phrase,
    meaning: { kind: "landmark", value: "break" },
  })),
];

const OPENER_PHRASES = [
  "opening night",
  "opener",
  "season opener",
  "opening day",
  "first game of the season",
];
const CUP_PHRASES = ["commissioners cup", "commissioner cup", "cup"];
const DOUBLEHEADER_PHRASES = [
  "doubleheader",
  "doubleheaders",
  "double header",
  "twin bill",
  "twinbill",
];

/**
 * A league's groups of teams: its own, or each of its teams' conferences.
 * @param {SearchTerms} terms
 * @returns {SearchGroup[]}
 */
function listGroups(terms) {
  if (terms.groups) return terms.groups;
  const conferences = [...new Set(terms.teams.map((team) => team.conference))];
  return conferences.map((conference) => ({
    name: conference,
    words: [conference, `${conference}ern`, `${conference}ern conference`, `${conference} teams`],
    codes: terms.teams.filter((team) => team.conference === conference).map((team) => team.code),
  }));
}

// A venue's short name drops the word every venue has, when what's left still names it, as
// "Barclays" does, and one named for a sponsor "at" another place goes by that place too, as
// "Dodger Stadium" does.
const SHORT_VENUE_NAME_LENGTH = 5;

/**
 * The words that name a venue.
 * @param {string} name
 * @param {RegExp} venueWord the word ending a venue's name that every venue shares, like "Arena"
 */
function listVenueWords(name, venueWord) {
  const names = [name, ...name.split(/\s+at\s+/i).slice(1)];
  const shorts = names
    .map((each) => each.replace(venueWord, ""))
    .filter((short) => short.length >= SHORT_VENUE_NAME_LENGTH);
  return [...new Set([...names, ...shorts].map((word) => word.toLowerCase()))];
}

/**
 * A place for each city a season's venues are in that a league's own places don't cover, like a
 * neutral site's, and one for each venue by its own name, like "Barclays" or "Fenway".
 * @param {{ name: string, city: string }[]} venues
 * @param {SearchPlace[]} places the league's own
 * @param {RegExp} venueWord the word ending a venue's name that every venue shares, like "Arena"
 * @returns {SearchPlace[]}
 */
export function listVenuePlaces(venues, places, venueWord) {
  const byName = new Map(venues.map((venue) => [venue.name, venue]));
  const known = new Set(places.flatMap((place) => place.cities));
  const cities = [...new Set([...byName.values()].map((venue) => venue.city))].filter(
    (city) => !known.has(city),
  );
  return [
    ...cities.map((city) => ({ name: city, words: [city.toLowerCase()], cities: [city] })),
    ...[...byName.values()].map(({ name, city }) => ({
      name,
      words: listVenueWords(name, venueWord),
      cities: [city],
      isArena: true,
    })),
  ];
}

/**
 * Each channel a season's games are listed on, once however many names the league lists it by.
 * @param {{ networks?: string[] }[]} games
 * @returns {SearchChannel[]}
 */
export function listSearchChannels(games) {
  /** @type {Map<string, SearchChannel>} */
  const channels = new Map();
  for (const listing of new Set(games.flatMap((game) => game.networks ?? []))) {
    const { name, words } = describeChannel(listing);
    const channel = channels.get(name) ?? { name, words, listings: [] };
    channel.listings.push(listing);
    channels.set(name, channel);
  }
  return [...channels.values()];
}

/**
 * A team's words, each naming it, and the names a suggestion may write for it, each as written.
 * @param {SearchTeam} team
 */
function listTeamEntries(team) {
  const shown = (team.shownNames ?? []).filter((name) => name !== team.name);
  const shownPhrases = new Set(shown.map((name) => name.toLowerCase()));
  const meaning = { kind: "team", value: team.code, display: team.name };
  return [
    ...team.words
      .filter((phrase) => !shownPhrases.has(phrase))
      .map((phrase) => ({ phrase, meaning })),
    ...shown.map((written) => ({
      phrase: written.toLowerCase(),
      meaning: { ...meaning, written },
    })),
  ];
}

/**
 * Every phrase a league's searches know, its own words and the calendar's.
 * @param {SearchTerms} terms
 */
export function createSearchDictionary(terms) {
  return createDictionary([
    ...[...FILLER, ...terms.words.searchFiller].map((phrase) => ({
      phrase,
      meaning: { kind: "filler" },
    })),
    ...GENERAL_ENTRIES,
    ...CALENDAR_ENTRIES,
    ...terms.teams.flatMap(listTeamEntries),
    ...terms.places.flatMap((place) =>
      place.words.map((phrase) => ({
        phrase,
        meaning: { kind: "place", value: place, display: place.name },
      })),
    ),
    ...terms.rounds.flatMap((round) =>
      round.words.map((phrase) => ({
        phrase,
        meaning: { kind: "round", value: round, display: round.name },
      })),
    ),
    ...listGroups(terms).flatMap((group) =>
      group.words.map((phrase) => ({
        phrase,
        meaning: { kind: "group", value: group, display: group.name },
      })),
    ),
    ...(terms.words.crossConference?.words ?? []).map((phrase) => ({
      phrase,
      meaning: { kind: "cross", display: terms.words.crossConference?.name },
    })),
    ...(terms.starters ?? []).flatMap((starter) =>
      starter.words.map((phrase) => ({
        phrase,
        meaning: { kind: "starter", value: starter.id, display: starter.name },
      })),
    ),
    ...(terms.channels ?? []).flatMap((channel) =>
      channel.words.map((phrase) => ({
        phrase,
        meaning: { kind: "channel", value: channel, display: channel.name },
      })),
    ),
    ...terms.words.pastRegulation.words.map((phrase) => ({
      phrase,
      meaning: { kind: "past-regulation", display: terms.words.pastRegulation.name },
    })),
    ...OPENER_PHRASES.map((phrase) => ({
      phrase,
      meaning: { kind: "landmark", value: "opener", display: terms.words.seasonOpener },
    })),
    ...(terms.words.cup ? CUP_PHRASES : []).map((phrase) => ({
      phrase,
      meaning: { kind: "kind", value: "cup", display: terms.words.cup },
    })),
    ...(terms.words.hasDoubleheaders ? DOUBLEHEADER_PHRASES : []).map((phrase) => ({
      phrase,
      meaning: { kind: "doubleheader", display: "doubleheaders" },
    })),
  ]);
}
