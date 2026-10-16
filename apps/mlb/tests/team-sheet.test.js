import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { nameClubFully } from "../page/js/clubs.js";
import { session } from "../page/js/session.js";
import { keepRanking } from "../page/js/kept-on-device.js";
import { reopenRoster } from "../page/js/roster-section.js";
import { renderTeamSheet } from "../page/js/team-view.js";
import { TEAMS } from "../page/js/teams.js";
import { stripTags } from "../../../tests/text.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";

// The expected times below are what a viewer in Eastern time sees.
useTimeZone(EASTERN);

// A sheet's markup as it reads, its pieces apart, each separator a bar, and runs of space one.
const readText = (markup) =>
  String(markup)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const readStats = (markup) =>
  [
    ...markup.text.matchAll(/<span class="team-label">(.*?)<\/span><b class="tabular">(.*?)<\/b>/g),
  ].map(([, label, value]) => `${stripTags(label)} ${readText(value)}`);

const listParts = (markup) =>
  [...markup.text.matchAll(/<h3>(.*?)<\/h3>/g)].map(([, title]) => title);

// The text of one titled part, from its title to the next part's.
const readPart = (markup, title) =>
  readText(markup).match(
    new RegExp(`${title} (.*?)(?= (?:Playoffs|Regular season|Leaders|Titles) |$)`),
  )?.[1];

const row = (id, w, l, fields = {}) => ({
  id,
  w,
  l,
  pct: (w / (w + l)).toFixed(3).slice(1),
  ...fields,
});

const NL_FIELD = {
  LAD: { league: "NL", seed: 2 },
  PHI: { league: "NL", seed: 1 },
  CHC: { league: "NL", seed: 5 },
  SD: { league: "NL", seed: 4 },
  MIL: { league: "NL", seed: 3 },
  NYM: { league: "NL", seed: 6 },
};

beforeEach(() => {
  Object.assign(session, {
    currentSeason: 2026,
    activeYear: 2026,
    trackedTitles: {},
    state: { teams: NL_FIELD, series: {}, projected: true },
    standings: null,
  });
  keepRanking(2026, ["CHC", "PHI", "LAD"]);
});

const NL_WEST_IN_SEPTEMBER = {
  divisions: {
    "NL West": [
      row("LAD", 89, 61, {
        gb: "-",
        elim: "-",
        lead: true,
        magic: "7",
      }),
      row("SD", 83, 67, { gb: "6.0", elim: "7", wcgb: "+2.0", wce: "-", wcrank: "1" }),
    ],
  },
};

test("a division leader in September: its division, seed, record, and percentage, its place, lead, and magic number, and every title", () => {
  session.standings = NL_WEST_IN_SEPTEMBER;
  const sheet = renderTeamSheet("LAD");

  assert.equal(readText(sheet.heading), "Los Angeles Dodgers");
  assert.equal(readText(sheet.note), "NL West | 2 seed | 89-61 | .593");
  assert.deepEqual(listParts(sheet.body), ["Regular season", "Leaders", "Titles"]);
  assert.deepEqual(readStats(sheet.body), ["NL West 1st", "Lead +6.0", "M# 7"]);
  assert.match(readPart(sheet.body, "Regular season"), /^12 left NL West 1st /);
  assert.equal(readPart(sheet.body, "Titles"), "Defending 9 | 2025, 2024, 2020 and 6 more");
});

test("a club chasing a wild card has a row for each race, each starting with its place, and a club that never won says so", () => {
  session.state.teams = {};
  session.standings = {
    divisions: {
      "AL West": [
        row("HOU", 86, 64, { gb: "-", elim: "-", lead: true, magic: "9" }),
        row("SEA", 81, 69, { gb: "4.5", elim: "8", wcgb: "1.0", wce: "12", wcrank: "4" }),
      ],
    },
  };
  const sheet = renderTeamSheet("SEA");

  assert.equal(readText(sheet.heading), "Seattle Mariners");
  assert.equal(readText(sheet.note), "AL West | 81-69 | .540");
  assert.deepEqual(readStats(sheet.body), [
    "AL West 2nd",
    "GB 4.5",
    "E# 8",
    "Wild card 4th",
    "WCGB 1.0",
    "WCE 12",
  ]);
  assert.equal(readPart(sheet.body, "Titles"), "Since 1977 None yet");
});

