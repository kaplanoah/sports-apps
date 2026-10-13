import test from "node:test";
import assert from "node:assert/strict";
import {
  createSearchContext,
  createSearchDictionary,
  describeNoGames,
  describeSearch,
  findSearchGames,
  listSearchChannels,
  listSearchGames,
  readSearch,
} from "../shared/page/game-search.js";
import {
  listExamples,
  listOtherReadings,
  listSuggestions,
} from "../shared/page/search-suggestions.js";
import { isOneEditApart, normalizeText } from "../shared/page/search-words.js";
import { EASTERN, checkInTimeZone, useTimeZone } from "./time-zone.js";

useTimeZone(EASTERN);

// A small league: the Hawks of Riverton and the Foxes of Hillside in the East, and the Owls of
// Lakeside and the Hornets of Bayview in the West. Today is Wednesday, September 30.
/** @type {import("../shared/page/game-search.js").SearchTerms} */
const TERMS = {
  teams: [
    {
      code: "HAW",
      name: "Hawks",
      words: ["hawks", "riverton", "haw"],
      shownNames: ["Riverton Hawks"],
      homeCity: "Riverton",
      conference: "East",
    },
    {
      code: "FOX",
      name: "Foxes",
      words: ["foxes", "hillside", "fox"],
      shownNames: ["Hillside Foxes"],
      homeCity: "Hillside",
      conference: "East",
    },
    {
      code: "OWL",
      name: "Owls",
      words: ["owls", "lakeside", "owl"],
      shownNames: ["Lakeside Owls"],
      homeCity: "Lakeside",
      conference: "West",
    },
    {
      code: "HOR",
      name: "Hornets",
      words: ["hornets", "bayview", "hor"],
      shownNames: ["Bayview Hornets"],
      homeCity: "Bayview",
      conference: "West",
    },
  ],
  places: [
    { name: "Riverton", words: ["riverton"], cities: ["Riverton"] },
    { name: "Lakeside", words: ["lakeside"], cities: ["Lakeside"] },
    { name: "Hillside", words: ["hillside"], cities: ["Hillside"] },
    { name: "Bayview", words: ["bayview"], cities: ["Bayview"] },
    { name: "Vancouver", words: ["vancouver"], cities: ["Vancouver"] },
  ],
  rounds: [
    { round: 1, name: "First Round", words: ["first round"] },
    { round: 3, name: "Finals", words: ["finals"] },
  ],
  words: {
    seasonOpener: "season opener",
    allStar: "All-Star Game",
    cup: "The Cup",
    hasDoubleheaders: false,
    pastRegulation: { name: "Overtime", words: ["overtime", "ot"], games: "overtime games" },
    crossConference: null,
    neverShown: ["postseason", "post season"],
  },
  examples: ["Hawks next game", "Foxes at Owls", "Hornets last game", "Hawks in March"],
};

const NOW = new Date(2026, 8, 30, 12).getTime();

const ARENAS = {
  HAW: { name: "River Arena", city: "Riverton", state: "RV" },
  FOX: { name: "Hill Center", city: "Hillside", state: "HL" },
  OWL: { name: "Lake Hall", city: "Lakeside", state: "LK" },
  HOR: { name: "Bay Dome", city: "Bayview", state: "BV" },
};

/**
 * @param {string} id
 * @param {string} day
 * @param {number | null} minutes
 * @param {string} away
 * @param {string} home
 * @param {Partial<import("../shared/page/game-search.js").SearchGame>} [more]
 * @returns {import("../shared/page/game-search.js").SearchGame}
 */
function makeGame(id, day, minutes, away, home, more = {}) {
  const [year, month, date] = day.split("-").map(Number);
  return {
    id,
    day,
    minutes,
    startMs: new Date(year, month - 1, date, 0, minutes ?? 0).getTime(),
    away,
    home,
    state: day < "2026-09-30" ? "final" : "pre",
    winner: day < "2026-09-30" ? home : null,
    kind: "regular",
    round: null,
    number: null,
    isIfNeeded: false,
    arena: ARENAS[home],
    isNeutral: false,
    game: null,
    ...more,
  };
}

