import test from "node:test";
import assert from "node:assert/strict";
import {
  createSearchContext,
  createSearchDictionary,
  describeNoGames,
  describeSearch,
  findSearchGames,
  readSearch,
} from "../shared/page/game-search.js";
import { listSuggestions } from "../shared/page/search-suggestions.js";
import { EASTERN, useTimeZone } from "./time-zone.js";

useTimeZone(EASTERN);

// A league of two leagues, as baseball is: the Gray Sox and the Pilots in the North League, the Gray
// Sox alone in its East division, and the Blue Sox and the Comets in the South League. Both Sox play
// in Northport. Each league has its own championship series, and starters are named ahead. Today is
// Wednesday, September 30.
/** @type {import("../shared/page/game-search.js").SearchTerms} */
const TERMS = {
  teams: [
    {
      code: "GRY",
      name: "Gray Sox",
      words: ["gray sox", "sox", "northport", "gry"],
      homeCity: "Northport",
      conference: "NL",
    },
    {
      code: "BLU",
      name: "Blue Sox",
      words: ["blue sox", "sox", "northport", "blu"],
      homeCity: "Northport",
      conference: "SL",
    },
    {
      code: "PIL",
      name: "Pilots",
      words: ["pilots", "southport", "pil"],
      homeCity: "Southport",
      conference: "NL",
    },
    {
      code: "COM",
      name: "Comets",
      words: ["comets", "eastport", "com"],
      homeCity: "Eastport",
      conference: "SL",
    },
  ],
  places: [
    { name: "Northport", words: ["northport"], cities: ["Northport"] },
    { name: "Southport", words: ["southport"], cities: ["Southport"] },
    { name: "Eastport", words: ["eastport"], cities: ["Eastport"] },
    { name: "London", words: ["london"], cities: ["London"] },
  ],
  groups: [
    { name: "NL", words: ["nl", "north league"], codes: ["GRY", "PIL"] },
    { name: "SL", words: ["sl", "south league"], codes: ["BLU", "COM"] },
    { name: "NL East", words: ["nl east"], codes: ["GRY"] },
  ],
  rounds: [
    { round: 3, name: "NLCS", words: ["nlcs"], conference: "NL" },
    { round: 3, name: "SLCS", words: ["slcs"], conference: "SL" },
    { round: 3, name: "LCS", words: ["lcs"] },
  ],
  starters: [
    { id: "p1", name: "Ace Jones", words: ["ace jones", "jones"] },
    { id: "p2", name: "Bo Smith", words: ["bo smith", "smith"] },
    { id: "p3", name: "Cy Smith", words: ["cy smith", "smith"] },
  ],
  words: {
    seasonOpener: "Opening Day",
    allStar: "All-Star Game",
    cup: null,
    hasDoubleheaders: true,
    pastRegulation: {
      name: "Extra innings",
      words: ["extra innings"],
      games: "extra-inning games",
    },
    crossConference: { name: "Interleague", words: ["interleague"] },
    neverShown: ["postseason"],
    reminderAtStart: "At scheduled first pitch",
    reminderTiming: "Time before game",
    notificationUpdates: "Game updates",
    seasonSpansYears: false,
    searchFiller: ["pitching", "starter"],
  },
  examples: [],
};

const NOW = new Date(2026, 8, 30, 12).getTime();

const PARKS = {
  GRY: { name: "North Field", city: "Northport", state: "NP" },
  BLU: { name: "Blue Park", city: "Northport", state: "NP" },
  PIL: { name: "Pilot Park", city: "Southport", state: "SP" },
  COM: { name: "Comet Yard", city: "Eastport", state: "EP" },
};

/**
 * A game, with its start on the viewer's clock, in hours and minutes.
 * @param {string} id
 * @param {string} day
 * @param {number} hours
 * @param {string} away
 * @param {string} home
 * @param {Partial<import("../shared/page/game-search.js").SearchGame>} [more]
 * @returns {import("../shared/page/game-search.js").SearchGame}
 */
function makeGame(id, day, hours, away, home, more = {}) {
  const [year, month, date] = day.split("-").map(Number);
  const minutes = Math.round(hours * 60);
  return {
    id,
    day,
    minutes,
    localMinutes: minutes,
    startMs: new Date(year, month - 1, date, 0, minutes).getTime(),
    away,
    home,
    state: day < "2026-09-30" ? "final" : "pre",
    winner: day < "2026-09-30" ? home : null,
    kind: "regular",
    round: null,
    number: null,
    isIfNeeded: false,
    arena: PARKS[home],
    isNeutral: false,
    game: null,
    ...more,
  };
}

const ACE = { id: "p1", name: "Jones" };
const BO = { id: "p2", name: "Smith" };
const CY = { id: "p3", name: "Smith" };

