// `since` is ten minutes before the snapshot: only a final newer than that leads the line.
import test from "node:test";
import assert from "node:assert/strict";
import { describeLastStamp, describeSeriesNote, describeUpNextGame } from "../page/js/stamp.js";
import { normalizeSpaces, readStampText } from "../../../tests/text.js";
import { EASTERN, useTimeZone } from "../../../tests/time-zone.js";

// The expected times below are what a viewer in Eastern time sees.
useTimeZone(EASTERN);

// September and early October are EDT, UTC-4.
const toEasternIso = (date, time) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + 4, minute)).toISOString();
};
const TODAY = "2026-09-24",
  YESTERDAY = "2026-09-23";

const createPregame = (away, home, start, date = TODAY) => ({
  away,
  home,
  start: toEasternIso(date, start),
  state: "pre",
});
const createLiveGame = (away, home, start, score, inning, date = TODAY) => ({
  away,
  home,
  start: toEasternIso(date, start),
  state: "live",
  score,
  inning,
});
const createFinal = (away, home, start, score, end, date = TODAY, endDate = date) => ({
  away,
  home,
  start: toEasternIso(date, start),
  state: "final",
  score,
  end: toEasternIso(endDate, end),
});

const LATE_MATCHUPS = [
  ["NYM", "TEX"],
  ["MIA", "CHC"],
  ["CIN", "ATL"],
  ["BOS", "NYY"],
  ["CLE", "BOS"],
  ["SD", "LAD"],
  ["LAA", "SEA"],
  ["HOU", "ATH"],
  ["MIN", "TEX"],
  ["DET", "PIT"],
  ["SF", "COL"],
  ["TOR", "BAL"],
  ["WSH", "NYM"],
  ["ARI", "SF"],
  ["KC", "MIN"],
  ["STL", "MIL"],
];
const listLaterGames = (count, start = "19:05", date = TODAY) =>
  LATE_MATCHUPS.slice(0, count).map(([away, home]) => createPregame(away, home, start, date));

function createContext(options = {}) {
  return {
    ranking: options.ranking || [
      "CWS",
      "MIL",
      "CHC",
      "CLE",
      "TB",
      "SD",
      "BOS",
      "HOU",
      "LAD",
      "ATL",
      "NYY",
      "PHI",
    ],
    alive: options.out ? (id) => !options.out.includes(id) : () => true,
    seriesNote: options.seriesNote || (() => ""),
    now: new Date(options.now || toEasternIso(TODAY, "12:00")),
  };
}
const describeLast = (slate, context = createContext()) =>
  readStampText(describeLastStamp(slate, context));
const describeUpNext = (slate, context = createContext()) => describeUpNextGame(slate, context);

test("the night's last final, with the day's clause", () => {
  const slate = {
    since: toEasternIso(TODAY, "01:21"),
    today: {
      date: YESTERDAY,
      games: [
        createFinal("HOU", "SEA", "21:40", [5, 6], "01:30", YESTERDAY, TODAY),
        ...listLaterGames(15, "19:05", YESTERDAY).map((game) => ({
          ...game,
          state: "final",
          score: [2, 1],
          end: toEasternIso(YESTERDAY, "22:00"),
        })),
      ],
    },
    nextDay: {
      date: TODAY,
      games: [
        createPregame("STL", "PIT", "12:35"),
        createPregame("CWS", "KC", "14:10"),
        ...listLaterGames(10),
      ],
    },
  };
  assert.equal(describeLast(slate), "Mariners 6 Astros 5 final at 1:30 AM, slate of 16 over");
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso(TODAY, "12:35"),
    tbd: false,
    text: "Cardinals @ Pirates, starts slate of 12",
  });
});

