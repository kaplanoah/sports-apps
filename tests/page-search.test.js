import test from "node:test";
import assert from "node:assert/strict";
import { createSearchDictionary } from "../shared/page/game-search.js";
import { findLatestFinal, findPages } from "../shared/page/page-search.js";

// A small league: the Hawks of Riverton and the Foxes of Hillside, in the East, with a few of their
// players, its standings, and its settings.
/** @type {import("../shared/page/game-search.js").SearchTerms} */
const TERMS = {
  teams: [
    {
      code: "HAW",
      name: "Hawks",
      words: ["hawks", "riverton", "haw"],
      homeCity: "Riverton",
      conference: "East",
    },
    {
      code: "FOX",
      name: "Foxes",
      words: ["foxes", "hillside", "fox"],
      homeCity: "Hillside",
      conference: "East",
    },
  ],
  places: [
    { name: "Riverton", words: ["riverton"], cities: ["Riverton"] },
    { name: "Hillside", words: ["hillside"], cities: ["Hillside"] },
  ],
  rounds: [{ round: 3, name: "Finals", words: ["finals"] }],
  kindNames: { cup: "The Cup", allStar: "All-Star Game" },
  examples: [],
};

/** @type {import("../shared/page/page-search.js").SearchPages} */
const PAGES = {
  teams: [
    { code: "HAW", name: "Hawks", fullName: "Riverton Hawks" },
    { code: "FOX", name: "Foxes", fullName: "Hillside Foxes" },
  ],
  players: [
    { id: "1", team: "HAW", firstName: "Mara", lastName: "Stone", number: "7" },
    { id: "2", team: "FOX", firstName: "Lena", lastName: "Stone", number: "12" },
    { id: "3", team: "HAW", firstName: "Jo", lastName: "Quill", number: "3" },
    { id: "4", team: "HAW", firstName: "A’ja", lastName: "Rook", number: "22" },
  ],
  section: { key: "roster", name: "Roster" },
  places: [
    {
      key: "standings:league",
      name: ["Standings", "League"],
      words: ["standings", "league"],
      icon: "standings",
    },
    {
      key: "standings:east",
      name: ["Standings", "East"],
      words: ["standings", "east", "eastern conference"],
      icon: "standings",
    },
    { key: "settings", name: ["Settings"], words: ["settings"], icon: "settings" },
    {
      key: "settings:appearance",
      name: ["Settings", "Appearance"],
      words: ["settings", "appearance", "theme", "dark mode"],
      icon: "settings",
    },
  ],
  gamePart: { key: "highlights", name: "Highlights", words: ["highlights", "recap"] },
  examples: [],
};

const DICTIONARY = createSearchDictionary(TERMS);

/**
 * What a search lists, each row as its kind and what it opens, and the words left for its games.
 * @param {string} text
 * @param {boolean} [isTyping]
 */
function listRows(text, isTyping = false) {
  const { rows, gameText } = findPages(text, { dictionary: DICTIONARY, pages: PAGES, isTyping });
  return {
    rows: rows.map((row) => {
      if (row.kind === "place") return `place ${row.place.key}`;
      if (row.kind === "player") return `player ${row.team.code} ${row.player.lastName}`;
      if (row.kind === "game-part") return `${row.part.key} of ${row.gameText ?? "the season"}`;
      return `${row.kind} ${row.team.code}`;
    }),
    gameText,
  };
}

test("a team's name alone lists its sheet and its Roster, and leaves its games", () => {
  for (const text of ["Hawks", "Riverton", "haw", "the Hawks"])
    assert.deepEqual(listRows(text).rows, ["team HAW", "section HAW"], text);
  assert.equal(listRows("Hawks").gameText, "hawks");
});

test("its section's name beside a team lists the section alone, and leaves the team's games", () => {
  for (const text of ["Hawks roster", "Hawks rost", "roster Hawks"])
    assert.deepEqual(listRows(text), { rows: ["section HAW"], gameText: "hawks" }, text);
});

test("words that ask for games list no pages, and leave the search of games as typed", () => {
  for (const text of [
    "Hawks at Foxes",
    "Hawks Foxes",
    "Hawks next game",
    "Hawks in March",
    "Hawks at home",
    "Hawks playoffs",
    "Finals",
    "games this weekend",
  ])
    assert.deepEqual(listRows(text), { rows: [], gameText: text }, text);
});

test("a player's name lists her sheet, and finds no games", () => {
  assert.deepEqual(listRows("Mara Stone"), { rows: ["player HAW Stone"], gameText: null });
  assert.deepEqual(listRows("Quill").rows, ["player HAW Quill"]);
  assert.deepEqual(listRows("Quill stats").rows, ["player HAW Quill"]);
  assert.deepEqual(listRows("aja").rows, ["player HAW Rook"]);
});

test("a name two players share lists each of them, and a whole name only her", () => {
  assert.deepEqual(listRows("Stone").rows, ["player HAW Stone", "player FOX Stone"]);
  assert.deepEqual(listRows("Lena Stone").rows, ["player FOX Stone"]);
});

test("while words are typed, the last can be the start of a name, once it's three letters long", () => {
  assert.deepEqual(listRows("Mara Sto", true).rows, ["player HAW Stone"]);
  assert.deepEqual(listRows("Qui", true).rows, ["player HAW Quill"]);
  assert.deepEqual(listRows("Qu", true), { rows: [], gameText: "Qu" });
  assert.deepEqual(listRows("Sto"), { rows: [], gameText: "Sto" });
});

test("a place's words list it, from the start of any of its words, and every place they all find", () => {
  assert.deepEqual(listRows("standings").rows, ["place standings:league", "place standings:east"]);
  assert.deepEqual(listRows("east standings").rows, ["place standings:east"]);
  assert.deepEqual(listRows("eastern conference").rows, ["place standings:east"]);
  assert.deepEqual(listRows("settings").rows, ["place settings", "place settings:appearance"]);
  assert.deepEqual(listRows("dark mode").rows, ["place settings:appearance"]);
  assert.deepEqual(listRows("appear").rows, ["place settings:appearance"]);
});

test("a place leaves the games to the words a search of games reads, and none when it reads none", () => {
  assert.equal(listRows("standings").gameText, null);
  assert.equal(listRows("the settings").gameText, null);
  assert.equal(listRows("east").gameText, "east");
});

test("a game part's name lists it for the latest final the rest of the words find, and no games", () => {
  assert.deepEqual(listRows("highlights"), { rows: ["highlights of the season"], gameText: null });
  assert.deepEqual(listRows("Hawks highlights"), {
    rows: ["highlights of hawks"],
    gameText: null,
  });
  assert.deepEqual(listRows("Hawks Foxes recap"), {
    rows: ["highlights of hawks foxes"],
    gameText: null,
  });
  assert.deepEqual(listRows("high", true).rows, ["highlights of the season"]);
});

test("the latest final is the last game that has ended", () => {
  const games = [
    { id: "a", state: "final" },
    { id: "b", state: "final" },
    { id: "c", state: "live" },
    { id: "d", state: "pre" },
  ];
  assert.equal(findLatestFinal(games)?.id, "b");
  assert.equal(findLatestFinal(games.slice(2)), null);
});
