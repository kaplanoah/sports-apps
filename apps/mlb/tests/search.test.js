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
import { findPages, findPartGame } from "#shared/page-search.js";
import { listExamples, listOtherReadings, listSuggestions } from "#shared/search-suggestions.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { listSeasonGames, nameGameKey } from "../page/js/season-games.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGames } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";

useTimeZone(EASTERN);

// MLB's 2026 season as the store kept it on Friday, October 9, with the Division Series done.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-09-season.json`, "utf8"),
);
const NOW = Date.parse(FIXTURE.now);
const SNAPSHOT = buildSnapshot(FIXTURE.responses, { season: FIXTURE.season, now: NOW });

/**
 * A search's context over the season's games, with any of them changed.
 * @param {(game: any) => any} [change]
 */
function createContext(change = (game) => game) {
  const games = listSeasonGames(SNAPSHOT.slate, Object.values(SNAPSHOT.schedule).flat()).map(
    change,
  );
  const terms = createSearchTerms({ games, divisions: SNAPSHOT.standings.divisions });
  return createSearchContext({
    terms,
    dictionary: createSearchDictionary(terms),
    games: readSearchGames(games),
    now: NOW,
  });
}

const CONTEXT = createContext();

/**
 * The games a search finds, as each one's day and clubs, the line under the field, and what an
 * empty list says.
 * @param {string} text
 * @param {ReturnType<typeof createSearchContext>} [context]
 */
function search(text, context = CONTEXT) {
  const asked = readSearch(text, context);
  const found = findSearchGames(asked, context);
  const { lead, facts } = describeSearch(asked, found, context);
  return {
    games: found.games.map((game) => `${game.day} ${game.away ?? "TBD"} at ${game.home ?? "TBD"}`),
    line: [lead, ...facts].join(" | "),
    empty: describeNoGames(asked, context),
  };
}

test("two clubs find their games, at only those in the second's ballpark, and a city the games played there", () => {
  assert.equal(search("Mets Phillies").line, "Mets vs Phillies | 13 games");
  assert.deepEqual(search("Mets at Phillies").games.slice(0, 3), [
    "2026-06-18 NYM at PHI",
    "2026-06-20 NYM at PHI",
    "2026-06-21 NYM at PHI",
  ]);
  assert.equal(search("Mets at Phillies").line, "Mets @ Phillies | 6 games");
  assert.equal(search("Yankees in Boston").line, "Yankees | In Boston | 7 games");
  assert.equal(search("Boston").line, "In Boston | 81 games");
});

test("a name two clubs share finds both clubs' games, and a city two clubs share reads as the place", () => {
  assert.equal(search("Sox").line, "Red Sox or White Sox | 327 games");
  assert.equal(search("New York").line, "In New York | 164 games");
  assert.equal(search("Chicago").line, "In Chicago | 164 games");
  assert.equal(search("Los Angeles").line, "In Los Angeles | 167 games");
});

test("a part of a place finds only its own ballpark's games, and the place finds each part's", () => {
  assert.equal(search("Anaheim").line, "In Anaheim | 81 games");
  assert.equal(search("Bronx").line, "In The Bronx | 83 games");
  assert.equal(search("Queens").line, "In Queens | 81 games");
  assert.equal(search("Flushing").line, "In Queens | 81 games");
});

test("a state finds the games played in it, a game whose ballpark MLB doesn't name by its home club's", () => {
  assert.equal(search("California").line, "In California | 414 games");
  assert.equal(search("Ohio").line, "In Ohio | 165 games");
});

test("a city is offered first as the place, then each club by its whole name, and has each club that plays there as another reading, the one playing soonest first", () => {
  const texts = (/** @type {string} */ text) =>
    listSuggestions(text, CONTEXT).map((row) => `${row.mark.kind} ${row.text}`);
  assert.deepEqual(texts("los"), [
    "place Los Angeles",
    "team Los Angeles Dodgers",
    "team Los Angeles Angels",
  ]);
  assert.deepEqual(texts("chi"), ["place Chicago", "team Chicago White Sox", "team Chicago Cubs"]);
  assert.deepEqual(texts("bos"), ["place Boston", "team Boston Red Sox"]);
  const others = (/** @type {string} */ text) =>
    listOtherReadings(text, CONTEXT).map((row) => `${row.text} ${row.detail}`);
  assert.deepEqual(others("Los Angeles"), ["Dodgers 173 games", "Angels 162 games"]);
  assert.deepEqual(others("la"), ["Dodgers 173 games", "Angels 162 games"]);
  assert.deepEqual(others("New York"), ["Yankees 166 games", "Mets 162 games"]);
  assert.deepEqual(others("Bronx"), ["Yankees 166 games"]);
  assert.deepEqual(others("Boston"), ["Red Sox 164 games"]);
  assert.deepEqual(others("cali"), [
    "Dodgers 173 games",
    "Padres 168 games",
    "Angels 162 games",
    "Athletics 162 games",
    "Giants 162 games",
  ]);
  assert.deepEqual(others("Fenway"), []);
  assert.deepEqual(others("Mets in New York"), []);
  assert.deepEqual(others("new york in april"), [
    "Yankees in April 26 games",
    "Mets in April 26 games",
  ]);
  assert.equal(listSuggestions("los ange", CONTEXT)[0].finished, "los ange");
  assert.equal(listSuggestions("Mets at l", CONTEXT)[0].finished, "l");
});

