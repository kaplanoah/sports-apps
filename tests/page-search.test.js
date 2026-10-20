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
  words: {
    seasonOpener: "season opener",
    allStar: "All-Star Game",
    cup: "The Cup",
    hasDoubleheaders: false,
    pastRegulation: { name: "Overtime", words: ["overtime"], games: "overtime games" },
    crossConference: null,
    neverShown: [],
    seasonSpansYears: false,
    searchFiller: [],
  },
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
    { id: "10", team: "FOX", firstName: "Tess", lastName: "Willis", number: "14" },
    { id: "11", team: "HAW", firstName: "Tess", lastName: "Foxworth", number: "15" },
    { id: "12", team: "FOX", firstName: "Kay Lee", lastName: "Hart-Moss", number: "20" },
    { id: "13", team: "HAW", firstName: "Bo", lastName: "Highsmith", number: "21" },
    { id: "14", team: "FOX", firstName: "Ines", lastName: "Hurtado", number: "23" },
    { id: "15", team: "HAW", firstName: "Hawk", lastName: "Rios", number: "24" },
    { id: "16", team: "FOX", firstName: "Lu A.", lastName: "Ferro", number: "25" },
    { id: "17", team: "HAW", firstName: "Will", lastName: "Crane", number: "26" },
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
  isOutKnown: true,
};

const DICTIONARY = createSearchDictionary(TERMS);

/**
 * What a search lists, each row as its kind and what it opens, and the words left for its games.
 * @param {string} text
 * @param {boolean} [isTyping]
 * @param {import("../shared/page/page-search.js").SearchPages} [pages]
 */
