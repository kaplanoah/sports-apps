import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSearchContext, createSearchDictionary } from "#shared/game-search.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { orderListedDays, readTypedSearch } from "#shared/search-reading.js";
import { listPhrasings, sweepPhrasings } from "../../../tests/search-sweep.js";
import { listSeasonGames } from "../page/js/games-view.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGame } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";

useTimeZone(EASTERN);

/** @param {string} name */
const loadFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));

// MLB's 2026 season as the store kept it on Friday, October 9, with the Division Series done, and
// every player on a club's roster on October 13.
const FIXTURE = loadFixture("2026-10-09-season");
const NOW = Date.parse(FIXTURE.now);
const SNAPSHOT = buildSnapshot(FIXTURE.responses, { season: FIXTURE.season, now: NOW });
const GAMES = listSeasonGames(SNAPSHOT.slate, Object.values(SNAPSHOT.schedule).flat());
const TERMS = createSearchTerms({ games: GAMES, divisions: SNAPSHOT.standings.divisions });
const CONTEXT = createSearchContext({
  terms: TERMS,
  dictionary: createSearchDictionary(TERMS),
  games: GAMES.map(readSearchGame)
    .filter((game) => game !== null)
    .sort((first, second) => first.startMs - second.startMs),
  now: NOW,
});
const PAGES = listSearchPages({
  index: loadFixture("2026-10-13-player-index").index,
  isSettingShown: () => true,
});

test("typing each club's and place's name a key at a time, alone or in a search, finds no games from under three letters, names each club alone, finds what the whole search does once it reads it whole, and starts no player past its first word", () => {
  const phrasings = listPhrasings(CONTEXT, "mets");
  assert.deepEqual(sweepPhrasings(phrasings, { context: CONTEXT, pages: PAGES }), []);
});

test("typing a whole word that asks for every game lists them, and a letter or two on the way to a name lists none", () => {
  /** @param {string} text */
  const countTyped = (text) =>
    readTypedSearch(text, { context: CONTEXT, pages: PAGES, isTyping: true, isGamesOnly: false })
      .games.length;
  assert.deepEqual(
    ["games", "a", "as"].map((text) => [text, countTyped(text)]),
    [
      ["games", CONTEXT.games.length],
      ["a", 0],
      ["as", 0],
    ],
  );
});

test("under the rows, a search lists its games from today on, soonest first, or, when none are left, every one, the latest first", () => {
  /** @param {string} text */
  const show = (text) => {
    const shown = readTypedSearch(text, {
      context: CONTEXT,
      pages: PAGES,
      isTyping: false,
      isGamesOnly: false,
    });
    const days = [...new Set(shown.games.map((game) => game.day))].map((day) => ({ day }));
    const listed = orderListedDays(days, shown.isNewestFirst).map(({ day }) => day);
    return [shown.games.length, listed[0], listed.at(-1)];
  };
  assert.deepEqual(show("Los Angeles"), [3, "2026-10-14", "2026-10-16"]);
  assert.deepEqual(show("New York"), [164, "2026-10-07", "2026-03-26"]);
  assert.deepEqual(show("Mets"), [162, "2026-09-27", "2026-03-26"]);
});
