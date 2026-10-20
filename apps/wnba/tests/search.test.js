import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSearchContext,
  createSearchDictionary,
  describeNoGames,
  describeSearch,
  findSearchGames,
  listSearchGames,
  readSearch,
} from "#shared/game-search.js";
import { findPages } from "#shared/page-search.js";
import { listExamples, listOtherReadings, listSuggestions } from "#shared/search-suggestions.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { listSeasonGames } from "../page/js/games-view.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGame } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeOvertimes } from "../worker/src/overtimes.js";

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
  games: listSearchGames(SEASON_GAMES, (game) => readSearchGame(game, null)),
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
  assert.equal(search("When do the NY Liberty play the Aces?").line, "Liberty vs Aces | 4 games");
  assert.deepEqual(search("NY Liberty Valks").games, search("Liberty Valkyries").games);
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

test("postseason finds the playoffs but is offered as playoffs, and a doubleheader reads as nothing", () => {
  const texts = (/** @type {string} */ text) =>
    listSuggestions(text, CONTEXT).map((row) => row.text);
  assert.deepEqual(texts("post"), ["playoffs"]);
  assert.match(search("postseason").line, /^Playoffs \| /);
  assert.match(search("opener").line, /^Season opener \| /);
  assert.match(search("if necessary").line, /^If necessary \| /);
  assert.deepEqual(readSearch("doubleheader", CONTEXT).skipped, ["doubleheader"]);
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
      if (row.kind === "place")
        return [row.place.name.join(" "), row.detail].filter(Boolean).join(", ");
      if (row.kind === "player") return `${row.player.firstName} ${row.player.lastName}`;
      if (row.kind === "game-part") return `${row.part.name} of ${row.gameText ?? "the season"}`;
      if (row.kind === "story") return `Story: ${row.story.title}`;
      return row.kind === "team" ? row.team.fullName : `${row.team.fullName} Roster`;
    }),
    gameText,
    others: listOtherReadings(text, CONTEXT).map(
      (reading) => `${reading.text} (${reading.detail})`,
    ),
  };
}