test("a ballpark finds the games played there, by its name or what fans call it", () => {
  assert.equal(search("Fenway").line, "In Fenway Park | 81 games");
  assert.equal(search("Dodger Stadium").line, "In UNIQLO Field at Dodger Stadium | 86 games");
});

test("leagues, divisions, and interleague games", () => {
  assert.equal(search("Mets vs NL East").line, "Mets vs NL East | 52 games");
  assert.equal(search("interleague").line, "Interleague | 720 games");
  assert.equal(search("Mets interleague").line, "Mets | Interleague | 48 games");
});

test("each league's postseason rounds are its own, and the World Series both's", () => {
  assert.deepEqual(search("AL Wild Card").games, [
    "2026-09-29 CWS at HOU",
    "2026-09-29 BOS at NYY",
    "2026-09-30 CWS at HOU",
    "2026-09-30 BOS at NYY",
  ]);
  assert.equal(search("AL Wild Card").line, "AL Wild Card Series | 4 games");
  assert.equal(search("NLDS").line, "NLDS | 8 games");
  assert.equal(search("ALCS").line, "ALCS | 7 games");
  assert.equal(search("LCS").line, "LCS | 14 games");
  assert.equal(search("World Series").line, "World Series | 7 games");
});

test("a starter's name finds his starts, and his next once it's announced", () => {
  assert.equal(search("Skenes").line, "Skenes | 32 starts");
  assert.equal(search("Senga starts").line, "Senga | 8 starts");
  assert.deepEqual(search("Skenes next start"), {
    games: [],
    line: "Skenes | Next start | Not yet announced",
    empty: "Skenes's next start isn't announced yet",
  });
  const named = createContext((game) =>
    game.starters?.some((starter) => starter?.name === "Skenes")
      ? {
          ...game,
          starters: game.starters.map((starter) =>
            starter?.name === "Skenes" ? { ...starter, firstName: "Paul" } : starter,
          ),
        }
      : game,
  );
  assert.equal(search("Paul Skenes", named).line, "Paul Skenes | 32 starts");
  assert.equal(search("Skenes", named).line, "Paul Skenes | 32 starts");
});

test("day and night games go by the clock at the ballpark", () => {
  const atNoon = createContext((game) =>
    game.id === "823244"
      ? {
          ...game,
          start: "2026-03-25T19:05:00Z",
          ballpark: {
            name: "Oracle Park",
            city: "San Francisco",
            state: "CA",
            timeZone: "America/Los_Angeles",
          },
        }
      : game,
  );
  const findDayGames = (/** @type {ReturnType<typeof createSearchContext>} */ context) =>
    findSearchGames(readSearch("day games", context), context).games;
  assert.ok(findDayGames(atNoon).some((game) => game.game.id === "823244"));
  assert.ok(!findDayGames(CONTEXT).some((game) => game.game.id === "823244"));
  assert.equal(search("Mets day games").line, "Mets | Day games | 64 games | 1 with no time yet");
});

test("doubleheaders find both games of each", () => {
  assert.deepEqual(search("Mets doubleheader").games, [
    "2026-04-26 COL at NYM",
    "2026-04-26 COL at NYM",
    "2026-06-24 CHC at NYM",
    "2026-06-24 CHC at NYM",
    "2026-07-29 ATL at NYM",
    "2026-07-29 ATL at NYM",
  ]);
});

test("a home game away from the club's own ballpark is left out of its home games and named", () => {
  const london = createContext((game) =>
    game.id === "823244"
      ? {
          ...game,
          neutral: true,
          ballpark: {
            name: "London Stadium",
            city: "London",
            state: "",
            timeZone: "Europe/London",
          },
        }
      : game,
  );
  assert.equal(
    search("Giants at home", london).line,
    "Giants at home | 80 games | 1 in London left out",
  );
  assert.equal(search("London", london).line, "In London | 1 game");
});