test("a morning with nothing on: the final in the small hours", () => {
  const slate = {
    since: toEasternIso(TODAY, "02:21"),
    today: {
      date: TODAY,
      games: [
        createPregame("SD", "SF", "16:05"),
        createPregame("STL", "PIT", "18:35"),
        ...listLaterGames(4),
      ],
    },
    lastFinal: createFinal("HOU", "SEA", "21:40", [5, 6], "01:30", YESTERDAY, TODAY),
  };
  assert.equal(
    describeLast(slate, createContext({ now: toEasternIso(TODAY, "13:17") })),
    "Last game Mariners 6 Astros 5 final at 1:30 AM today",
  );
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso(TODAY, "16:05"),
    tbd: false,
    text: "Padres @ Giants, starts slate of 6",
  });
});

test("a final's time, and its day when it isn't today, are set apart as the stamp's times are", () => {
  const slate = {
    today: {
      date: TODAY,
      games: [
        createFinal("STL", "PIT", "12:35", [4, 1], "15:30"),
        createPregame("CWS", "KC", "19:10"),
      ],
    },
  };
  const markup = normalizeSpaces(describeLastStamp(slate, createContext()));
  assert.match(markup, /final at <b>3:30<span class="ap">PM<\/span><\/b>/);
  const lastFinal = createFinal("HOU", "SEA", "18:40", [5, 6], "21:30", YESTERDAY, YESTERDAY);
  const yesterday = { today: { date: TODAY, games: [] }, lastFinal };
  assert.match(
    normalizeSpaces(
      describeLastStamp(yesterday, createContext({ now: toEasternIso(TODAY, "13:17") })),
    ),
    /final at <b>9:30<span class="ap">PM<\/span> yesterday<\/b>/,
  );
});

test("early afternoon: one game on, and the next first pitch still shows", () => {
  const slate = {
    since: toEasternIso(TODAY, "02:21"),
    today: {
      date: TODAY,
      games: [
        createLiveGame("STL", "PIT", "12:35", [1, 1], 3),
        createPregame("CWS", "KC", "14:10"),
        ...listLaterGames(10),
      ],
    },
  };
  assert.equal(
    describeLast(slate),
    "NOW Cardinals @ Pirates 1-1 in the 3rd, slate of 12 under way",
  );
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso(TODAY, "14:10"),
    tbd: false,
    text: "White Sox @ Royals",
  });
});

test("your club's game leads while games are on", () => {
  const slate = {
    since: toEasternIso(TODAY, "13:17"),
    today: {
      date: TODAY,
      games: [
        createLiveGame("STL", "PIT", "12:35", [3, 2], 6),
        createLiveGame("CWS", "KC", "14:10", [2, 0], 1),
        ...listLaterGames(10),
      ],
    },
  };
  assert.equal(describeLast(slate), "NOW White Sox @ Royals 2-0 in the 1st, slate of 12 under way");
});

test("a fresh final outranks the games still going", () => {
  const slate = {
    since: toEasternIso(TODAY, "21:00"),
    today: {
      date: TODAY,
      games: [
        createFinal("TB", "NYY", "19:05", [2, 5], "21:14"),
        createLiveGame("CWS", "KC", "19:40", [4, 4], 7),
        createFinal("STL", "PIT", "12:35", [3, 2], "15:40"),
        ...listLaterGames(9, "19:10").map((game) => ({
          ...game,
          state: "live",
          score: [0, 0],
          inning: 5,
        })),
      ],
    },
  };
  assert.equal(describeLast(slate), "Yankees 5 Rays 2 final at 9:14 PM, slate of 12 under way");
});

test("between the afternoon and the evening: the newest final, then the next first pitch", () => {
  const slate = {
    since: toEasternIso(TODAY, "16:15"),
    today: {
      date: TODAY,
      games: [
        createFinal("STL", "PIT", "12:35", [3, 2], "15:40"),
        createFinal("MIN", "DET", "13:10", [1, 7], "16:02"),
        ...listLaterGames(10),
      ],
    },
  };
  assert.equal(describeLast(slate), "Tigers 7 Twins 1 final at 4:02 PM, slate of 12 under way");
  // Every late game starts at 7:05, so the ranking picks the Cubs. No "starts slate of"
  // once the day's first game has started.
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso(TODAY, "19:05"),
    tbd: false,
    text: "Marlins @ Cubs",
  });
});

