import test from "node:test";
import assert from "node:assert/strict";
import { createSearchDictionary } from "../shared/page/game-search.js";
import { findPages, findPartGame } from "../shared/page/page-search.js";

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
  starters: [{ id: "5", name: "Pell", words: ["pell"] }],
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
    { id: "5", team: "FOX", firstName: "Cy", lastName: "Pell Jr.", number: "40" },
    { id: "6", team: "FOX", firstName: "Easton", lastName: "Vale", number: "9" },
    { id: "7", team: "HAW", firstName: "Ken", lastName: "Standish", number: "5" },
    { id: "8", team: "FOX", firstName: "Ada", lastName: "Stoner", number: "8" },
    { id: "9", team: "HAW", firstName: "Rex", lastName: "Finale", number: "1" },
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
      key: "settings:hillsider",
      name: ["Settings", "Include The Hillsider"],
      words: ["settings", "the hillsider"],
      icon: "settings",
    },
    {
      key: "settings:appearance",
      name: ["Settings", "Appearance"],
      words: ["settings", "appearance", "theme", "dark mode"],
      icon: "settings",
    },
  ],
  gameParts: [
    {
      key: "highlights",
      name: "Highlights",
      words: ["highlights", "recap"],
      game: "latest-final",
    },
    { key: "matchup", name: "Matchup", words: ["matchup", "probables"], game: "next" },
  ],
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

test("a name of five letters or more is found with one letter wrong, unless another's is found without", () => {
  assert.deepEqual(listRows("Standsih"), { rows: ["player HAW Standish"], gameText: null });
  assert.deepEqual(listRows("Standis").rows, ["player HAW Standish"]);
  assert.deepEqual(listRows("Stome").rows, ["player HAW Stone", "player FOX Stone"]);
  assert.deepEqual(listRows("Mara Stome").rows, ["player HAW Stone"]);
  assert.deepEqual(listRows("Ada Stonr").rows, ["player FOX Stoner"]);
  assert.deepEqual(listRows("Stoner").rows, ["player FOX Stoner"]);
  assert.deepEqual(listRows("Stone").rows, ["player HAW Stone", "player FOX Stone"]);
  assert.deepEqual(listRows("Qiull").rows, ["player HAW Quill"]);
  assert.deepEqual(listRows("Vael"), { rows: [], gameText: "Vael" });
});

test("a word a search of games knows is never a name with a letter wrong", () => {
  assert.deepEqual(listRows("Finals"), { rows: [], gameText: "Finals" });
  assert.deepEqual(listRows("Finale").rows, ["player HAW Finale"]);
});

test("a place's words list it, from the start of any of its words, and every place they all find", () => {
  assert.deepEqual(listRows("standings").rows, ["place standings:league", "place standings:east"]);
  assert.deepEqual(listRows("east standings").rows, ["place standings:east"]);
  assert.deepEqual(listRows("eastern conference").rows, ["place standings:east"]);
  assert.deepEqual(listRows("settings").rows, [
    "place settings",
    "place settings:hillsider",
    "place settings:appearance",
  ]);
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

test("a final's part opens the last game that has ended, and a part before one the next game", () => {
  const games = [
    { id: "a", state: "final" },
    { id: "b", state: "final" },
    { id: "c", state: "live" },
    { id: "d", state: "pre" },
  ];
  /** @type {import("../shared/page/page-search.js").GamePart} */
  const final = { key: "highlights", name: "Highlights", words: [], game: "latest-final" };
  /** @type {import("../shared/page/page-search.js").GamePart} */
  const next = { key: "matchup", name: "Matchup", words: [], game: "next" };
  assert.equal(findPartGame(games, final)?.id, "b");
  assert.equal(findPartGame(games.slice(2), final), null);
  assert.equal(findPartGame(games, next)?.id, "c");
  assert.equal(findPartGame(games.slice(0, 2), next), null);
});

test("a suffix after a last name may be left off", () => {
  assert.deepEqual(listRows("Pell Jr").rows, ["player FOX Pell Jr."]);
  assert.deepEqual(listRows("Cy Pell").rows, ["player FOX Pell Jr."]);
});

test("a name a search of games knows, as a starter's, lists his sheet and still finds his starts", () => {
  assert.deepEqual(listRows("Pell"), { rows: ["player FOX Pell Jr."], gameText: "Pell" });
  assert.deepEqual(listRows("Quill"), { rows: ["player HAW Quill"], gameText: null });
});

test("words a search of games knows ask for something else, beside a name or as the start of one", () => {
  assert.deepEqual(listRows("eastern conference vale").rows, []);
  assert.deepEqual(listRows("east", true).rows, ["place standings:east"]);
  assert.deepEqual(listRows("Easto", true).rows, ["player FOX Vale"]);
});

test("a game's part before it opens the next game, and its name may be one a search of games passes over", () => {
  assert.deepEqual(listRows("Hawks matchup"), { rows: ["matchup of hawks"], gameText: null });
  assert.deepEqual(listRows("probables").rows, ["matchup of the season"]);
  assert.deepEqual(listRows("the Hawks matchup").rows, ["matchup of the hawks"]);
});

test("the places the words find list first, beside a player whose name they start, or a team a letter off", () => {
  assert.deepEqual(listRows("stan", true).rows, [
    "place standings:league",
    "place standings:east",
    "player HAW Standish",
  ]);
  for (const text of ["Hillsider", "the Hillsider"])
    assert.deepEqual(
      listRows(text).rows,
      ["place settings:hillsider", "team FOX", "section FOX"],
      text,
    );
  assert.deepEqual(listRows("Hillside").rows, ["team FOX", "section FOX"]);
});

test("a word a search of games passes over finds a place only as a whole word of its own", () => {
  assert.deepEqual(listRows("season").rows, []);
  assert.deepEqual(listRows("the").rows, ["place settings:hillsider"]);
});