test("a race number shows in copper while it counts down, as a gold dash once clinched, and as E once out", () => {
  session.standings = {
    divisions: {
      "AL West": [
        row("HOU", 86, 64, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("SEA", 81, 69, { gb: "4.5", elim: "E", wcgb: "1.0", wce: "12", wcrank: "4" }),
      ],
    },
  };
  const leader = renderTeamSheet("HOU").body.text;
  const chaser = renderTeamSheet("SEA").body.text;

  assert.match(leader, /<span class="elim-num clinched">&mdash;<\/span>/);
  assert.match(chaser, /<span class="elim-num">E<\/span>/);
  assert.match(chaser, /<span class="elim-num live">12<\/span>/);
});

test("once the season is over, the Regular season part counts no games left", () => {
  session.standings = {
    divisions: {
      "NL Central": [
        row("MIL", 95, 67, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("CHC", 91, 71, { gb: "4.0", elim: "E", wcgb: "+2.0", wce: "-", wcrank: "1" }),
      ],
    },
  };
  const leader = renderTeamSheet("MIL").body;

  assert.deepEqual(readStats(leader), ["NL Central 1st", "Lead +4.0", "M# -"]);
  assert.doesNotMatch(readPart(leader, "Regular season"), /left/);
});

test("once the field is set, a game rained out and never made up counts as none left", () => {
  session.state = { ...session.state, projected: false };
  session.standings = {
    divisions: {
      "NL East": [
        row("PHI", 97, 64, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("NYM", 87, 75, { gb: "9.5", elim: "E", wcgb: "-", wce: "-", wcrank: "3" }),
      ],
    },
  };
  const sheet = renderTeamSheet("PHI").body;

  assert.doesNotMatch(readPart(sheet, "Regular season"), /left/);
});

const NL_CENTRAL_IN_OCTOBER = {
  divisions: {
    "NL Central": [
      row("MIL", 95, 67, { gb: "-", elim: "-", lead: true, clinched: true }),
      row("CHC", 91, 71, {
        gb: "4.0",
        elim: "E",
        wcgb: "+2.0",
        wce: "-",
        wcrank: "1",
      }),
    ],
  },
};

test("once the field is set, a club alive in the postseason shows it first, with how each series stands", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: {
      NL_WC2: { winsA: 1, winsB: 2, started: true },
      NL_DS1: { winsA: 1, winsB: 2, started: true },
    },
  };
  session.standings = NL_CENTRAL_IN_OCTOBER;
  const sheet = renderTeamSheet("CHC");

  assert.deepEqual(listParts(sheet.body), ["Playoffs", "Regular season", "Leaders", "Titles"]);
  assert.equal(
    readPart(sheet.body, "Playoffs"),
    "Alive NL WC Padres Won 2-1 NLDS Phillies Lead 2-1",
  );
  assert.match(sheet.body.text, /<button type="button" class="club team-open" data-team="SD"/);
});

test("a club with a bye shows it, and a series still to start shows no games", () => {
  session.state = { ...session.state, projected: false };
  const playoffs = readPart(renderTeamSheet("LAD").body, "Playoffs");

  assert.equal(playoffs, "Alive NL WC Bye NLDS TBD 0-0");
});

test("a club knocked out says how its series ended", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: { NL_WC1: { winsA: 2, winsB: 1, started: true } },
  };
  session.standings = {
    divisions: {
      "NL East": [
        row("PHI", 97, 65, { gb: "-", elim: "-", lead: true, clinched: true }),
        row("NYM", 87, 75, {
          gb: "10.0",
          elim: "E",
          wcgb: "-",
          wce: "-",
          wcrank: "3",
        }),
      ],
    },
  };
  const playoffs = readPart(renderTeamSheet("NYM").body, "Playoffs");

  assert.equal(playoffs, "Out NL WC Brewers Lost 1-2");
});

test("a series tied or trailing says so, and a club still in a projected field shows no postseason", () => {
  session.state = {
    ...session.state,
    projected: false,
    series: {
      NL_WC1: { winsA: 1, winsB: 1, started: true },
      NL_WC2: { winsA: 0, winsB: 1, started: true },
    },
  };
  assert.match(readText(renderTeamSheet("MIL").body), /NL WC Mets Tied 1-1/);
  assert.match(readText(renderTeamSheet("SD").body), /NL WC Cubs Trail 0-1/);
  session.state.projected = true;
  assert.deepEqual(listParts(renderTeamSheet("SD").body), ["Titles"]);
});

