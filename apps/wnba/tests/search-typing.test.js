import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSearchContext, createSearchDictionary } from "#shared/game-search.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import { listPhrasings, sweepMisspellings, sweepPhrasings } from "../../../tests/search-sweep.js";
import { listSeasonGames } from "../page/js/games-view.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGame } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { indexRosters } from "../worker/src/player-index.js";
import { describeRoster } from "../worker/src/roster.js";

useTimeZone(EASTERN);

/** @param {string} name */
const loadFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));

// The season on the afternoon of September 30, with its whole schedule from the next day's
// recording, and every team's roster on October 13.
const AFTERNOON = loadFixture("2026-09-30-afternoon");
const NOW = Date.parse(AFTERNOON.now);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });
const SCHEDULE = buildSnapshot(
  { ...AFTERNOON.responses, schedule: loadFixture("2026-10-01-games").preview.schedule },
  { season: 2026, now: NOW },
).schedule;
const GAMES = listSeasonGames(SEASON, { games: SCHEDULE });
const TERMS = createSearchTerms({ games: GAMES, standings: SEASON.standings });
const CONTEXT = createSearchContext({
  terms: TERMS,
  dictionary: createSearchDictionary(TERMS),
  games: GAMES.map((game) => readSearchGame(game, null)).filter((game) => game !== null),
  now: NOW,
});
const ROSTERS = loadFixture("2026-10-13-every-roster");
const INDEX = indexRosters(
  2026,
  Object.entries(ROSTERS.rosters).map(([key, leagueRoster]) =>
    describeRoster({
      team: key.split(":")[0],
      season: 2026,
      leagueRoster,
      playerList: ROSTERS.playerList,
      outPlayers: [],
      now: NOW,
    }),
  ),
);
const PAGES = listSearchPages({ index: INDEX, isSettingShown: () => true });

test("typing each team's and place's name a key at a time, alone or in a search, finds no games from under three letters, names each team alone, finds what the whole search does once it reads it whole, and starts no player past its first word", () => {
  const phrasings = listPhrasings(CONTEXT, "liberty");
  assert.deepEqual(sweepPhrasings(phrasings, { context: CONTEXT, pages: PAGES }), []);
});

test("typing each team's and place's name of five letters or more with a letter wrong, each way a thumb gets one wrong, finds only games the name's own letters find, or nothing, never another name's", () => {
  assert.deepEqual(sweepMisspellings({ context: CONTEXT, pages: PAGES }), []);
});
