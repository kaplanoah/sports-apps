import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createSearchContext,
  createSearchDictionary,
  listSearchGames,
} from "#shared/game-search.js";
import { readTypedSearch } from "#shared/search-reading.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";
import {
  listPhrasings,
  sweepMisspellings,
  sweepPhrasings,
  sweepPlayerNames,
  sweepPlayerNumbers,
} from "../../../tests/search-sweep.js";
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
  games: listSearchGames(GAMES, (game) => readSearchGame(game, null)),
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

test("typing each player's first, last, or whole name a key at a time lists her from its third letter, even where a search of games knows the letters as a word, as Will or Mar", () => {
  assert.deepEqual(sweepPlayerNames({ context: CONTEXT, pages: PAGES }), []);
});

/**
 * What a search shows as it's typed: its rows, a player's by her name, whether they show over its
 * suggestions, its suggestions, and the line over its games.
 * @param {string} text
 * @param {boolean} [isTyping]
 */
function showTyped(text, isTyping = true) {
  const { rows, isRowsFirst, suggestions, read } = readTypedSearch(text, {
    context: CONTEXT,
    pages: PAGES,
    isTyping,
    isGamesOnly: false,
  });
  return {
    rows: rows.map((row) =>
      row.kind === "player" ? `${row.player.firstName} ${row.player.lastName}` : row.kind,
    ),
    isRowsFirst,
    suggestions: suggestions.map((suggestion) => suggestion.text),
    read: read ? [read.lead, ...read.facts].join(" | ") : null,
  };
}

test("a team's name beside a number, each way fans write it, lists each of its players who wears it, or while it's typed each number it starts, over the team's games", () => {
  assert.deepEqual(sweepPlayerNumbers({ context: CONTEXT, pages: PAGES }), []);
  assert.deepEqual(showTyped("valkyries 2"), {
    rows: ["Kaitlyn Chen", "Veronica Burton", "Cecilia Zandalasini"],
    isRowsFirst: true,
    suggestions: [],
    read: "Valkyries | 47 games",
  });
  assert.deepEqual(showTyped("valkyries 2", false).rows, ["Kaitlyn Chen"]);
});

test("a team's numbered players show over the suggestions, which keep the number, and the team's whole searches come only for its name alone", () => {
  assert.deepEqual(showTyped("valkyries 1"), {
    rows: ["Gabby Williams", "Ashten Prechtel", "Iliana Rupert", "Janelle Salaun", "Tiffany Hayes"],
    isRowsFirst: true,
    suggestions: ["valkyries 1st Round"],
    read: "Valkyries | 47 games",
  });
  assert.deepEqual(showTyped("valkyries"), {
    rows: ["team", "section"],
    isRowsFirst: false,
    suggestions: ["Valkyries next game", "Valkyries playoffs"],
    read: "Valkyries | 47 games",
  });
  assert.deepEqual(showTyped("valkyries 1st round").suggestions, []);
});

test("a number a team's player wears, after words that ask for a time, a day, or a game, finds games and lists no player", () => {
  for (const text of ["valkyries 2pm", "valkyries 2 pm", "valkyries at 2", "valkyries june 11"])
    assert.deepEqual(showTyped(text).rows, [], text);
  assert.deepEqual(showTyped("valkyries game 2").rows, []);
  assert.equal(showTyped("valkyries game 2").read, "Valkyries | Game 2 | 1 game");
});
