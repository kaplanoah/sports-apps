import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSearchContext,
  createSearchDictionary,
  describeNoGames,
  describeSearch,
  findSearchGames,
  readSearch,
} from "#shared/game-search.js";
import { findPages } from "#shared/page-search.js";
import { listExamples, listOtherReadings, listSuggestions } from "#shared/search-suggestions.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { listSeasonGames } from "../page/js/games-view.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGame } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";

useTimeZone(EASTERN);

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
// The whole season's schedule, from the next day's recording.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);

// The afternoon's season, with the whole season's games as the Games list has them.
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });
const SCHEDULE = buildSnapshot(
  { ...AFTERNOON.responses, schedule: GAMES.preview.schedule },
  { season: 2026, now: NOW },
).schedule;
const SEASON_GAMES = listSeasonGames(SEASON, { games: SCHEDULE });
const TERMS = createSearchTerms({ games: SEASON_GAMES, standings: SEASON.standings });
const CONTEXT = createSearchContext({
  terms: TERMS,
  dictionary: createSearchDictionary(TERMS),
  games: SEASON_GAMES.map(readSearchGame).filter(Boolean),
  now: NOW,
});

/**
 * Each game a search finds, as its day and its teams, and the line under the field.
 * @param {string} text
 */
function search(text) {
  const asked = readSearch(text, CONTEXT);
  const found = findSearchGames(asked, CONTEXT);
  const { lead, facts } = describeSearch(asked, found, CONTEXT);
  return {
    games: found.games.map((game) => `${game.day} ${game.away ?? "TBD"} at ${game.home ?? "TBD"}`),
    line: [lead, ...facts].join(" | "),
    empty: describeNoGames(asked, CONTEXT),
  };
}

test("two teams find every game between them, and at only those in the second's arena", () => {
  assert.deepEqual(search("Liberty Dream"), {
    games: ["2026-06-11 NYL at ATL", "2026-09-21 ATL at NYL", "2026-09-23 ATL at NYL"],
    line: "Liberty vs Dream | 3 games",
    empty: "No Liberty vs Dream games",
  });
  assert.deepEqual(search("Liberty @ Dream").games, ["2026-06-11 NYL at ATL"]);
  assert.deepEqual(search("Liberty at Dream").games, ["2026-06-11 NYL at ATL"]);
  assert.equal(search("Liberty at Dream").line, "Liberty @ Dream | 1 game");
});

test("in a city, as its team's arena or a nickname for it names it", () => {
  assert.deepEqual(search("Liberty in San Francisco").games, ["2026-06-28 NYL at GSV"]);
  assert.deepEqual(search("Dream in NY").games, ["2026-09-21 ATL at NYL", "2026-09-23 ATL at NYL"]);
  assert.equal(search("Dream in NY").line, "Dream | In New York | 2 games");
  assert.deepEqual(search("Dream in Brooklyn").games, search("Dream in NY").games);
  assert.equal(search("Barclays").line, "In Barclays Center | 26 games");
});

test("a month the season isn't played in finds nothing, and says so", () => {
  assert.equal(search("Liberty in March").line, "Liberty | March | No games");
  assert.equal(search("Liberty in March").empty, "No Liberty games in March");
});

test("next game is the one on now or next, even before its opponent is known", () => {
  assert.deepEqual(search("Liberty next game"), {
    games: ["2026-10-04 NYL at TBD"],
    line: "Liberty | Next game",
    empty: "No Liberty games",
  });
});

test("nicknames, cities, and filler words read as a fan would mean them", () => {
  assert.equal(search("When do the Libs play Vegas?").line, "Liberty vs Aces | 4 games");
  assert.deepEqual(search("New York Valks").games, search("Liberty Valkyries").games);
  assert.equal(search("Liberyt").line, "Liberty | 52 games");
});

test("dates relative to now read as the days they cover, a weekend from Friday evening", () => {
  assert.deepEqual(search("Liberty this weekend"), {
    games: ["2026-10-04 NYL at TBD"],
    line: "Liberty | Oct 2\u20134 | 1 game",
    empty: "No Liberty games Oct 2\u20134",
  });
  assert.equal(search("Games this weekend").line, "Oct 2\u20134 | 4 games");
  assert.equal(search("Games tomorrow").line, "Thu, Oct 1 | 1 game");
  assert.equal(search("Liberty June 11").line, "Liberty | Thu, Jun 11 | 1 game");
  assert.equal(search("Liberty in June").line, "Liberty | June | 12 games");
});