test("ties go to your ranking, then to a club still alive", () => {
  const firstGame = createLiveGame("TOR", "BAL", "19:05", [1, 0], 4),
    secondGame = createLiveGame("WSH", "DET", "19:05", [2, 2], 4);
  const games = [firstGame, secondGame, createPregame("SD", "LAD", "22:10")];
  const slate = { since: toEasternIso(TODAY, "19:15"), today: { date: TODAY, games } };
  assert.equal(
    describeLast(slate, createContext({ ranking: [], out: ["WSH", "DET"] })),
    "NOW Blue Jays @ Orioles 1-0 in the 4th, slate of 3 under way",
  );
  assert.equal(
    describeLast(slate, createContext({ ranking: ["DET"], out: ["WSH", "DET"] })),
    "NOW Nationals @ Tigers 2-2 in the 4th, slate of 3 under way",
  );
});

test("when several games start first, the next line still names your club's", () => {
  const firstPitches = [
    createPregame("TOR", "BAL", "15:05"),
    createPregame("MIA", "CHC", "15:05"),
    createPregame("SEA", "TEX", "15:05"),
    createPregame("PIT", "DET", "15:05"),
  ];
  const slate = {
    today: { date: TODAY, games: [...firstPitches, ...listLaterGames(10, "15:10")] },
  };
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso(TODAY, "15:05"),
    tbd: false,
    text: "Marlins @ Cubs, starts slate of 14",
  });
});

test("every game final: the slate is over, and the next line looks to tomorrow", () => {
  const games = [
    createFinal("SD", "LAD", "22:10", [4, 1], "01:02", TODAY, "2026-09-25"),
    ...listLaterGames(15).map((game) => ({
      ...game,
      state: "final",
      score: [3, 1],
      end: toEasternIso(TODAY, "22:05"),
    })),
  ];
  const slate = {
    since: toEasternIso(TODAY, "23:15"),
    today: { date: TODAY, games },
    nextDay: {
      date: "2026-09-25",
      games: [
        createPregame("NYY", "BAL", "13:05", "2026-09-25"),
        createPregame("TB", "TOR", "19:07", "2026-09-25"),
      ],
    },
  };
  assert.equal(describeLast(slate), "Padres 4 Dodgers 1 final at 1:02 AM, slate of 16 over");
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso("2026-09-25", "13:05"),
    tbd: false,
    text: "Yankees @ Orioles",
  });
});

test("one or two games: named, with no slate", () => {
  const two = {
    since: toEasternIso(TODAY, "19:15"),
    today: {
      date: TODAY,
      games: [
        createLiveGame("CWS", "KC", "19:40", [1, 0], 2),
        createLiveGame("TB", "NYY", "19:05", [3, 3], 5),
      ],
    },
  };
  assert.equal(
    describeLast(two),
    "NOW Rays @ Yankees 3-3 in the 5th, White Sox @ Royals 1-0 in the 2nd",
  );
  const oneOver = {
    since: toEasternIso(TODAY, "21:15"),
    today: {
      date: TODAY,
      games: [
        createFinal("TB", "NYY", "19:05", [2, 5], "21:58"),
        createLiveGame("CWS", "KC", "20:10", [1, 0], 6),
      ],
    },
  };
  assert.equal(describeLast(oneOver), "NOW White Sox @ Royals 1-0 in the 6th");
  const one = {
    since: toEasternIso(TODAY, "12:15"),
    today: { date: TODAY, games: [createPregame("HOU", "SEA", "21:40")] },
  };
  assert.deepEqual(describeUpNext(one), {
    at: toEasternIso(TODAY, "21:40"),
    tbd: false,
    text: "Astros @ Mariners",
  });
});

test("an off day, and a final from days back", () => {
  const slate = {
    since: toEasternIso(TODAY, "12:15"),
    today: { date: TODAY, games: [] },
    lastFinal: createFinal("TOR", "BAL", "19:05", [3, 4], "22:01", "2026-09-21"),
  };
  assert.equal(
    describeLast(slate, createContext({ now: toEasternIso(TODAY, "13:15") })),
    "Last game Orioles 4 Blue Jays 3 final at 10:01 PM Monday",
  );
  assert.equal(describeUpNext(slate), null);
});