test("the season's first game reads as Opening Day, a game the series may not need as If necessary, and a cup as nothing", () => {
  const texts = (/** @type {string} */ text) =>
    listSuggestions(text, CONTEXT).map((row) => row.text);
  assert.deepEqual(texts("open"), ["Opening Day"]);
  assert.match(search("opening day").line, /^Opening Day \| /);
  assert.match(search("if necessary").line, /^If necessary \| /);
  assert.deepEqual(readSearch("cup", CONTEXT).skipped, ["cup"]);
});

test("the examples before typing find games, and a starter's name typed is finished", () => {
  assert.deepEqual(listExamples(CONTEXT), [
    "Mets at Phillies",
    "Yankees in Boston",
    "Games this weekend",
    "World Series",
    "Mets last game",
  ]);
  const texts = (/** @type {string} */ text) =>
    listSuggestions(text, CONTEXT).map((row) => row.text);
  assert.deepEqual(texts("Ske"), ["Skenes", "Skenes last start"]);
});

test("extra innings finds the finals that went past the ninth", () => {
  assert.deepEqual(search("extra innings").games, [
    "2026-09-27 LAD at SF",
    "2026-09-30 PHI at ATL",
  ]);
  assert.equal(search("extras").line, "Extra innings | 2 games");
  assert.equal(search("Mets extra innings").empty, "No Mets extra-inning games");
});

test("a channel finds the games MLB lists on it, by any name it goes by", () => {
  assert.deepEqual(search("on TBS").games, ["2026-10-10 CWS at CLE", "2026-10-12 TBD at TB"]);
  assert.deepEqual(search("Dodgers on FOX").games, [
    "2026-10-11 LAD at MIL",
    "2026-10-12 LAD at MIL",
  ]);
  assert.deepEqual(search("HBO").games, search("on TBS").games);
  assert.equal(search("on FS1").line, "On FS1 | 1 game");
});

// A few players as the store's list of the season's players has them.
const INDEX = {
  players: [
    { id: "596019", team: "NYM", number: "12", firstName: "Francisco", lastName: "Lindor" },
    { id: "808967", team: "LAD", number: "18", firstName: "Yoshinobu", lastName: "Yamamoto" },
    { id: "665487", team: "SD", number: "23", firstName: "Fernando", lastName: "Tatis Jr." },
    { id: "808982", team: "SF", number: "51", firstName: "Jung Hoo", lastName: "Lee" },
    { id: "695445", team: "TOR", number: "52", firstName: "Chase", lastName: "Lee" },
    { id: "694973", team: "PIT", number: "30", firstName: "Paul", lastName: "Skenes" },
    { id: "668834", team: "KC", number: "51", firstName: "Easton", lastName: "McGee" },
    { id: "519317", team: "NYY", number: "27", firstName: "Giancarlo", lastName: "Stanton" },
    { id: "650490", team: "TB", number: "2", firstName: "Yandy", lastName: "D\u00edaz" },
  ],
};

/**
 * The pages a search lists, as each row reads, and the words it leaves for a search of games,
 * with every setting shown.
 * @param {string} text
 * @param {boolean} [isTyping]
 */
function listPages(text, isTyping = false) {
  const pages = listSearchPages({ index: INDEX, isSettingShown: () => true });
  const { rows, gameText } = findPages(text, {
    dictionary: CONTEXT.dictionary,
    pages,
    isTyping,
  });
  return {
    rows: rows.map((row) => {
      if (row.kind === "place") return row.place.name.join(" ");
      if (row.kind === "player") return `${row.player.firstName} ${row.player.lastName}`;
      if (row.kind === "game-part") return `${row.part.name} of ${row.gameText ?? "the season"}`;
      if (row.kind === "story") return row.story.title;
      return row.kind === "team" ? row.team.fullName : `${row.team.fullName} Roster`;
    }),
    gameText,
  };
}

test("a club's name lists its sheet and its Roster, by any name a search of games knows it by", () => {
  for (const text of ["Mets", "NYM", "New York Mets"])
    assert.deepEqual(listPages(text).rows, ["New York Mets", "New York Mets Roster"], text);
  assert.deepEqual(listPages("Dodgers roster").rows, ["Los Angeles Dodgers Roster"]);
  assert.deepEqual(listPages("Athletics").rows, ["Athletics", "Athletics Roster"]);
});

