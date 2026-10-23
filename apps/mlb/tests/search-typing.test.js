import "../../../tests/eastern-time-zone.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSearchContext, createSearchDictionary } from "#shared/game-search.js";
import { orderListedDays, readSentWords, readTypedSearch } from "#shared/search-reading.js";
import {
  listPhrasings,
  sweepMisspellings,
  sweepPhrasings,
  sweepPlayerNames,
  sweepPlayerNumbers,
} from "../../../tests/search-sweep.js";
import { listSeasonGames } from "../page/js/season-games.js";
import { listSearchPages } from "../page/js/search-pages.js";
import { createSearchTerms, readSearchGames } from "../page/js/search-terms.js";
import { buildSnapshot } from "../page/js/snapshot.js";

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
  games: readSearchGames(GAMES),
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

test("typing each club's and place's name of five letters or more with a letter wrong, each way a thumb gets one wrong, finds only games the name's own letters find, or nothing, never another name's", () => {
  assert.deepEqual(sweepMisspellings({ context: CONTEXT, pages: PAGES }), []);
});

test("typing each player's first, last, or whole name a key at a time lists him from its third letter, even where a search of games knows the letters as a word, as Will or Mar", () => {
  assert.deepEqual(sweepPlayerNames({ context: CONTEXT, pages: PAGES }), []);
});

/**
 * What a search shows as it's typed: its rows, as each names its page, and the line over its games.
 * @param {string} text
 */
function showTyped(text) {
  const { rows, read } = readTypedSearch(text, {
    context: CONTEXT,
    pages: PAGES,
    isTyping: true,
    isGamesOnly: false,
  });
  return {
    rows: rows.map((row) => {
      if (row.kind === "player") return `${row.player.firstName} ${row.player.lastName}`;
      if (row.kind === "team" || row.kind === "section") return `${row.kind} ${row.team.name}`;
      return row.kind;
    }),
    read: read ? [read.lead, ...read.facts].join(" | ") : null,
  };
}

test("a club's name with one letter wrong is found as it's typed, from five letters on, under what its letters find as typed", () => {
  const nationals = {
    rows: ["team Nationals", "section Nationals"],
    read: "Nationals | 162 games",
  };
  for (const text of ["mationa", "mational", "natoi", "natoin"])
    assert.deepEqual(showTyped(text), nationals, text);
  assert.deepEqual(showTyped("mation"), {
    rows: ["Phil Maton", "team Nationals", "section Nationals"],
    read: "Nationals | 162 games",
  });
  assert.deepEqual(showTyped("mati"), { rows: [], read: null });
});

test("letters as near two names, or that start a player's name as typed, are read as no club", () => {
  assert.deepEqual(showTyped("hosto"), { rows: [], read: null });
  assert.deepEqual(showTyped("castr"), {
    rows: ["Kervin Castro", "Willi Castro"],
    read: null,
  });
});

test("the Search key sends a club's name its letters have one wrong, unless they find a page as typed", () => {
  assert.equal(readSentWords("mationa", CONTEXT, PAGES), "Nationals");
  assert.equal(readSentWords("Mets at mationa", CONTEXT, PAGES), "Mets at Nationals");
  assert.equal(readSentWords("mation", CONTEXT, PAGES), "mation");
  assert.equal(readSentWords("castr", CONTEXT, PAGES), "castr");
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

test("a club's name beside a number, each way fans write it, lists each of its players who wears it, or while it's typed each number it starts, over the club's games", () => {
  assert.deepEqual(sweepPlayerNumbers({ context: CONTEXT, pages: PAGES }), []);
  assert.deepEqual(showTyped("mets 22"), { rows: ["Juan Soto"], read: "Mets | 162 games" });
  assert.deepEqual(showTyped("mets 1").rows, [
    "Marcus Semien",
    "Jorge Polanco",
    "Francisco Lindor",
    "Luis Torrens",
    "Bo Bichette",
  ]);
});

test("a number a club's player wears, after words that ask for a time, a day, or a game, finds games and lists no player", () => {
  for (const text of ["mets 7pm", "mets 7 pm", "mets at 7", "mets june 12", "mets game 4"])
    assert.deepEqual(showTyped(text).rows, [], text);
});
