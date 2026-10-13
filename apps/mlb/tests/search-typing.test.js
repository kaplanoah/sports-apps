import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSearchContext, createSearchDictionary } from "#shared/game-search.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
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