test("a player's name lists his sheet, by his whole, last, or first name, with or without his suffix or accents", () => {
  assert.deepEqual(listPages("Lindor"), { rows: ["Francisco Lindor"], gameText: null });
  assert.deepEqual(listPages("Tatis").rows, ["Fernando Tatis Jr."]);
  assert.deepEqual(listPages("Fernando Tatis Jr").rows, ["Fernando Tatis Jr."]);
  assert.deepEqual(listPages("Jung Hoo Lee").rows, ["Jung Hoo Lee"]);
  assert.deepEqual(listPages("Lee").rows, ["Jung Hoo Lee", "Chase Lee"]);
  assert.deepEqual(listPages("Diaz").rows, ["Yandy D\u00edaz"]);
  assert.deepEqual(listPages("Yama", true).rows, ["Yoshinobu Yamamoto"]);
});

test("a player's name of five letters or more is found with one letter wrong", () => {
  assert.deepEqual(listPages("Yamamato"), { rows: ["Yoshinobu Yamamoto"], gameText: null });
  assert.deepEqual(listPages("Lindro").rows, ["Francisco Lindor"]);
  assert.deepEqual(listPages("Giancarlo Stantn").rows, ["Giancarlo Stanton"]);
  assert.deepEqual(listPages("Yamamato", true).rows, ["Yoshinobu Yamamoto"]);
});

test("a starter's name lists his sheet and still finds his starts", () => {
  assert.deepEqual(listPages("Skenes"), { rows: ["Paul Skenes"], gameText: "Skenes" });
});

test("words a search of games knows beside a name ask for something else, so they name no player", () => {
  assert.deepEqual(listPages("NL East"), { rows: ["Standings NL"], gameText: "nl east" });
  assert.deepEqual(listPages("Lindor stats").rows, ["Francisco Lindor"]);
});

test("the Standings tab's playoff fields and each league's divisions are found by their words", () => {
  assert.deepEqual(listPages("standings").rows, [
    "Standings Playoffs",
    "Standings AL",
    "Standings NL",
  ]);
  assert.deepEqual(listPages("stan", true).rows, [
    "Standings Playoffs",
    "Standings AL",
    "Standings NL",
    "Giancarlo Stanton",
  ]);
  assert.deepEqual(listPages("wild card").rows, ["Standings Playoffs"]);
  assert.deepEqual(listPages("american league").rows, ["Standings AL"]);
  assert.deepEqual(listPages("AL Central").rows, ["Standings AL"]);
  assert.deepEqual(listPages("playoffs").rows, ["Bracket", "Standings Playoffs"]);
  assert.equal(listPages("playoffs").gameText, "playoffs");
});

test("Highlights find the latest final, and the Matchup the next game, of the season or of the games the other words find", () => {
  assert.deepEqual(listPages("highlights"), {
    rows: ["Highlights of the season"],
    gameText: null,
  });
  assert.deepEqual(listPages("Mets recap").rows, ["Highlights of mets"]);
  assert.deepEqual(listPages("Mets matchup").rows, ["Matchup of mets"]);
  assert.deepEqual(listPages("pitching matchup").rows, ["Matchup of the season"]);
  assert.deepEqual(listPages("Dodgers probables").rows, ["Matchup of dodgers"]);
  const { gameParts } = listSearchPages({ index: INDEX, isSettingShown: () => true });
  const matchup = /** @type {import("#shared/page-search.js").GamePart} */ (
    gameParts.find((part) => part.key === "matchup")
  );
  assert.equal(findPartGame(CONTEXT.games, matchup)?.state, "pre");
});

test("a game search finds opens by its listing's key, so a makeup and never the listing called off that shares its id opens", () => {
  const listed = listSeasonGames(SNAPSHOT.slate, Object.values(SNAPSHOT.schedule).flat());
  const listings = listed.filter((game) => game.id === "823471");
  assert.deepEqual(
    listings.map((game) => [game.date, game.state]),
    [
      ["2026-04-29", "off"],
      ["2026-04-30", "final"],
    ],
  );
  const found = CONTEXT.games.filter((game) => game.game.id === "823471");
  assert.equal(found.length, 1);
  const opened = listed.find((game) => nameGameKey(game) === found[0].id);
  assert.deepEqual([opened?.date, opened?.state], ["2026-04-30", "final"]);
});

test("a club's season counts each game once: a game suspended and finished the next day on the day it started, and one postponed where it's made up", () => {
  const giants = CONTEXT.games.filter((game) => game.away === "SF" || game.home === "SF");
  const days = (/** @type {string} */ id) =>
    giants.filter((game) => game.game.id === id).map((game) => game.day);
  assert.deepEqual(days("824912"), ["2026-06-16"]);
  assert.deepEqual(days("823471"), ["2026-04-30"]);
  assert.equal(giants.filter((game) => game.kind === "regular").length, 162);
});