test("a final from over a week back gives its date", () => {
  const slate = {
    since: toEasternIso(TODAY, "12:15"),
    today: { date: TODAY, games: [] },
    lastFinal: createFinal("TOR", "BAL", "19:05", [3, 4], "22:01", "2026-09-14"),
  };
  assert.equal(
    describeLast(slate, createContext({ now: toEasternIso(TODAY, "13:15") })),
    "Last game Orioles 4 Blue Jays 3 final at 10:01 PM Sep 14",
  );
});

test("a first pitch MLB hasn't timed yet says so", () => {
  const slate = {
    today: { date: TODAY, games: [] },
    nextDay: {
      date: "2026-09-29",
      games: [{ ...createPregame("DET", "CLE", "03:33", "2026-09-29"), tbd: true }],
    },
  };
  assert.deepEqual(describeUpNext(slate), {
    at: toEasternIso("2026-09-29", "03:33"),
    tbd: true,
    text: "Tigers @ Guardians",
  });
});

test("in October a final says what it did to the series: who now leads, that it's even, or who won which round", () => {
  const slate = {
    since: toEasternIso(TODAY, "23:15"),
    today: { date: TODAY, games: [createFinal("CHC", "MIL", "20:08", [1, 4], "23:41")] },
  };
  /** @param {{ winsA: number, winsB: number, winner: string | null }} standing */
  const describeAfter = (standing) =>
    describeLast(
      slate,
      createContext({
        seriesNote: () =>
          describeSeriesNote({ id: "NL_DS2", teamA: "MIL", teamB: "CHC", ...standing }),
      }),
    );
  assert.equal(
    describeAfter({ winsA: 2, winsB: 0, winner: null }),
    "Brewers 4 Cubs 1 final at 11:41 PM \u2014 Brewers now lead 2-0",
  );
  assert.equal(
    describeAfter({ winsA: 2, winsB: 2, winner: null }),
    "Brewers 4 Cubs 1 final at 11:41 PM \u2014 series even 2-2",
  );
  assert.equal(
    describeAfter({ winsA: 3, winsB: 1, winner: "MIL" }),
    "Brewers 4 Cubs 1 final at 11:41 PM \u2014 Brewers win the NLDS 3-1",
  );
});

test("the series a final leaves says who now leads, that it's even, or who won which round", () => {
  const series = { id: "NL_DS2", teamA: "MIL", teamB: "CHC", winner: null };
  assert.equal(describeSeriesNote({ ...series, winsA: 1, winsB: 2 }), " \u2014 Cubs now lead 2-1");
  assert.equal(describeSeriesNote({ ...series, winsA: 2, winsB: 2 }), " \u2014 series even 2-2");
  assert.equal(
    describeSeriesNote({ ...series, winsA: 3, winsB: 1, winner: "MIL" }),
    " \u2014 Brewers win the NLDS 3-1",
  );
  assert.equal(describeSeriesNote(null), "");
});

test("no sentence is ever a bare matchup or 'under way with'", () => {
  const days = [
    [
      createLiveGame("STL", "PIT", "12:35", [1, 1], 3),
      createPregame("CWS", "KC", "14:10"),
      ...listLaterGames(10),
    ],
    [
      createFinal("STL", "PIT", "12:35", [4, 1], "15:30"),
      createPregame("CWS", "KC", "14:10"),
      ...listLaterGames(10),
    ],
    [createLiveGame("CWS", "KC", "14:10", [2, 0], 1), ...listLaterGames(11)],
  ];
  for (const games of days) {
    const line = describeLast({
      since: toEasternIso(TODAY, "02:21"),
      today: { date: TODAY, games },
    });
    assert.doesNotMatch(line, /under way with/, line);
    for (const match of line.matchAll(/@ [A-Z][a-zA-Z ]+?(?=,|$| \d| first)/g)) {
      const after = line.slice(match.index + match[0].length);
      assert.match(after, /^( \d+-\d+ in the| first pitch at)/, line);
    }
  }
});