function listRows(text, isTyping = false, pages = PAGES) {
  const { rows, gameText } = findPages(text, { dictionary: DICTIONARY, pages, isTyping });
  return {
    rows: rows.map((row) => {
      if (row.kind === "place") return `place ${row.place.key}`;
      if (row.kind === "player") return `player ${row.team.code} ${row.player.lastName}`;
      if (row.kind === "game-part") return `${row.part.key} of ${row.gameText ?? "the season"}`;
      if (row.kind === "story") return `story ${row.story.id}`;
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

test("a game part's name lists it for the latest final the rest of the words find, and no games, then any player whose name it starts", () => {
  assert.deepEqual(listRows("highlights"), { rows: ["highlights of the season"], gameText: null });
  assert.deepEqual(listRows("Hawks highlights"), {
    rows: ["highlights of hawks"],
    gameText: null,
  });
  assert.deepEqual(listRows("Hawks Foxes recap"), {
    rows: ["highlights of hawks foxes"],
    gameText: null,
  });
  assert.deepEqual(listRows("high", true).rows, [
    "highlights of the season",
    "player HAW Highsmith",
  ]);
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

test("words a search of games knows beside a name ask for something else, so they name no player", () => {
  assert.deepEqual(listRows("eastern conference vale").rows, []);
  assert.deepEqual(listRows("Hawks fox", true).rows, []);
});

test("a word a search of games knows, typed last, can also be the start of a name, after what it finds on its own", () => {
  assert.deepEqual(listRows("east", true).rows, ["place standings:east", "player FOX Vale"]);
  assert.deepEqual(listRows("Mar", true), { rows: ["player HAW Stone"], gameText: "Mar" });
  assert.deepEqual(listRows("will", true), {
    rows: ["player FOX Willis", "player HAW Crane"],
    gameText: null,
  });
  assert.deepEqual(listRows("the will", true).rows, ["player FOX Willis", "player HAW Crane"]);
  assert.deepEqual(listRows("Tess will", true).rows, ["player FOX Willis"]);
  assert.deepEqual(listRows("fox", true).rows, ["team FOX", "section FOX", "player HAW Foxworth"]);
  assert.deepEqual(listRows("Tess fox", true).rows, ["player HAW Foxworth"]);
  assert.deepEqual(listRows("Tess", true).rows, ["player FOX Willis", "player HAW Foxworth"]);
});

test("a word a search of games knows is the start of a name only while it's typed, and never one with a letter wrong or a plural", () => {
  assert.deepEqual(listRows("will"), { rows: [], gameText: "will" });
  assert.deepEqual(listRows("fox").rows, ["team FOX", "section FOX"]);
  assert.deepEqual(listRows("Mar"), { rows: [], gameText: "Mar" });
  assert.deepEqual(listRows("Finals", true).rows, []);
  assert.deepEqual(listRows("Hawks", true).rows, ["team HAW", "section HAW"]);
  assert.deepEqual(listRows("hawk", true).rows, ["player HAW Rios"]);
});

test("words a search of games passes over name a player only beside a word of her name it doesn't pass over, or while they're all it's typed", () => {
  assert.deepEqual(listRows("when will Quill return"), {
    rows: ["player HAW Quill"],
    gameText: null,
  });
  assert.deepEqual(listRows("when will qu", true).rows, []);
  assert.deepEqual(listRows("Will Crane").rows, ["player HAW Crane"]);
  assert.deepEqual(listRows("when will"), { rows: [], gameText: "when will" });
});

test("a name only begun names her once three of its letters are typed", () => {
  assert.deepEqual(listRows("a f", true).rows, []);
  assert.deepEqual(listRows("lu a f", true).rows, ["player FOX Ferro"]);
});

test("a word a search of games knows, only begun, names no one beside a word it doesn't know", () => {
  assert.deepEqual(listRows("big fox", true).rows, []);
  assert.deepEqual(listRows("big foxw", true).rows, ["player HAW Foxworth"]);
});

test("each run of a name's words names her, but not a suffix or a word too short to start a name alone", () => {
  for (const text of ["Lee", "Moss", "Hart", "Kay Lee", "Lee Hart", "Hart-Moss", "Kay Lee Hart"])
    assert.deepEqual(listRows(text).rows, ["player FOX Hart-Moss"], text);
  assert.deepEqual(listRows("Jr").rows, []);
  assert.deepEqual(listRows("a").rows, []);
  assert.deepEqual(listRows("Lu A. Ferro").rows, ["player FOX Ferro"]);
});

test("while words are typed, a later word of a name can be begun from its first letter", () => {
  assert.deepEqual(listRows("Tess W", true).rows, ["player FOX Willis"]);
  assert.deepEqual(listRows("Kay L", true).rows, ["player FOX Hart-Moss"]);
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

/**
 * A story about some of the teams, published on a day of September.
 * @param {string} id
 * @param {string[]} teams
 * @param {number} day
 * @returns {import("../shared/page/news-picks.js").NewsStory}
 */
const makeStory = (id, teams, day) => ({
  id,
  url: `https://news.example/${id}`,
  title: `Story ${id}`,
  summary: "",
  author: "",
  outlet: "The Paper",
  source: "paper",
  publishedAt: `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`,
  photo: null,
  teams,
});

const NEWS_PLACE = {
  key: "tab:news",
  name: ["News"],
  words: ["news", "stories"],
  icon: /** @type {const} */ ("news"),
};

// The same league with players out, a setting whose words start like "out", and its news.
/** @type {import("../shared/page/page-search.js").SearchPages} */
const PAGES_WITH_NEWS = {
  ...PAGES,
  teams: PAGES.teams.map((team) => ({ ...team, record: team.code === "HAW" ? "20-4" : "4-20" })),
  players: PAGES.players.map((player) => {
    const out = {
      1: { reason: "Left knee", isForSeason: false },
      2: { reason: null, isForSeason: false },
      4: { reason: "Concussion", isForSeason: true },
    }[player.id];
    return { ...player, out: out ?? null };
  }),
  places: [
    ...PAGES.places,
    NEWS_PLACE,
    {
      key: "settings:outlets",
      name: ["Settings", "Outlets"],
      words: ["settings", "outlets", "news sources"],
      icon: "settings",
    },
  ],
  news: {
    place: NEWS_PLACE,
    stories: [
      makeStory("a", ["HAW"], 29),
      makeStory("b", ["FOX"], 28),
      makeStory("c", ["HAW", "FOX"], 27),
      makeStory("d", ["HAW"], 26),
      makeStory("e", ["HAW"], 25),
    ],
  },
};

test("words asking who is out list each player out, by team and then last name, saying why", () => {
  for (const text of ["who is out", "who's out", "injured", "injuries", "injury report"])
    assert.deepEqual(
      listRows(text, false, PAGES_WITH_NEWS),
      { rows: ["player FOX Stone", "player HAW Rook", "player HAW Stone"], gameText: null },
      text,
    );
  const { rows } = findPages("who is out", {
    dictionary: DICTIONARY,
    pages: PAGES_WITH_NEWS,
    isTyping: false,
  });
  assert.ok(rows.every((row) => row.kind === "player" && row.out === "listed"));
});

test("words asking who is out list after who is the players whose names they start while typed, with no line saying they're all out", () => {
  const out = ["player FOX Stone", "player HAW Rook", "player HAW Stone"];
  assert.deepEqual(listRows("hurt", true, PAGES_WITH_NEWS).rows, [...out, "player FOX Hurtado"]);
  assert.deepEqual(listRows("hurt", false, PAGES_WITH_NEWS).rows, out);
  const typed = findPages("hurt", {
    dictionary: DICTIONARY,
    pages: PAGES_WITH_NEWS,
    isTyping: true,
  });
  assert.equal(typed.read, undefined);
  const last = typed.rows.at(-1);
  assert.equal(last?.kind === "player" && last.out, undefined);
  assert.equal(readLine("hurt"), "Who's out | 3 players");
});

test("the start of a word asking who is out, from its third letter, asks it too", () => {
  for (const isTyping of [true, false]) {
    for (const text of ["inj", "inju", "side"])
      assert.deepEqual(
        listRows(text, isTyping, PAGES_WITH_NEWS).rows,
        ["player FOX Stone", "player HAW Rook", "player HAW Stone"],
        text,
      );
    assert.deepEqual(listRows("Hawks inj", isTyping, PAGES_WITH_NEWS).rows, [
      "player HAW Rook",
      "player HAW Stone",
    ]);
    assert.deepEqual(listRows("Rook inj", isTyping, PAGES_WITH_NEWS).rows, ["player HAW Rook"]);
  }
  assert.ok(!listRows("in", true, PAGES_WITH_NEWS).rows.some((row) => row.startsWith("player")));
});

test("a player's name with words asking who is out lists her, saying whether she is", () => {
  for (const text of ["Rook injury", "is Rook out", "Quill injured"]) {
    const { rows } = findPages(text, {
      dictionary: DICTIONARY,
      pages: PAGES_WITH_NEWS,
      isTyping: false,
    });
    assert.equal(rows.length, 1, text);
    assert.equal(rows[0].kind === "player" && rows[0].out, "named", text);
  }
  assert.deepEqual(listRows("Rook injury", false, PAGES_WITH_NEWS).rows, ["player HAW Rook"]);
});

test("a team's name with words asking who is out lists who is out on it, or its Roster when no one is", () => {
  assert.deepEqual(listRows("Hawks injuries", false, PAGES_WITH_NEWS), {
    rows: ["player HAW Rook", "player HAW Stone"],
    gameText: null,
  });
  assert.deepEqual(listRows("Foxes injury report"), { rows: ["section FOX"], gameText: null });
});

test("a team's name beside its record's words lists its sheet and Roster over its games", () => {
  for (const text of ["Hawks record", "Hawks standing"])
    assert.deepEqual(
      listRows(text, false, PAGES_WITH_NEWS),
      { rows: ["team HAW", "section HAW"], gameText: "hawks" },
      text,
    );
});

test("a team's name beside the News tab's words lists the tab for the team and its three newest stories", () => {
  assert.deepEqual(listRows("Hawks news", false, PAGES_WITH_NEWS), {
    rows: ["place tab:news", "story a", "story c", "story d"],
    gameText: null,
  });
  const [tab] = findPages("Foxes stories", {
    dictionary: DICTIONARY,
    pages: PAGES_WITH_NEWS,
    isTyping: false,
  }).rows;
  assert.equal(tab.kind === "place" && tab.detail, "Foxes");
  assert.deepEqual(listRows("news", false, PAGES_WITH_NEWS).rows, [
    "place tab:news",
    "place settings:outlets",
  ]);
});

/**
 * The line a search's answer says over its rows, as its words read, or null when it says none.
 * @param {string} text
 * @param {import("../shared/page/page-search.js").SearchPages} [pages]
 */
function readLine(text, pages = PAGES_WITH_NEWS) {
  const { read } = findPages(text, { dictionary: DICTIONARY, pages, isTyping: false });
  return read ? [read.lead, ...read.facts].join(" | ") : null;
}

test("an answer says over its rows what they are, and how many, as the games line does", () => {
  assert.equal(readLine("who is out"), "Who's out | 3 players");
  assert.equal(readLine("Hawks injuries"), "Hawks | Who's out | 2 players");
  assert.equal(readLine("Foxes injury report", PAGES), "Foxes | Who's out | No players");
  assert.equal(readLine("Rook injury"), "A’ja Rook | Out");
  assert.equal(readLine("Quill injured"), "Jo Quill | Not out");
  assert.equal(readLine("Stone injury"), "Who's out | 2 players");
  assert.equal(readLine("Hawks news"), "Hawks | News | 3 stories");
  assert.equal(readLine("Foxes stories"), "Foxes | News | 2 stories");
  assert.equal(readLine("Hawks record"), null);
  assert.equal(readLine("standings"), null);
});