test("a time of day counts this week's games without a time yet apart, listing them by date", () => {
  const late = search("Games after 8 PM this week");
  assert.equal(late.line, "After 8 PM | Sep 27\u2013Oct 3 | 4 games | 2 with no time yet");
  assert.deepEqual(late.games, [
    "2026-09-27 DAL at GSV",
    "2026-09-29 MIN at NYL",
    "2026-09-30 GSV at DAL",
    "2026-10-01 IND at LVA",
    "2026-10-02 DAL at GSV",
    "2026-10-02 WAS at ATL",
  ]);
});

test("a word it can't use is named on the line", () => {
  assert.equal(
    search("Liberty fireworks").line,
    "Liberty | 52 games | 'fireworks' unrecognized, skipped",
  );
});

test("a search for a stat's leaders, which search can't read, finds no games", () => {
  assert.deepEqual(search("highest three point"), {
    games: [],
    line: "No results | 'highest', 'three', and 'point' unrecognized, skipped",
    empty: "Check the spelling or try a new search",
  });
  assert.deepEqual(listPages("highest 3p%").rows, []);
});

test("every team has its arena's city and its conference from the standings, and a playoff round its league name", () => {
  assert.ok(TERMS.teams.every((team) => team.homeCity && team.conference));
  assert.deepEqual(
    TERMS.teams
      .filter((team) => team.conference === "East")
      .map((team) => team.code)
      .sort(),
    ["ATL", "CHI", "CON", "IND", "NYL", "TOR", "WAS"],
  );
  assert.equal(search("semis").line, "Semifinals | 10 games");
  assert.equal(search("all-star").line, "All-Star Game | 1 game");
});

test("an arena city no place covers becomes a place of its own", () => {
  const neutral = SEASON_GAMES.map((game) =>
    game.id === "1042600102"
      ? {
          ...game,
          isNeutral: true,
          arena: { name: "Rogers Arena", city: "Vancouver", state: "BC" },
        }
      : game,
  );
  const terms = createSearchTerms({ games: neutral, standings: SEASON.standings });
  assert.ok(terms.places.some((place) => place.name === "Vancouver" && !place.isArena));
  assert.ok(terms.places.some((place) => place.name === "Rogers Arena" && place.isArena));
});

test("the examples before typing and the suggestions as you type each find games, with two whole searches at most", () => {
  assert.deepEqual(listExamples(CONTEXT), [
    "Dream at Valkyries",
    "Aces in New York",
    "Games this weekend",
    "Finals",
    "Liberty last game",
  ]);
  const texts = (/** @type {string} */ text) =>
    listSuggestions(text, CONTEXT).map((row) => row.text);
  assert.deepEqual(texts("Lib"), ["Liberty", "Liberty next game", "Liberty playoffs"]);
  assert.deepEqual(texts("Liberty th"), [
    "Liberty this week",
    "Liberty this weekend",
    "Liberty this month",
    "Liberty the past week",
  ]);
  assert.deepEqual(texts("Dream in"), [
    "Dream in Washington",
    "Dream in New York",
    "Dream in September",
    "Dream in October",
  ]);
});

// A few players as the store's list of the season's players has them.
const INDEX = {
  players: [
    { id: "1627668", team: "NYL", number: "30", firstName: "Breanna", lastName: "Stewart" },
    { id: "1628932", team: "LVA", number: "22", firstName: "A\u2019ja", lastName: "Wilson" },
  ],
};

/**
 * The page's teams, players, and places, with settings showing all but the Season picker, as on a
 * page whose store keeps one season.
 * @param {string} text
 */
