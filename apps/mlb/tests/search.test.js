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
import { listExamples, listSuggestions } from "#shared/search-suggestions.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { listSeasonGames } from "../page/js/games-view.js";
import { createSearchTerms, readSearchGame } from "../page/js/search-terms.js";
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
    games: games
      .map(readSearchGame)
      .filter((game) => game !== null)
      .sort((first, second) => first.startMs - second.startMs),
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

test("two clubs find their games, at only those in the second's ballpark, and a city its club's", () => {
  assert.equal(search("Mets Phillies").line, "Mets vs Phillies | 13 games");
  assert.deepEqual(search("Mets at Phillies").games.slice(0, 3), [
    "2026-06-18 NYM at PHI",
    "2026-06-20 NYM at PHI",
    "2026-06-21 NYM at PHI",
  ]);
  assert.equal(search("Mets at Phillies").line, "Mets @ Phillies | 6 games");
  assert.equal(search("Yankees in Boston").line, "Yankees | In Boston | 7 games");
});

test("a name two clubs share finds both clubs' games, and a city two clubs share reads as the place", () => {
  assert.equal(search("Sox").line, "Red Sox or White Sox | 327 games");
  assert.equal(search("New York").line, "In New York | 164 games");
  assert.equal(search("Chicago").line, "In Chicago | 164 games");
  assert.equal(search("Los Angeles").line, "In Los Angeles | 167 games");
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
  assert.ok(findDayGames(atNoon).some((game) => game.id === "823244"));
  assert.ok(!findDayGames(CONTEXT).some((game) => game.id === "823244"));
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