const GAMES = [
  makeGame("g1", "2026-06-11", 19 * 60, "HAW", "OWL"),
  makeGame("g2", "2026-06-20", 13 * 60, "OWL", "HAW", { isPastRegulation: true }),
  makeGame("g3", "2026-07-04", 20 * 60, "HAW", "FOX", {
    isNeutral: true,
    arena: { name: "Coast Arena", city: "Vancouver", state: "BC" },
  }),
  makeGame("g4", "2026-07-10", 19 * 60, "FOX", "HAW", { networks: ["ESPN"] }),
  makeGame("g5", "2026-09-25", 20 * 60 + 30, "OWL", "HAW", {
    kind: "playoffs",
    round: 1,
    number: 1,
  }),
  makeGame("g6", "2026-10-02", 13 * 60, "HOR", "FOX", { networks: ["ESPN"] }),
  makeGame("g7", "2026-10-02", 19 * 60, "OWL", "HAW", {
    kind: "playoffs",
    round: 1,
    number: 2,
    networks: ["ABC", "ESPN"],
  }),
  makeGame("g8", "2026-10-02", null, "FOX", "OWL", { isIfNeeded: true }),
  makeGame("g9", "2026-10-03", 21 * 60, "HAW", "HOR", { networks: ["USA Net"] }),
  makeGame("g10", "2026-10-06", null, "HAW", "OWL", { kind: "playoffs", round: 3, number: 1 }),
  makeGame("g11", "2026-07-04", 20 * 60, "HAW", "HAW", {
    away: null,
    home: null,
    kind: "all-star",
    arena: ARENAS.HOR,
  }),
].sort((first, second) => first.startMs - second.startMs);

TERMS.channels = listSearchChannels(GAMES);

const DICTIONARY = createSearchDictionary(TERMS);

/** @param {number} [now] */
const createContext = (now = NOW) =>
  createSearchContext({ terms: TERMS, dictionary: DICTIONARY, games: GAMES, now });

/**
 * The ids of the games a search finds, and the line under the field.
 * @param {string} text
 * @param {number} [now]
 */
function search(text, now) {
  const context = createContext(now);
  const asked = readSearch(text, context);
  const found = findSearchGames(asked, context);
  const { lead, facts } = describeSearch(asked, found, context);
  return {
    ids: found.games.map((game) => game.id),
    line: [lead, ...facts].join(" | "),
    empty: describeNoGames(asked, context),
  };
}

test("a search's words read without case, accents, or punctuation, with a dash inside a word as a space and between numbers as to", () => {
  assert.equal(normalizeText("  Hawks' @Owls?  "), "hawks @ owls");
  assert.equal(normalizeText("All-Star"), "all star");
  assert.equal(normalizeText("mid-June"), "mid june");
  assert.equal(normalizeText("June 12\u201315"), "june 12 - 15");
  assert.equal(normalizeText("Ren\u00e9e's"), "renee");
});

test("one letter added, dropped, changed, or swapped is one edit, and two aren't", () => {
  assert.ok(isOneEditApart("hawks", "hawsk"));
  assert.ok(isOneEditApart("hawks", "hawk"));
  assert.ok(isOneEditApart("hawks", "hawkes"));
  assert.ok(isOneEditApart("hawks", "hawms"));
  assert.ok(!isOneEditApart("hawks", "hawks"));
  assert.ok(!isOneEditApart("hawks", "hwaks1"));
});

test("two teams find their games either way, and at or @ only the second's home games", () => {
  assert.deepEqual(search("Hawks Owls").ids, ["g1", "g2", "g5", "g7", "g10"]);
  assert.equal(search("Hawks Owls").line, "Hawks vs Owls | 5 games");
  assert.deepEqual(search("Hawks at Owls").ids, ["g1", "g10"]);
  assert.deepEqual(search("Hawks @ Owls").ids, ["g1", "g10"]);
  assert.equal(search("Hawks @ Owls").line, "Hawks @ Owls | 2 games");
  assert.deepEqual(search("Owls vs Hawks").ids, search("Hawks and Owls").ids);
  assert.deepEqual(search("at Owls").ids, ["g1", "g8", "g10"]);
  assert.equal(search("at Owls").line, "Owls at home | 3 games");
});