test("a club the standings don't list yet still shows its league and its titles", () => {
  const sheet = renderTeamSheet("COL");

  assert.equal(readText(sheet.note), "NL");
  assert.deepEqual(listParts(sheet.body), ["Titles"]);
  assert.equal(readPart(sheet.body, "Titles"), "Since 1993 None yet");
});

test("a season the store tracked adds its champion's title, whether the page kept one year or a list", () => {
  session.currentSeason = 2028;
  session.trackedTitles = { SEA: [2026, 2027] };
  assert.equal(readPart(renderTeamSheet("SEA").body, "Titles"), "Defending 2 | 2027, 2026");
  session.trackedTitles = { SEA: 2027 };
  assert.equal(readPart(renderTeamSheet("SEA").body, "Titles"), "Defending 1 | 2027");
});

test("every World Series since the first, but for 1904 and 1994, has one champion", () => {
  const champions = Object.values(TEAMS)
    .flatMap((team) => team.titles)
    .sort((first, second) => first - second);
  const played = Array.from({ length: 2025 - 1903 + 1 }, (_, index) => 1903 + index).filter(
    (year) => year !== 1904 && year !== 1994,
  );

  assert.deepEqual(champions, played);
});

// The Astros' slate the night of Sep 24: a loss at Seattle the night before, after a win there,
// tonight at the Athletics, then the Athletics again tomorrow, with another club's game on each
// day. The earlier days come newest first, so the cards can't take their order from the slate.
const ASTROS_SLATE = {
  previous: [
    {
      id: "910001",
      date: "2026-09-23",
      away: "HOU",
      home: "SEA",
      state: "final",
      start: "2026-09-24T02:10:00Z",
      score: [5, 6],
    },
    {
      id: "910002",
      date: "2026-09-23",
      away: "LAA",
      home: "TEX",
      state: "final",
      start: "2026-09-24T00:05:00Z",
      score: [2, 1],
    },
    {
      id: "910003",
      date: "2026-09-22",
      away: "HOU",
      home: "SEA",
      state: "final",
      start: "2026-09-23T02:10:00Z",
      score: [7, 3],
    },
  ],
  today: {
    date: "2026-09-24",
    games: [
      {
        id: "910004",
        away: "HOU",
        home: "ATH",
        state: "live",
        start: "2026-09-25T01:40:00Z",
        score: [2, 1],
        inning: 5,
        half: "top",
      },
      { id: "910005", away: "LAA", home: "SEA", state: "pre", start: "2026-09-25T01:40:00Z" },
    ],
  },
  next: [
    {
      id: "910006",
      date: "2026-09-25",
      away: "HOU",
      home: "ATH",
      state: "pre",
      start: "2026-09-26T01:40:00Z",
    },
    {
      id: "910007",
      date: "2026-09-26",
      away: "HOU",
      home: "ATH",
      state: "pre",
      start: "2026-09-26T20:05:00Z",
    },
  ],
};

/** @param {{ text: string }} body */
const listCards = (body) =>
  [...body.text.matchAll(/<div class="game-card">([\s\S]*?)<\/button>\s*<\/div>/g)].map(([card]) =>
    readText(card),
  );

/** @param {{ text: string }} body */
const listCardButtons = (body) =>
  [...body.text.matchAll(/data-game="([^"]*)"\s*aria-label="([^"]*)"/g)].map(([, key, label]) => [
    key,
    label,
  ]);

test("a club's sheet opens on cards of its last game, the one it's playing, and its next, each opening the game", () => {
  session.state = { ...session.state, slate: ASTROS_SLATE };
  const { body } = renderTeamSheet("HOU");

  assert.deepEqual(listCards(body), [
    "Last game Sep 23 L 5-6 @ SEA",
    "Now Top 5th UP 2-1 @ ATH",
    "Next game Sep 25 9:40 PM @ ATH",
  ]);
  assert.deepEqual(listCardButtons(body), [
    ["910001 2026-09-23", "Game details: Astros at Mariners, Wed, Sep 23"],
    ["910004 2026-09-24", "Game details: Astros at Athletics, Thu, Sep 24"],
    ["910006 2026-09-25", "Game details: Astros at Athletics, Fri, Sep 25"],
  ]);
  assert.ok(body.text.indexOf('class="game-cards"') < body.text.indexOf("<h3>"));
});