const GAMES = [
  // A 1:05 PM start out west is a day game there and a 4:05 PM one on the viewer's clock.
  makeGame("b1", "2026-06-01", 16 + 1 / 12, "GRY", "PIL", {
    localMinutes: 13 * 60 + 5,
    starters: [ACE, BO],
  }),
  makeGame("b2", "2026-06-02", 19 + 1 / 6, "BLU", "GRY", { starters: [CY] }),
  makeGame("b3", "2026-06-03", 13 + 1 / 6, "COM", "PIL", {
    localMinutes: 10 * 60 + 10,
    isDoubleheader: true,
    starters: [BO],
  }),
  makeGame("b4", "2026-06-03", 19 + 1 / 6, "COM", "PIL", { isDoubleheader: true }),
  // A night game in London starts in the afternoon on the viewer's clock.
  makeGame("b5", "2026-06-20", 14 + 1 / 6, "GRY", "BLU", {
    localMinutes: 19 * 60 + 10,
    isNeutral: true,
    arena: { name: "London Stadium", city: "London", state: "" },
  }),
  makeGame("b6", "2026-10-02", 19, "GRY", "PIL", {
    kind: "playoffs",
    round: 3,
    conference: "NL",
    starters: [ACE],
  }),
  makeGame("b7", "2026-10-03", 19, "BLU", "COM", { kind: "playoffs", round: 3, conference: "SL" }),
  makeGame("b8", "2026-10-05", 19, "PIL", "GRY", { kind: "playoffs", round: 3, conference: "NL" }),
].sort((first, second) => first.startMs - second.startMs);

const CONTEXT = createSearchContext({
  terms: TERMS,
  dictionary: createSearchDictionary(TERMS),
  games: GAMES,
  now: NOW,
});

/**
 * The ids of the games a search finds, the line under the field, and what an empty list says.
 * @param {string} text
 */
function search(text) {
  const asked = readSearch(text, CONTEXT);
  const found = findSearchGames(asked, CONTEXT);
  const { lead, facts } = describeSearch(asked, found, CONTEXT);
  return {
    ids: found.games.map((game) => game.id),
    line: [lead, ...facts].join(" | "),
    empty: describeNoGames(asked, CONTEXT),
  };
}

test("a word two teams share finds both teams' games, and a city two teams share reads as the place", () => {
  assert.deepEqual(search("Sox"), {
    ids: ["b1", "b2", "b5", "b6", "b7", "b8"],
    line: "Gray Sox or Blue Sox | 6 games",
    empty: "No Gray Sox or Blue Sox games",
  });
  assert.deepEqual(search("Sox at Pilots").ids, ["b1", "b6"]);
  assert.deepEqual(search("Northport").ids, ["b2", "b8"]);
  assert.equal(search("Northport").line, "In Northport | 2 games");
  assert.deepEqual(search("Blue Sox at home"), {
    ids: [],
    line: "Blue Sox at home | No games | 1 in London left out",
    empty: "No Blue Sox home games",
  });
});

test("a league or a division names its teams, and a game between the leagues is interleague", () => {
  assert.equal(search("SL teams").line, "SL teams | 5 games");
  assert.deepEqual(search("Pilots vs North League").ids, ["b1", "b6", "b8"]);
  assert.deepEqual(search("Comets vs NL East").ids, []);
  assert.deepEqual(search("interleague"), {
    ids: ["b2", "b3", "b4", "b5"],
    line: "Interleague | 4 games",
    empty: "No games",
  });
});

test("a round that is one league's own finds only that league's series, and the round's own name finds both", () => {
  assert.deepEqual(search("NLCS").ids, ["b6", "b8"]);
  assert.equal(search("NLCS").line, "NLCS | 2 games");
  assert.deepEqual(search("SLCS").ids, ["b7"]);
  assert.deepEqual(search("LCS").ids, ["b6", "b7", "b8"]);
});

test("a starter's name finds the games he starts, his next once it's announced, and a name two share finds both", () => {
  assert.deepEqual(search("Jones"), {
    ids: ["b1", "b6"],
    line: "Ace Jones | 2 starts",
    empty: "No Ace Jones starts",
  });
  assert.deepEqual(search("Jones next start").ids, ["b6"]);
  assert.equal(search("Jones next start").line, "Ace Jones | Next start");
  assert.deepEqual(search("Ace Jones vs Pilots").ids, ["b1", "b6"]);
  assert.equal(search("Ace Jones vs Pilots").line, "Ace Jones | vs Pilots | 2 starts");
  assert.deepEqual(search("Smith").ids, ["b1", "b2", "b3"]);
  assert.equal(search("Smith").line, "Bo Smith or Cy Smith | 3 starts");
  assert.deepEqual(search("Bo Smith next start"), {
    ids: [],
    line: "Bo Smith | Next start | Not yet announced",
    empty: "Bo Smith's next start isn't announced yet",
  });
});

test("a league's own words for nothing a game has, like baseball's pitching, are passed over", () => {
  assert.deepEqual(search("Jones pitching"), search("Jones"));
  assert.deepEqual(search("who's the Pilots starter"), search("Pilots"));
});

test("day and night games go by the clock where they're played", () => {
  assert.deepEqual(search("day games"), {
    ids: ["b1", "b3"],
    line: "Day games | 2 games",
    empty: "No games",
  });
  assert.deepEqual(search("night games").ids, ["b2", "b4", "b5", "b6", "b7", "b8"]);
  assert.deepEqual(search("afternoon").ids, ["b1", "b3", "b5"]);
});

test("doubleheaders find each game of one", () => {
  assert.deepEqual(search("Comets doubleheader"), {
    ids: ["b3", "b4"],
    line: "Comets | Doubleheaders | 2 games",
    empty: "No Comets games",
  });
});

test("a starter's name typed is finished, with his next and last starts", () => {
  assert.deepEqual(
    listSuggestions("Jon", CONTEXT).map((row) => row.text),
    ["Jones", "Ace Jones next start", "Ace Jones last start"],
  );
});