test("settings and each setting are found by their words, and only the settings shown", () => {
  assert.deepEqual(listPages("night game").rows, ["Settings Appearance"]);
  assert.deepEqual(listPages("prospectus").rows, [
    "Settings Include content from Baseball Prospectus",
  ]);
  assert.deepEqual(listPages("ranking").rows, ["Settings Ranking"]);
  for (const text of ["the athletic", "athletic"])
    assert.deepEqual(
      listPages(text).rows,
      ["Settings Include content from The Athletic", "Athletics", "Athletics Roster"],
      text,
    );
  assert.deepEqual(listPages("athl", true).rows, ["Settings Include content from The Athletic"]);
  assert.deepEqual(listPages("season").rows, ["Settings Season"]);
  assert.deepEqual(listPages("games").rows, []);
  const hidden = listSearchPages({
    index: INDEX,
    isSettingShown: (key) => key !== "settings:season",
  });
  assert.ok(!hidden.places.some((place) => place.key === "settings:season"));
});

/** @param {string} id @param {string} title @param {string} publishedAt @param {string[]} teams */
const describeStory = (id, title, publishedAt, teams) => ({
  id,
  url: `https://www.mlb.com/news/${id}`,
  title,
  summary: "",
  author: "",
  outlet: "MLB.com",
  source: "mlb",
  publishedAt,
  photo: null,
  teams,
});
const STORIES = [
  describeStory("lindor", "Lindor's homer lifts the Mets", "2026-09-27T02:00:00Z", ["NYM"]),
  describeStory("soto", "Soto's four hits power the Mets", "2026-09-28T02:00:00Z", ["NYM"]),
  describeStory("skenes", "Skenes caps his season", "2026-09-28T03:00:00Z", ["PIT"]),
];

/**
 * What search lists for a season's pages, with each club's record and the News tab's stories.
 * @param {string} text
 */
const findListedPages = (text) =>
  findPages(text, {
    dictionary: CONTEXT.dictionary,
    pages: listSearchPages({
      index: INDEX,
      isSettingShown: () => true,
      divisions: SNAPSHOT.standings.divisions,
      stories: STORIES,
    }),
    isTyping: false,
  });

test("every club's row has its record from the standings, and its record's words list it over its games", () => {
  const mets = Object.values(SNAPSHOT.standings.divisions)
    .flat()
    .find((row) => row.id === "NYM");
  const found = findListedPages("Mets record");
  assert.deepEqual(
    found.rows.map((row) => (row.kind === "team" ? row.team.record : row.kind)),
    [`${mets.w}-${mets.l}`, "section"],
  );
});

test("a club's news lists the News tab for the club and its newest stories", () => {
  assert.deepEqual(
    findListedPages("Mets news").rows.map((row) =>
      row.kind === "story" ? row.story.title : row.kind === "place" && row.detail,
    ),
    ["Mets", "Soto's four hits power the Mets", "Lindor's homer lifts the Mets"],
  );
});

test("the examples are three searches for games, then a player and a club's Roster", () => {
  const { examples } = listSearchPages({ index: INDEX, isSettingShown: () => true });
  assert.deepEqual(
    [...listExamples(CONTEXT, 5 - examples.length), ...examples],
    ["Mets at Phillies", "Yankees in Boston", "Games this weekend", "Yamamoto", "Mets roster"],
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
  "sheet:gameSheet": { games: "Mets at Phillies" },
  "section:game": { games: "Mets at Phillies" },
  "section:matchup": { search: "Mets matchup", opens: "matchup" },
  "section:highlights": { search: "highlights", opens: "highlights" },
  "sheet:teamSheet": { search: "Mets", opens: "team" },
  "section:team": { search: "Mets", opens: "team" },
  "section:roster": { search: "Mets roster", opens: "roster" },
  "sheet:playerSheet": { search: "Lindor", opens: "player" },
  "settings:season": { search: "season", opens: "settings:season" },
  "settings:notifications": { search: "notifications", opens: "settings:notifications" },
  "settings:appearance": { search: "night game", opens: "settings:appearance" },
  "settings:team-outlets": { search: "dedicated sources", opens: "settings:team-outlets" },
  "settings:paywalled": { search: "the athletic", opens: "settings:paywalled" },
  "settings:prospectus": { search: "prospectus", opens: "settings:prospectus" },
  "settings:home-screen": {
    leftOut: "Shows only in a phone's browser, whose bar at the top also asks to add the page",
  },
  "settings:ranking": { search: "ranking", opens: "settings:ranking" },
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