test("a team's name lists its sheet and its Roster, by any name a search of games knows it by", () => {
  for (const text of ["Liberty", "NYL", "ny liberty", "New York Liberty"])
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

test("New York reads as the games played in New York, with the Liberty's its other reading", () => {
  const newYork = listPages("New York");
  assert.deepEqual(newYork.rows, ["New York Liberty", "New York Liberty Roster"]);
  assert.deepEqual(newYork.others, ["Liberty (52 games)"]);
  assert.equal(search("New York").line, "In New York | 26 games");
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

test("the Bracket and News tabs are found by their words, the Bracket and the league's standings beside the playoffs' games", () => {
  assert.deepEqual(listPages("bracket"), { rows: ["Bracket"], gameText: null, others: [] });
  assert.deepEqual(listPages("playoffs").rows, ["Bracket", "Standings League"]);
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
  "tab:bracket-standings": { search: "bracket", opens: "season:bracket" },
  "tab:games": { leftOut: "Typing games already searches every game" },
  "tab:news": { search: "news", opens: "tab:news" },
  "tab:search": { leftOut: "It's the search itself" },
  "dialog:settingsDialog": { search: "settings", opens: "settings" },
  "dialog:sheetDialog": { leftOut: "It holds the sheets, each listed on its own" },
  "dialog:homeScreenWelcome": {
    leftOut:
      "It shows once, before the page is added, and the box at the bottom of Settings keeps its steps",
  },
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
    leftOut:
      "Shows only in a phone's or tablet's browser, at the bottom of Settings, which search finds",
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

// The afternoon's season with where ESPN listed each game, and which finals went to overtime, from
// the season's recorded team logs.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-02-espn-scoreboard.json`, "utf8"),
);
const PLAYERS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-players.json`, "utf8"),
);
const LISTED = buildSnapshot(
  { ...AFTERNOON.responses, networks: Object.values(ESPN_SCOREBOARD.answers) },
  { season: 2026, now: NOW },
);
const LISTED_GAMES = listSeasonGames(LISTED, { games: SCHEDULE });
const OVERTIMES = describeOvertimes(2026, [
  PLAYERS.teamGames["2026:Regular Season"],
  PLAYERS.teamGames["2026:Playoffs"],
]).games;
const LISTED_TERMS = createSearchTerms({ games: LISTED_GAMES, standings: LISTED.standings });
const LISTED_CONTEXT = createSearchContext({
  terms: LISTED_TERMS,
  dictionary: createSearchDictionary(LISTED_TERMS),
  games: listSearchGames(LISTED_GAMES, (game) => readSearchGame(game, OVERTIMES)),
  now: NOW,
});

/**
 * Each game a search of the listed season finds, as its day and its teams, and the line.
 * @param {string} text
 */
function searchListed(text) {
  const asked = readSearch(text, LISTED_CONTEXT);
  const found = findSearchGames(asked, LISTED_CONTEXT);
  const { lead, facts } = describeSearch(asked, found, LISTED_CONTEXT);
  return {
    games: found.games.map((game) => `${game.day} ${game.away ?? "TBD"} at ${game.home ?? "TBD"}`),
    line: [lead, ...facts].join(" | "),
  };
}

test("a channel finds the games ESPN lists on it, by any name fans call it", () => {
  assert.deepEqual(searchListed("on ESPN"), {
    games: ["2026-09-30 ATL at WAS", "2026-09-30 GSV at DAL"],
    line: "On ESPN | 2 games",
  });
  assert.deepEqual(searchListed("Fever on USA").games, ["2026-10-01 IND at LVA"]);
  assert.deepEqual(searchListed("Prime").games, ["2026-09-27 WAS at ATL", "2026-09-29 LVA at IND"]);
});

test("overtime finds the finals the season's team logs say went past 40 minutes", () => {
  const { games, line } = searchListed("overtime");
  assert.equal(games.length, Object.keys(OVERTIMES).length);
  assert.equal(line, `Overtime | ${games.length} games`);
  assert.ok(searchListed("Liberty OT").games.length < games.length);
});

const PLAYERS_OUT = {
  players: [
    { id: "1627668", team: "NYL", number: "30", firstName: "Breanna", lastName: "Stewart" },
    {
      id: "1628276",
      team: "NYL",
      number: "20",
      firstName: "Satou",
      lastName: "Sabally",
      out: { reason: "Concussion", isForSeason: true },
    },
    {
      id: "1629477",
      team: "ATL",
      number: "15",
      firstName: "Allisha",
      lastName: "Gray",
      out: { reason: "Left hand", isForSeason: false },
    },
  ],
};
const STORIES = [
  {
    id: "liberty-1",
    url: "https://example.com/liberty-1",
    title: "Liberty win Game 2",
    summary: "",
    author: "",
    outlet: "The IX",
    source: "ix",
    publishedAt: "2026-09-30T02:00:00Z",
    photo: null,
    teams: ["NYL", "MIN"],
  },
  {
    id: "dream-1",
    url: "https://example.com/dream-1",
    title: "Dream take Game 1",
    summary: "",
    author: "",
    outlet: "ESPN",
    source: "espn",
    publishedAt: "2026-09-29T02:00:00Z",
    photo: null,
    teams: ["ATL"],
  },
];

/**
 * What search lists for the season's pages, with players out and the News tab's stories.
 * @param {string} text
 */
function findListedPages(text) {
  const pages = listSearchPages({
    index: PLAYERS_OUT,
    isSettingShown: () => true,
    standings: LISTED.standings,
    stories: STORIES,
  });
  return findPages(text, { dictionary: LISTED_CONTEXT.dictionary, pages, isTyping: false });
}

test("who is out lists each player out, and a player named with an injury says she's out", () => {
  const names = (/** @type {string} */ text) =>
    findListedPages(text).rows.map((row) =>
      row.kind === "player" ? row.player.lastName : row.kind,
    );
  assert.deepEqual(names("who is out"), ["Gray", "Sabally"]);
  assert.deepEqual(names("Liberty injuries"), ["Sabally"]);
  assert.deepEqual(names("Sabally injury"), ["Sabally"]);
  assert.deepEqual(names("Stewart injury"), ["Stewart"]);
});

test("every team's row has its record, and its record's words list it over its games", () => {
  const found = findListedPages("Liberty record");
  assert.deepEqual(
    found.rows.map((row) => (row.kind === "team" ? row.team.record : row.kind)),
    ["26-18", "section"],
  );
  assert.equal(found.gameText, "liberty");
});

test("a team's news lists the News tab for the team and its newest stories", () => {
  assert.deepEqual(
    findListedPages("Liberty news").rows.map((row) =>
      row.kind === "story" ? row.story.title : row.kind === "place" && row.detail,
    ),
    ["Liberty", "Liberty win Game 2"],
  );
});

test("the playoff picture lists the Bracket and the league's standings beside the playoffs' games", () => {
  for (const text of ["playoff picture", "seeds", "who clinched"])
    assert.deepEqual(
      findListedPages(text).rows.map((row) => (row.kind === "place" ? row.place.key : row.kind)),
      ["season:bracket", "standings:league"],
      text,
    );
  assert.equal(findListedPages("playoff picture").gameText, "playoff");
});