test("a club's cards take a doubleheader's games in game order, and skip a postponed game and one whose other club isn't known", () => {
  session.state = {
    ...session.state,
    slate: {
      today: {
        date: "2026-09-24",
        games: [
          {
            away: "NYM",
            home: "PHI",
            state: "pre",
            start: "2026-09-24T17:05:00Z",
            tbd: true,
            doubleheader: 2,
          },
          {
            away: "NYM",
            home: "PHI",
            state: "final",
            start: "2026-09-24T17:05:00Z",
            doubleheader: 1,
            score: [3, 4],
          },
        ],
        postponed: [{ away: "NYM", home: "MIA", state: "off", start: "2026-09-24T22:40:00Z" }],
      },
      next: [
        {
          date: "2026-09-25",
          away: "NYM",
          home: "MIA",
          state: "off",
          start: "2026-09-25T22:40:00Z",
        },
        { date: "2026-09-30", home: "MIL", state: "pre", start: "2026-09-30T22:40:00Z" },
        {
          date: "2026-10-01",
          away: "NYM",
          home: "MIL",
          state: "pre",
          start: "2026-10-01T22:40:00Z",
        },
      ],
    },
  };

  assert.deepEqual(listCards(renderTeamSheet("NYM").body), [
    "Last game Sep 24 L 3-4 @ PHI",
    "Next game Sep 24 After 1st game @ PHI",
  ]);
  assert.deepEqual(listCards(renderTeamSheet("MIL").body), ["Next game Oct 1 6:40 PM vs NYM"]);
});

test("a club with no games on the slate, as in a past season, shows no cards", () => {
  session.state = { ...session.state, slate: null };
  assert.doesNotMatch(renderTeamSheet("HOU").body.text, /game-cards/);
});

/** @param {string} label */
const readRankRow = (markup, label) =>
  readText(
    markup.text.match(
      new RegExp(`<span class="player-rank-label">${label}</span>([\\s\\S]*?)</div>`),
    )?.[1] ?? "",
  );

const NL_WEST_FINAL = {
  divisions: {
    "NL West": [
      row("LAD", 100, 62, {
        gb: "-",
        elim: "-",
        lead: true,
        clinched: true,
        rs: 801,
        ra: 600,
        home: "51-30",
        road: "49-32",
      }),
      row("SD", 91, 71, {
        gb: "9.0",
        elim: "E",
        wcgb: "+3.0",
        wce: "-",
        wcrank: "1",
        rs: 700,
        ra: 650,
        home: "50-31",
        road: "41-40",
      }),
      row("COL", 50, 112, {
        gb: "50.0",
        elim: "E",
        wcgb: "40.0",
        wce: "E",
        rs: 600,
        ra: 900,
        home: "30-51",
        road: "20-61",
      }),
    ],
  },
};

test("a club's season ranks its runs and runs allowed a game, its margin a game, and its records at home and on the road among every club's, each on a curve", () => {
  session.standings = NL_WEST_FINAL;
  const { body } = renderTeamSheet("SD");

  assert.deepEqual(
    [...body.text.matchAll(/<span class="player-rank-label">(.*?)<\/span>/g)].map(
      ([, label]) => label,
    ),
    ["R/G", "RA/G", "Diff/G", "Home", "Road"],
  );
  assert.equal(readRankRow(body, "R/G"), "4.32 2nd of 3");
  assert.equal(readRankRow(body, "RA/G"), "4.01 2nd of 3");
  assert.equal(readRankRow(body, "Diff/G"), "+0.31 2nd of 3");
  assert.equal(readRankRow(body, "Home"), "50-31 2nd of 3");
  assert.equal(readRankRow(body, "Road"), "41-40 2nd of 3");
  assert.equal((body.text.match(/class="player-curve"/g) ?? []).length, 5);
});

test("a club whose standings row has no runs, as a season saved before the store kept them, shows no curves", () => {
  session.standings = NL_WEST_IN_SEPTEMBER;
  assert.doesNotMatch(renderTeamSheet("LAD").body.text, /team-ranks/);
});