test("either of two teams, and a team against a conference", () => {
  assert.deepEqual(search("Foxes or Hornets").ids, ["g3", "g4", "g8", "g6", "g9"]);
  assert.equal(search("Foxes or Hornets").line, "Foxes or Hornets | 5 games");
  assert.deepEqual(search("Hawks vs West").ids, ["g1", "g2", "g5", "g7", "g9", "g10"]);
});

test("a city reads as the games played there, alone or after in, with a game where its arena is", () => {
  assert.equal(search("Lakeside").line, "In Lakeside | 3 games");
  assert.deepEqual(search("Lakeside").ids, search("in Lakeside").ids);
  assert.deepEqual(search("Hawks in Lakeside").ids, ["g1", "g10"]);
  assert.equal(search("Hawks in Lakeside").line, "Hawks | In Lakeside | 2 games");
  assert.deepEqual(search("Hawks in Vancouver").ids, ["g3"]);
});

test("home is a team's own arena, so a home game at a neutral site is left out and named", () => {
  assert.deepEqual(search("Hawks at home").ids, ["g2", "g4", "g5", "g7"]);
  assert.deepEqual(search("Foxes at home in July").ids, []);
  assert.equal(
    search("Foxes at home in July").line,
    "Foxes at home | July | No games | 1 in Vancouver left out",
  );
  assert.deepEqual(search("Hawks away").ids, ["g1", "g3", "g9", "g10"]);
});

test("a month or a day finds its games, and a month without any says so", () => {
  assert.deepEqual(search("Hawks in June").ids, ["g1", "g2"]);
  assert.equal(search("Hawks in June").line, "Hawks | June | 2 games");
  assert.deepEqual(search("Hawks June 11").ids, ["g1"]);
  assert.equal(search("Hawks June 11").line, "Hawks | Thu, Jun 11 | 1 game");
  assert.deepEqual(search("6/20").ids, ["g2"]);
  assert.deepEqual(search("Hawks june 10 to 20").ids, ["g1", "g2"]);
  assert.equal(search("Hawks in March").line, "Hawks | March | No games");
  assert.equal(search("Hawks in March").empty, "No Hawks games in March");
  assert.equal(search("Hawks on June 12").empty, "No Hawks games on Fri, Jun 12");
});

// A game without a time comes first on its day, as in the Games list.
test("a weekend runs from Friday at 5 PM to Sunday, counting a Friday game without a time", () => {
  const weekend = search("this weekend");
  assert.deepEqual(weekend.ids, ["g8", "g7", "g9"]);
  assert.equal(weekend.line, "Oct 2\u20134 | 3 games");
  assert.deepEqual(search("Friday").ids, ["g8", "g6", "g7"]);
  assert.deepEqual(search("weekends").ids.includes("g6"), false);
});

test("a day relative to now is the viewer's, wherever they are", () => {
  const lateEastern = new Date("2026-10-02T02:00:00Z").getTime();
  const days = (/** @type {string} */ zone) =>
    checkInTimeZone(zone, () => search("tomorrow", lateEastern).line);
  assert.equal(days("America/Los_Angeles"), "Fri, Oct 2 | 3 games");
  assert.equal(days("Asia/Tokyo"), "Sat, Oct 3 | 1 game");
});

test("a time of day lists a game without a time by date with the rest, and counts it apart", () => {
  const late = search("after 8 pm");
  assert.deepEqual(late.ids, ["g3", "g11", "g5", "g8", "g9", "g10"]);
  assert.equal(late.line, "After 8 PM | 4 games | 2 with no time yet");
  assert.deepEqual(search("Hawks before 2 pm").ids, ["g2", "g10"]);
  assert.deepEqual(search("tonight").ids, []);
});