function listPages(text) {
  const pages = listSearchPages({
    index: INDEX,
    isSettingShown: (key) => key !== "settings:season",
  });
  const { rows, gameText } = findPages(text, {
    dictionary: CONTEXT.dictionary,
    pages,
    isTyping: false,
  });
  return {
    rows: rows.map((row) => {
      if (row.kind === "place") return row.place.name.join(" ");
      if (row.kind === "player") return `${row.player.firstName} ${row.player.lastName}`;
      if (row.kind === "game-part") return `${row.part.name} of ${row.gameText ?? "the season"}`;
      return row.kind === "team" ? row.team.fullName : `${row.team.fullName} Roster`;
    }),
    gameText,
    others: listOtherReadings(text, CONTEXT).map(
      (reading) => `${reading.text} (${reading.detail})`,
    ),
  };
}

test("a team's name lists its sheet and its Roster, by any name a search of games knows it by", () => {
  for (const text of ["Liberty", "NYL", "libs", "New York Liberty"])
    assert.deepEqual(listPages(text).rows, ["New York Liberty", "New York Liberty Roster"], text);
  assert.deepEqual(listPages("Aces roster").rows, ["Las Vegas Aces Roster"]);
});

test("a player's name lists her sheet, by her name without its accents or apostrophe", () => {
  assert.deepEqual(listPages("Stewart"), {
    rows: ["Breanna Stewart"],
    gameText: null,
    others: [],
  });
  assert.deepEqual(listPages("aja wilson").rows, ["A\u2019ja Wilson"]);
});

test("New York reads as the Liberty, with the games played in New York its other reading", () => {
  const newYork = listPages("New York");
  assert.deepEqual(newYork.rows, ["New York Liberty", "New York Liberty Roster"]);
  assert.deepEqual(newYork.others, ["Games in New York (26 games)"]);
});

test("the Standings lists and settings are found by their words, and only the settings shown", () => {
  assert.deepEqual(listPages("standings").rows, [
    "Standings League",
    "Standings East",
    "Standings West",
  ]);
  assert.deepEqual(listPages("east").rows, ["Standings East"]);
  assert.equal(listPages("east").gameText, "east");
  assert.deepEqual(listPages("dark mode").rows, ["Settings Appearance"]);
  assert.deepEqual(listPages("athletic").rows, ["Settings Include content from The Athletic"]);
  assert.deepEqual(listPages("season").rows, []);
});

test("a word a search of games passes over, as season, still finds its setting, and no games", () => {
  const pages = listSearchPages({ index: INDEX, isSettingShown: () => true });
  const found = findPages("season", { dictionary: CONTEXT.dictionary, pages, isTyping: false });
  assert.deepEqual(
    found.rows.map((row) => (row.kind === "place" ? row.place.key : row.kind)),
    ["settings:season"],
  );
  assert.equal(found.gameText, null);
});

test("the Bracket and News tabs are found by their words, the Bracket beside the playoffs' games", () => {
  assert.deepEqual(listPages("bracket"), { rows: ["Bracket"], gameText: null, others: [] });
  assert.deepEqual(listPages("playoffs").rows, ["Bracket"]);
  assert.equal(listPages("playoffs").gameText, "playoffs");
  assert.deepEqual(listPages("news").rows, [
    "News",
    "Settings Include dedicated Liberty sources",
    "Settings Include content from The Athletic",
  ]);
});

test("Highlights are found for the latest final of the season, or of the games the other words find", () => {
  assert.deepEqual(listPages("highlights").rows, ["Highlights of the season"]);
  assert.deepEqual(listPages("Liberty highlights").rows, ["Highlights of liberty"]);
  assert.deepEqual(listPages("Liberty Lynx recap").rows, ["Highlights of liberty lynx"]);
  assert.equal(listPages("highlights").gameText, null);
});

test("the examples are three searches for games, then a player and a team's Roster", () => {
  const { examples } = listSearchPages({ index: INDEX, isSettingShown: () => true });
  assert.deepEqual(
    [...listExamples(CONTEXT, 5 - examples.length), ...examples],
    ["Dream at Valkyries", "Aces in New York", "Games this weekend", "Stewart", "Aces roster"],
  );
});