test("a club's postseason sets its numbers across from the playoff field's, each a dot on a line solid over the regular season's range and dashed past it, with the legend under them", () => {
  session.state = { ...session.state, projected: false, slate: null };
  session.standings = NL_WEST_FINAL;
  /** @param {string} away @param {string} home @param {[number, number]} score */
  const final = (away, home, score, date) => ({
    date,
    id: `${away}-${home}-${date}`,
    away,
    home,
    state: "final",
    score,
    postseason: true,
    series: "NL_DS1",
    start: `${date}T20:00:00Z`,
  });
  session.schedule = [
    final("ATL", "LAD", [3, 5], "2026-10-03"),
    final("ATL", "LAD", [3, 2], "2026-10-04"),
    final("LAD", "ATL", [3, 1], "2026-10-06"),
    final("SD", "MIL", [2, 3], "2026-10-03"),
    { ...final("LAD", "ATL", [0, 0], "2026-10-07"), state: "live" },
  ];
  const { body } = renderTeamSheet("LAD");
  session.schedule = null;

  assert.equal(
    readText(body.text.match(/<div class="field-heads">[\s\S]*?<\/div>/)?.[0] ?? ""),
    "Dodgers 2-1 Playoff field",
  );
  const rows = [
    ...body.text.matchAll(
      /<span class="player-rank-label">(.*?)<\/span>\s*<span class="player-rank-value tabular">(.*?)<\/span>[\s\S]*?<span class="placed-other tabular">(.*?)<\/span>/g,
    ),
  ].map(([, label, own, field]) => `${label} ${own} ${field}`);
  assert.deepEqual(rows, [
    "R/G 3.33 2.75",
    "RA/G 2.33 2.75",
    "Diff/G +1.00 0.00",
    "Home 1-1 2-2",
    "Road 1-0 2-2",
  ]);
  assert.equal((body.text.match(/<i class="own"/g) ?? []).length, 5);
  const runs = body.text
    .split('<div class="player-rank-row">')
    .find((each) => each.includes(">R/G</span>") && each.includes("placed-line"));
  assert.match(runs ?? "", /<b class="placed-past toward-start"[^>]*><\/b><b class="placed-range"/);
  assert.match(
    readText(body.text.match(/<div class="team-numbers">[\s\S]*?<\/p>/)?.[0] ?? ""),
    / Road 1-0 2-2 Regular season range for all teams Playoffs range, beyond regular season range$/,
  );
});

test("a club's leaders show on its sheet once its roster is read, and not for a season the store keeps no rosters for", () => {
  session.standings = NL_WEST_FINAL;
  reopenRoster({
    club: "SD",
    roster: {
      club: "SD",
      season: 2026,
      players: [
        {
          id: 1,
          name: "Manny Machado",
          number: "13",
          position: "3B",
          injury: null,
          hitting: {
            plateAppearances: 650,
            avg: ".275",
            homeRuns: 27,
            rbi: 95,
            ops: ".800",
            stolenBases: 13,
          },
        },
        {
          id: 2,
          name: "Robert Suarez",
          number: "75",
          position: "P",
          injury: null,
          pitching: {
            gamesPlayed: 70,
            gamesStarted: 0,
            era: "2.50",
            wins: 4,
            losses: 3,
            inningsPitched: "68.1",
            strikeOuts: 70,
            saves: 40,
          },
        },
      ],
    },
  });
  const rows = [
    ...renderTeamSheet("SD").body.text.matchAll(
      /<span class="leader-stat">(.*?)<\/span>.*?>([^<]+)<\/button>/g,
    ),
  ].map(([, stat, name]) => `${stat} ${name}`);
  assert.deepEqual(rows, [
    "AVG Manny Machado",
    "OPS Manny Machado",
    "HR Manny Machado",
    "RBI Manny Machado",
    "SB Manny Machado",
    "K Robert Suarez",
    "IP Robert Suarez",
    "SV Robert Suarez",
  ]);

  session.activeYear = 2025;
  assert.ok(!listParts(renderTeamSheet("SD").body).includes("Leaders"));
});

test("a club's sheet title is its name with the city in it, and the Athletics', which names none, its name alone", () => {
  assert.equal(readText(renderTeamSheet("NYM").heading), "New York Mets");
  assert.equal(readText(renderTeamSheet("ATH").heading), "Athletics");
  assert.equal(nameClubFully("KC"), "Kansas City Royals");
  assert.equal(nameClubFully("TB"), "Tampa Bay Rays");
});