test("next and last pick from what fits, a game under way counting as next", () => {
  assert.deepEqual(search("Hawks next game").ids, ["g7"]);
  assert.equal(search("Hawks next game").line, "Hawks | Next game");
  assert.deepEqual(search("Hawks last 2").ids, ["g4", "g5"]);
  assert.deepEqual(search("next game").ids, ["g8"]);
  assert.equal(search("next game").line, "Next game");
  const live = GAMES.map((game) =>
    game.id === "g5" ? { ...game, state: /** @type {const} */ ("live") } : game,
  );
  const underWay = createSearchContext({
    terms: TERMS,
    dictionary: DICTIONARY,
    games: live,
    now: NOW,
  });
  const next = findSearchGames(readSearch("Hawks next game", underWay), underWay);
  assert.deepEqual(
    next.games.map((game) => game.id),
    ["g5"],
  );
});

test("playoff words, a game number, if needed, wins, and a season's landmarks", () => {
  assert.deepEqual(search("playoffs").ids, ["g5", "g7", "g10"]);
  assert.deepEqual(search("finals").ids, ["g10"]);
  assert.equal(search("finals").line, "Finals | 1 game");
  assert.deepEqual(search("game 2").ids, ["g7"]);
  assert.deepEqual(search("if needed").ids, ["g8"]);
  assert.deepEqual(search("Hawks wins").ids, ["g2", "g4", "g5"]);
  assert.deepEqual(search("Owls losses").ids, ["g2", "g5"]);
  assert.deepEqual(search("all-star").ids, ["g11"]);
  assert.deepEqual(search("Hawks after the All-Star break").ids, ["g4", "g5", "g7", "g9", "g10"]);
  assert.deepEqual(search("opener").ids, ["g1"]);
});

test("filler is skipped, a name one letter off or a plural is forgiven, and a word it can't use is named", () => {
  assert.deepEqual(search("When do the Hawks play the Owls?").ids, search("Hawks Owls").ids);
  assert.deepEqual(search("Hawsk").ids, search("Hawks").ids);
  assert.equal(
    search("Hawks fireworks").line,
    "Hawks | 8 games | 'fireworks' unrecognized, skipped",
  );
  assert.equal(
    search("Hawks fireworks parade").line,
    "Hawks | 8 games | 'fireworks' and 'parade' unrecognized, skipped",
  );
});

test("a channel finds the games on it, by any name the league lists it by or fans call it", () => {
  assert.deepEqual(search("on ESPN"), {
    ids: ["g4", "g6", "g7"],
    line: "On ESPN | 3 games",
    empty: "No games on ESPN",
  });
  assert.deepEqual(search("ESPN games").ids, ["g4", "g6", "g7"]);
  assert.deepEqual(search("Hawks on ABC"), {
    ids: ["g7"],
    line: "Hawks | On ABC | 1 game",
    empty: "No Hawks games on ABC",
  });
  for (const text of ["USA", "USA Network", "on usa net"])
    assert.deepEqual(search(text).ids, ["g9"], text);
  assert.equal(search("USA Network").line, "On USA Network | 1 game");
  assert.equal(search("Foxes on ABC").empty, "No Foxes games on ABC");
});

test("the league's word for a final past regulation finds those finals", () => {
  assert.deepEqual(search("overtime"), {
    ids: ["g2"],
    line: "Overtime | 1 game",
    empty: "No overtime games",
  });
  assert.deepEqual(search("Hawks OT games").ids, ["g2"]);
  assert.deepEqual(search("Foxes overtime"), {
    ids: [],
    line: "Foxes | Overtime | No games",
    empty: "No Foxes overtime games",
  });
});

test("a cup's name reads with or without the apostrophe's s", () => {
  for (const text of ["Commissioner's Cup", "commissioners cup", "commissioner cup"]) {
    const asked = readSearch(text, createContext());
    assert.deepEqual([asked.kinds, asked.skipped], [["cup"], []], text);
  }
});

test("a search that can use none of its words finds no games, rather than every game", () => {
  assert.deepEqual(search("highest 3p%"), {
    ids: [],
    line: "No results | 'highest' and '3p' unrecognized, skipped",
    empty: "Check the spelling or try a new search",
  });
  assert.deepEqual(search("the highest games").ids, []);
  assert.equal(search("the games").line, "All games | 11 games");
});