// Every tab, sheet, sheet section, and setting the page has, and what search does with it: the
// search that lists a row opening it, the search of games that finds it, or why search leaves it
// out. A new one fails the test below until it's here, so it's made searchable, or left out on
// purpose.
const COVERAGE = {
  "tab:bracket": { search: "bracket", opens: "tab:bracket" },
  "tab:games": { leftOut: "Typing games already searches every game" },
  "tab:standings": { search: "standings", opens: "standings:league" },
  "tab:news": { search: "news", opens: "tab:news" },
  "tab:search": { leftOut: "It's the search itself" },
  "dialog:settingsDialog": { search: "settings", opens: "settings" },
  "dialog:sheetDialog": { leftOut: "It holds the sheets, each listed on its own" },
  "sheet:gameSheet": { games: "Liberty at Lynx" },
  "section:game": { games: "Liberty at Lynx" },
  "section:highlights": { search: "highlights", opens: "highlights" },
  "sheet:teamSheet": { search: "Liberty", opens: "team" },
  "section:team": { search: "Liberty", opens: "team" },
  "section:roster": { search: "Liberty roster", opens: "roster" },
  "sheet:playerSheet": { search: "Stewart", opens: "player" },
  "settings:season": { search: "season", opens: "settings:season" },
  "settings:notifications": { search: "notifications", opens: "settings:notifications" },
  "settings:team-outlets": { search: "dedicated sources", opens: "settings:team-outlets" },
  "settings:paywalled": { search: "the athletic", opens: "settings:paywalled" },
  "settings:appearance": { search: "dark mode", opens: "settings:appearance" },
  "settings:home-screen": {
    leftOut: "Shows only in a phone's browser, whose bar at the top also asks to add the page",
  },
  "settings:diagnostics": { search: "diagnostics", opens: "settings:diagnostics" },
};

/** The page's tabs, dialogs, sheets, sheet sections, and settings, as its markup names them. */
function listPagePlaces() {
  const page = readFileSync(`${import.meta.dirname}/../page/index.html`, "utf8");
  const tabBar = page.slice(page.indexOf('<nav class="tabs">'), page.indexOf("</nav>"));
  const sheets = page.slice(page.indexOf('<dialog id="sheetDialog"'));
  const listMatches = (/** @type {string} */ text, /** @type {RegExp} */ pattern) =>
    [...text.matchAll(pattern)].map(([, key]) => key);
  return [
    ...listMatches(tabBar, /data-tab="([^"]+)"/g).map((key) => `tab:${key}`),
    ...listMatches(page, /<dialog id="([^"]+)"/g).map((id) => `dialog:${id}`),
    ...listMatches(sheets, /<section\s+id="([^"]+)"\s+class="sheet-page[\s"]/g).map(
      (id) => `sheet:${id}`,
    ),
    ...listMatches(sheets, /data-tab="([^"]+)"/g).map((key) => `section:${key}`),
    ...listMatches(page, /data-setting="([^"]+)"/g),
  ];
}

/**
 * What a search's row opens, by the key a place has, or the kind of sheet or section.
 * @param {import("#shared/page-search.js").PageRow} row
 */
function nameOpened(row) {
  if (row.kind === "place") return row.place.key;
  if (row.kind === "game-part") return row.part.key;
  if (row.kind === "section") return "roster";
  return row.kind;
}

test("every tab, sheet, section, and setting says what search does with it", () => {
  assert.deepEqual(
    listPagePlaces().sort(),
    Object.keys(COVERAGE).sort(),
    "Make each new place searchable in search-pages.js, or say why not, in COVERAGE",
  );
});

test("every setting's row names the place a search opens", () => {
  const page = readFileSync(`${import.meta.dirname}/../page/index.html`, "utf8");
  const rows = [...page.matchAll(/<\w+\s+class="control-row[^>]*>/g)].map(([row]) => row);
  assert.deepEqual(
    rows.filter((row) => !row.includes("data-setting=")),
    [],
  );
});

test("each place search opens is listed by its search, and each game by a search of games", () => {
  const pages = listSearchPages({ index: INDEX, isSettingShown: () => true });
  for (const [place, coverage] of Object.entries(COVERAGE)) {
    if ("search" in coverage) {
      const { rows } = findPages(coverage.search, {
        dictionary: CONTEXT.dictionary,
        pages,
        isTyping: false,
      });
      assert.ok(rows.map(nameOpened).includes(coverage.opens), place);
    }
    if ("games" in coverage)
      assert.ok(
        findSearchGames(readSearch(coverage.games, CONTEXT), CONTEXT).games.length > 0,
        place,
      );
  }
});