/** @param {string} text */
const suggest = (text) =>
  listSuggestions(text, createContext()).map(({ text: suggestion, mark, detail }) =>
    [suggestion, mark.kind === "team" ? mark.code : mark.kind, detail].filter(Boolean).join(" "),
  );

test("a word being typed is finished first, a city before the teams, and the team playing soonest before another that starts the same", () => {
  assert.deepEqual(suggest("Ho"), [
    "Hornets HOR",
    "Hornets next game search",
    "Hornets at home search",
    "home search",
  ]);
  assert.deepEqual(suggest("H"), [
    "Hillside place 1 game",
    "Hornets HOR",
    "Hawks HAW",
    "Hillside Foxes FOX",
  ]);
  assert.deepEqual(suggest("Hil"), ["Hillside place 1 game", "Hillside Foxes FOX"]);
});

test("a whole search fits where the season stands, two at most, and nothing is offered that would find no games", () => {
  assert.deepEqual(suggest("Hawks "), ["Hawks next game search", "Hawks playoffs search"]);
  const finals = GAMES.map((game) => ({
    ...game,
    state: /** @type {const} */ ("final"),
    winner: game.home,
  }));
  const seasonOver = createSearchContext({
    terms: TERMS,
    dictionary: DICTIONARY,
    games: finals,
    now: NOW,
  });
  const done = listSuggestions("Hawks ", seasonOver).map((row) => row.text);
  assert.equal(done[0], "Hawks last game");
  assert.ok(!suggest("Hawks in M").length);
});

test("after in, the places with the most of a team's games, then the season's months; and a date shows its days", () => {
  assert.deepEqual(suggest("Hawks in"), [
    "Hawks in Lakeside place 2 games",
    "Hawks in Bayview place 1 game",
    "Hawks in September date 1 game",
    "Hawks in October date 3 games",
  ]);
  assert.deepEqual(suggest("Hawks this w"), [
    "Hawks this week date Sep 27\u2013Oct 3",
    "Hawks this weekend date Oct 2\u20134",
  ]);
});

test("a date typed whole isn't finished again from its last word", () => {
  assert.deepEqual(suggest("this weekend"), []);
  assert.deepEqual(suggest("Hawks this week"), ["Hawks this weekend date Oct 2\u20134"]);
  assert.deepEqual(suggest("weekend"), ["Weekends date"]);
});

test("the examples offered before typing are those that find a game", () => {
  assert.deepEqual(listExamples(createContext()), ["Hawks next game", "Foxes at Owls"]);
});

test("a city has each of its teams' games as another reading, unless it's after in", () => {
  const context = createContext();
  assert.deepEqual(listOtherReadings("Riverton", context), [
    { text: "Hawks", mark: { kind: "search" }, detail: "8 games" },
  ]);
  assert.deepEqual(
    listOtherReadings("Owls riverton", context).map((reading) => reading.text),
    ["Owls Hawks"],
  );
  assert.deepEqual(listOtherReadings("in Riverton", context), []);
  assert.deepEqual(listOtherReadings("Hawks", context), []);
});

test("the examples fit the room they're given, the first that find a game first", () => {
  assert.deepEqual(listExamples(createContext(), 1), ["Hawks next game"]);
});

test("a league's games are read in order of start, leaving out any without a day, so the season runs from its first to its last", () => {
  const games = [
    { id: "late", startMs: 300 },
    { id: "no-day", startMs: 0 },
    { id: "early", startMs: 100 },
  ];
  const readGame = (/** @type {{ id: string, startMs: number }} */ game) =>
    game.id === "no-day"
      ? null
      : /** @type {any} */ ({ ...game, day: `2026-09-0${game.startMs / 100}` });
  const listed = listSearchGames(games, readGame);
  assert.deepEqual(
    listed.map((game) => game.id),
    ["early", "late"],
  );
  const context = createSearchContext({
    terms: TERMS,
    dictionary: createSearchDictionary(TERMS),
    games: listed,
    now: Date.parse("2026-09-30T16:00:00Z"),
  });
  assert.deepEqual([context.seasonStart, context.seasonEnd], ["2026-09-01", "2026-09-03"]);
});
