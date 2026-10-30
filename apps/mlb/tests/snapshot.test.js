import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitPostseasonGames } from "../page/js/feed-postseason.js";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { GAME_DAY_CHECK_MS, OFF_DAY_CHECK_MS } from "#shared/poll-schedule.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}.json`, "utf8"));
const SEASON_2025 = readFixture("2025-final");
const EVENING = readFixture("2026-09-24-evening");
const BROADCASTS = readFixture("2026-10-07-broadcasts");
const DIVISION_SERIES = readFixture("2026-10-07-evening");
const buildSnapshot = (fixture, now = Date.parse(fixture.now)) =>
  MLBSnapshot.buildSnapshot(fixture.responses, { season: fixture.season, now });

// Games from `cutoff` on become unplayed, with undecided clubs under MLB's placeholder names.
const PLACEHOLDER = {
  CS: ["Lower Seed", "Higher Seed"],
  WS: ["Lower Seed League Champion", "Higher Seed League Champion"],
};
const DIVISION_SERIES_HOSTS = [136, 141, 143, 158];
// A division series opponent not yet known is named for both clubs that could be it.
const WILD_CARD_PLACEHOLDERS = {
  147: "NYY/BOS",
  111: "NYY/BOS",
  114: "CLE/DET",
  116: "CLE/DET",
  112: "CHC/SD",
  135: "CHC/SD",
  119: "LAD/CIN",
  113: "LAD/CIN",
};
function rewindFixture(fixture, cutoff, { unsetRounds = [], unsetWildCardWinners = false } = {}) {
  const copy = JSON.parse(JSON.stringify(fixture));
  let placeholderId = 9000;
  for (const day of copy.responses.postseason.dates) {
    for (const game of day.games) {
      if (Date.parse(game.gameDate) < Date.parse(cutoff)) continue;
      game.status = {
        abstractGameState: "Preview",
        codedGameState: "S",
        detailedState: "Scheduled",
        startTimeTBD: false,
      };
      delete game.teams.away.score;
      delete game.teams.home.score;
      delete game.gameInfo;
      const league = game.seriesDescription.slice(0, 2);
      const round = { L: "CS", W: "WS" }[game.gameType];
      if (round && unsetRounds.includes(round)) {
        const [lowerSeed, higherSeed] = PLACEHOLDER[round];
        game.teams.away.team = {
          id: placeholderId++,
          name: round === "WS" ? lowerSeed : `${league} ${lowerSeed}`,
        };
        game.teams.home.team = {
          id: placeholderId++,
          name: round === "WS" ? higherSeed : `${league} ${higherSeed}`,
        };
      }
      if (game.gameType === "D" && unsetWildCardWinners) {
        const wildCardSide = DIVISION_SERIES_HOSTS.includes(game.teams.home.team.id)
          ? "away"
          : "home";
        const wildCardTeamId = game.teams[wildCardSide].team.id;
        game.teams[wildCardSide].team = {
          id: placeholderId++,
          name: WILD_CARD_PLACEHOLDERS[wildCardTeamId],
        };
      }
    }
  }
  return copy;
}

test("2025: the official field comes from the postseason schedule, seeded", () => {
  const snapshot = buildSnapshot(SEASON_2025);
  assert.equal(snapshot.projected, false);
  const listSeeds = (league) =>
    Object.entries(snapshot.teams)
      .filter(([, team]) => team.league === league)
      .sort((first, second) => first[1].seed - second[1].seed)
      .map(([id]) => id);
  assert.deepEqual(listSeeds("AL"), ["TOR", "SEA", "CLE", "NYY", "BOS", "DET"]);
  assert.deepEqual(listSeeds("NL"), ["MIL", "PHI", "LAD", "CHC", "SD", "CIN"]);
  assert.deepEqual(snapshot.teams.TOR, { league: "AL", seed: 1, w: 94, l: 68 });
});

test("2025: a division tied at the end is won by the club MLB's tiebreaker names", () => {
  const [toronto, yankees] = buildSnapshot(SEASON_2025).standings.divisions["AL East"];
  assert.deepEqual([toronto.id, toronto.w, toronto.l], ["TOR", 94, 68]);
  assert.deepEqual([yankees.id, yankees.w, yankees.l], ["NYY", 94, 68]);
  assert.equal(toronto.clinched, true);
  assert.equal(toronto.magic, null);
  assert.equal(yankees.clinched, false);
});

test("2025: MLB calling a wild card club a division champion doesn't move its series", () => {
  const fixture = JSON.parse(JSON.stringify(SEASON_2025));
  const cubs = fixture.responses.standings.records
    .flatMap((division) => division.teamRecords)
    .find((record) => record.team.id === 112);
  cubs.divisionChamp = true;
  const snapshot = buildSnapshot(fixture);
  assert.equal(snapshot.projected, false);
  assert.deepEqual(snapshot.series, buildSnapshot(SEASON_2025).series);
});

test("2025: every series record, and no next game once decided", () => {
  const { series } = buildSnapshot(SEASON_2025);
  const readRecord = (id) => [series[id].winsA, series[id].winsB];
  assert.deepEqual(readRecord("AL_WC1"), [1, 2]);
  assert.deepEqual(readRecord("AL_WC2"), [2, 1]);
  assert.deepEqual(readRecord("AL_DS1"), [3, 1]);
  assert.deepEqual(readRecord("AL_DS2"), [3, 2]);
  assert.deepEqual(readRecord("AL_CS"), [4, 3]);
  assert.deepEqual(readRecord("NL_WC1"), [2, 0]);
  assert.deepEqual(readRecord("NL_DS2"), [1, 3]);
  assert.deepEqual(readRecord("NL_CS"), [0, 4]);
  assert.deepEqual(readRecord("WS"), [3, 4]);
  assert.ok(Object.values(series).every((seriesRecord) => !seriesRecord.next));
});

test("2025: the log has every game, oldest first, a clinch closing each series", () => {
  const { log } = buildSnapshot(SEASON_2025);
  assert.equal(log.length, 47);
  assert.equal(log.filter((entry) => entry.kind === "clinch").length, 11);
  assert.ok(
    log.every((entry, index) => !index || Date.parse(log[index - 1].at) <= Date.parse(entry.at)),
  );
  assert.deepEqual(log[0], {
    at: "2025-09-30T19:42:00Z",
    kind: "game",
    series: "AL_WC1",
    won: "DET",
    lost: "CLE",
    game: 1,
    score: [1, 0],
    runs: [2, 1],
  });
  const lastEntry = log[log.length - 1];
  assert.deepEqual(
    { ...lastEntry, at: undefined },
    {
      at: undefined,
      kind: "clinch",
      series: "WS",
      team: "LAD",
      over: "TOR",
      score: [4, 3],
      runs: [5, 4],
    },
  );
});

test("a bracket just set: twelve real clubs, division series opponents still placeholders", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
      unsetRounds: ["CS", "WS"],
      unsetWildCardWinners: true,
    }),
    Date.parse("2025-09-29T16:00:00Z"),
  );
  assert.equal(snapshot.projected, false);
  assert.equal(snapshot.teams.TOR.seed, 1);
  assert.equal(snapshot.teams.DET.seed, 6);
  assert.deepEqual(snapshot.log, []);
  assert.deepEqual(snapshot.series.AL_WC1, {
    winsA: 0,
    winsB: 0,
    next: { at: "2025-09-30T17:08:00Z", date: "2025-09-30", tbd: false, game: 1 },
  });
  // The 4/5 winner goes to the 1 seed: DS1 is Toronto's series.
  assert.equal(snapshot.series.AL_DS1.next.date, "2025-10-04");
  assert.ok(snapshot.series.WS.next);
});

test("a series counts as started once its first game is under way, with no wins yet", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
    unsetRounds: ["CS", "WS"],
    unsetWildCardWinners: true,
  });
  const gameOne = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .find((game) => game.gameDate === "2025-09-30T17:08:00Z");
  gameOne.status = { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" };
  const { series } = buildSnapshot(fixture, Date.parse("2025-09-30T17:30:00Z"));
  assert.equal(series.AL_WC1.started, true);
  assert.deepEqual([series.AL_WC1.winsA, series.AL_WC1.winsB], [0, 0]);
  assert.equal(series.AL_WC2.started, undefined);
  assert.equal(series.AL_DS1.started, undefined);
});

test("a series counts as started once the schedule shows its first game under way", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
    unsetRounds: ["CS", "WS"],
    unsetWildCardWinners: true,
  });
  const gameOne = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .find((game) => game.gameDate === "2025-09-30T17:08:00Z");
  const liveGameOne = {
    ...structuredClone(gameOne),
    status: { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" },
  };
  fixture.responses.schedule = { dates: [{ date: "2025-09-30", games: [liveGameOne] }] };
  const { series } = buildSnapshot(fixture, Date.parse("2025-09-30T17:30:00Z"));
  assert.equal(series.AL_WC1.started, true);
  assert.equal(series.AL_WC2.started, undefined);
});

test("every series of a finished postseason counts as started", () => {
  const { series } = buildSnapshot(SEASON_2025);
  assert.ok(Object.values(series).every((seriesRecord) => seriesRecord.started));
});

test("a game still live past midnight Eastern is its series' next game", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-28T00:00:00Z");
  const game3 = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .find((game) => game.gameType === "W" && game.seriesGameNumber === 3);
  game3.status = { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" };
  const { series } = buildSnapshot(fixture, Date.parse("2025-10-28T05:30:00Z"));
  assert.equal(series.WS.next.date, "2025-10-27");
});

test("halfway: division series under way, the next game named, later rounds waiting", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] }),
    Date.parse("2025-10-08T14:00:00Z"),
  );
  const { series } = snapshot;
  assert.deepEqual([series.AL_WC1.winsA, series.AL_WC1.winsB], [1, 2]);
  assert.equal(series.AL_WC1.next, undefined);
  assert.deepEqual([series.AL_DS1.winsA, series.AL_DS1.winsB], [2, 1]);
  assert.equal(series.AL_DS1.next.game, 4);
  assert.deepEqual([series.AL_CS.winsA, series.AL_CS.winsB], [0, 0]);
  assert.equal(snapshot.log.filter((entry) => entry.kind === "clinch").length, 4);
});

const indexStandingsRows = (snapshot) =>
  Object.fromEntries(
    Object.values(snapshot.standings.divisions)
      .flat()
      .map((row) => [row.id, row]),
  );

test("a bracket just set: each club's next postseason game, opponent or not", () => {
  const snapshot = buildSnapshot(
    rewindFixture(SEASON_2025, "2025-09-30T00:00:00Z", {
      unsetRounds: ["CS", "WS"],
      unsetWildCardWinners: true,
    }),
    Date.parse("2025-09-29T16:00:00Z"),
  );
  const rows = indexStandingsRows(snapshot);
  assert.deepEqual(rows.DET.next, {
    at: "2025-09-30T17:08:00Z",
    date: "2025-09-30",
    opp: "CLE",
    home: false,
    tbd: false,
    postseason: true,
  });
  assert.deepEqual(rows.TOR.next, {
    at: "2025-10-04T20:08:00Z",
    date: "2025-10-04",
    home: true,
    tbd: false,
    postseason: true,
  });
  assert.equal(rows.KC.next, undefined);
});

// MLB can still list game 3 of a wild card series swept in two.
function addUnneededGame(fixture, date) {
  const [unneeded] = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .filter(
      (game) => game.seriesDescription === "NL Wild Card Series" && game.teams.home.team.id === 119,
    )
    .map((game) => ({
      ...game,
      gamePk: 1,
      seriesGameNumber: 3,
      officialDate: date,
      gameDate: `${date}T23:08:00Z`,
    }));
  unneeded.status = {
    abstractGameState: "Preview",
    codedGameState: "S",
    detailedState: "Scheduled",
  };
  fixture.responses.postseason.dates.push({ games: [unneeded] });
}

test("halfway: a decided series' unneeded game isn't next, and a club that's out has none", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] });
  addUnneededGame(fixture, "2025-10-02");
  const rows = indexStandingsRows(buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z")));
  assert.deepEqual(rows.LAD.next, {
    at: "2025-10-09T01:08:00Z",
    date: "2025-10-08",
    opp: "PHI",
    home: true,
    tbd: false,
    postseason: true,
  });
  assert.deepEqual(rows.TOR.next, {
    at: "2025-10-08T23:08:00Z",
    date: "2025-10-08",
    opp: "NYY",
    home: false,
    tbd: false,
    postseason: true,
  });
  assert.equal(rows.CLE.next, undefined);
});

test("halfway: a decided series' unneeded game isn't in the list of next games", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z", { unsetRounds: ["CS", "WS"] });
  addUnneededGame(fixture, "2025-10-10");
  fixture.responses.schedule = { dates: [] };
  const { slate } = buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z"));
  assert.ok(slate.next.some((game) => game.home === "LAD" || game.away === "LAD"));
  assert.ok(slate.next.every((game) => game.home !== "CIN" && game.away !== "CIN"));
  assert.ok(slate.previous.some((game) => game.home === "LAD" && game.away === "CIN"));
});

test("the slate marks a postseason game, and only a postseason game", () => {
  const fixture = rewindFixture(SEASON_2025, "2025-10-08T12:00:00Z");
  fixture.responses.schedule = { dates: [] };
  const { slate } = buildSnapshot(fixture, Date.parse("2025-10-08T14:00:00Z"));
  const isMarked = (game) => "postseason" in game && game.postseason === true;
  assert.ok(slate.previous.length && slate.previous.every(isMarked));
  assert.ok(buildSnapshot(EVENING).slate.today.games.every((game) => !("postseason" in game)));
});

test("2025: no club has a next game once the postseason is over", () => {
  const rows = Object.values(indexStandingsRows(buildSnapshot(SEASON_2025)));
  assert.ok(rows.every((row) => !row.next && !row.then));
});

test("September: seeds projected from the standings, placeholders ignored", () => {
  const snapshot = buildSnapshot(EVENING);
  assert.equal(snapshot.projected, true);
  assert.deepEqual(snapshot.teams.TB, { league: "AL", seed: 1, w: 96, l: 62 });
  assert.equal(snapshot.teams.TEX.seed, 3);
  assert.equal(snapshot.teams.CWS.seed, 6);
  assert.equal(Object.keys(snapshot.teams).length, 12);
  assert.deepEqual(snapshot.log, []);
  assert.deepEqual(snapshot.series.AL_WC1.next, {
    at: "2026-09-29T07:33:00Z",
    date: "2026-09-29",
    tbd: true,
    game: 1,
  });
});

test("September: the standings table the page draws", () => {
  const { divisions } = buildSnapshot(EVENING).standings;
  assert.deepEqual(Object.keys(divisions).sort(), [
    "AL Central",
    "AL East",
    "AL West",
    "NL Central",
    "NL East",
    "NL West",
  ]);
  const east = divisions["AL East"];
  assert.equal(east[0].id, "TB");
  assert.equal(east[0].clinched, true);
  assert.equal(east[0].wcrank, null);
  assert.equal(east[1].id, "NYY");
  assert.equal(east[1].clinched, false);
  assert.equal(east[1].clinch, "w");

  // MLB's magicNumber reads "-" once a leader clinches a playoff spot, so the
  // magic number comes from the closest chaser's elimination number instead.
  const central = divisions["AL Central"];
  assert.equal(central[0].id, "CLE");
  assert.equal(central[0].magic, "4");
  assert.equal(divisions["AL West"][0].magic, "4");
  assert.equal(east[0].magic, null);
  assert.ok(
    Object.values(divisions)
      .flat()
      .every((row) => row.lead || row.magic === null),
  );
  assert.equal(east[1].wcrank, "1");
  assert.deepEqual(Object.keys(east[1]).sort(), [
    "clinch",
    "clinched",
    "elim",
    "gb",
    "id",
    "l",
    "lead",
    "magic",
    "next",
    "pct",
    "then",
    "w",
    "wce",
    "wcgb",
    "wcrank",
  ]);
  // The in-progress Rays game isn't next. MLB leaves the start of a
  // doubleheader's second game open.
  assert.deepEqual(east[1].next, {
    at: "2026-09-25T20:05:00Z",
    date: "2026-09-25",
    opp: "BAL",
    home: true,
    tbd: false,
  });
  assert.deepEqual(east[1].then, {
    at: "2026-09-25T20:10:00Z",
    date: "2026-09-25",
    opp: "BAL",
    home: true,
    tbd: true,
  });
});

test("September: the day's games, in the shape the stamp reads, each with MLB's id for it", () => {
  const { slate } = buildSnapshot(EVENING);
  assert.equal(slate.today.date, "2026-09-24");
  assert.equal(slate.today.games.length, 12);
  const states = slate.today.games.map((game) => game.state);
  assert.deepEqual([...new Set(states)], ["final", "live", "pre"]);
  const [first] = slate.today.games;
  assert.deepEqual(first, {
    id: "823326",
    away: "STL",
    home: "PIT",
    state: "final",
    start: "2026-09-24T16:35:00Z",
    score: [1, 2],
    end: "2026-09-24T19:17:00Z",
  });
  const liveGame = slate.today.games.find((game) => game.state === "live");
  assert.ok(Number.isInteger(liveGame.inning) && liveGame.score.length === 2 && !liveGame.end);
  assert.deepEqual(
    slate.today.games.filter((game) => game.state === "live").map((game) => game.half),
    ["top", "bottom", "top", "bottom"],
  );
  assert.deepEqual(
    slate.today.games.filter((game) => game.state === "live").map((game) => game.outs),
    [1, 2, 0, 1],
  );
  assert.equal(slate.nextDay.date, "2026-09-25");
  assert.equal(slate.lastFinal.away, "HOU");
});

test("between halves, a live game says whether it's the middle or end of the inning, with no outs", () => {
  const responses = JSON.parse(JSON.stringify(EVENING.responses));
  const liveGames = responses.schedule.dates
    .flatMap((date) => date.games)
    .filter((game) => game.status.abstractGameState === "Live");
  liveGames[0].linescore = { ...liveGames[0].linescore, inningState: "Middle", outs: 3 };
  liveGames[1].linescore = { ...liveGames[1].linescore, inningState: "End", outs: 3 };
  const { slate } = buildSnapshot({ ...EVENING, responses });
  const live = slate.today.games.filter((game) => game.state === "live");
  assert.deepEqual(
    live.map(({ half, outs }) => ({ half, outs })),
    [
      { half: "middle", outs: undefined },
      { half: "end", outs: undefined },
      { half: "top", outs: 0 },
      { half: "bottom", outs: 1 },
    ],
  );
});

test("before 6am Eastern the day being played is still last night while a game is unfinished", () => {
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(buildSnapshot(EVENING, at1am).slate.today.date, "2026-09-24");
  const at7am = Date.parse("2026-09-25T11:00:00Z");
  const { slate } = buildSnapshot(EVENING, at7am);
  assert.equal(slate.today.date, "2026-09-25");
  assert.equal(slate.lastFinal.state, "final");
});

test("once last night's games are all final, today is the new day even before 6am", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const lastNight = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  for (const game of lastNight.games) {
    game.status = { abstractGameState: "Final", codedGameState: "F", detailedState: "Final" };
  }
  const at1am = Date.parse("2026-09-25T05:00:00Z");
  assert.equal(buildSnapshot(fixture, at1am).slate.today.date, "2026-09-25");
});

test("a rainout is neither a final nor on the slate", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  day.games[0].status = {
    abstractGameState: "Final",
    codedGameState: "D",
    detailedState: "Postponed",
  };
  const { slate } = buildSnapshot(fixture);
  assert.equal(slate.today.games.length, 11);
  assert.deepEqual(
    slate.today.postponed.map((game) => [game.state, game.detail]),
    [["off", "Postponed"]],
  );
});

test("a live game's starter still in is pitching, and one pulled isn't", () => {
  const responses = JSON.parse(JSON.stringify(EVENING.responses));
  const live = responses.schedule.dates
    .flatMap((date) => date.games)
    .find((game) => game.status.abstractGameState === "Live");
  live.teams.away.probablePitcher = { id: 501 };
  live.teams.home.probablePitcher = { id: 502 };
  live.linescore = {
    ...live.linescore,
    defense: { pitcher: { id: 502 }, team: { id: live.teams.home.team.id } },
    offense: { pitcher: { id: 777 }, team: { id: live.teams.away.team.id } },
  };
  const { slate } = buildSnapshot({ ...EVENING, responses });
  const game = slate.today.games.find((summary) => summary.start === live.gameDate);
  assert.deepEqual(game.starters, [{ id: 501 }, { id: 502, pitching: true }]);
});

test("a game in warmup hasn't started, though MLB calls it live", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  const warmingUp = day.games.find((game) => game.status.abstractGameState === "Live");
  warmingUp.status = {
    ...warmingUp.status,
    abstractGameState: "Live",
    codedGameState: "P",
    detailedState: "Warmup",
  };
  warmingUp.linescore = { currentInning: 1, inningState: "Top", inningHalf: "Top", outs: 0 };
  const { slate } = buildSnapshot(fixture);
  const game = slate.today.games.find((summary) => summary.start === warmingUp.gameDate);
  assert.equal(game.state, "pre");
  assert.equal(game.inning, undefined);
  assert.equal(game.outs, undefined);
});

test("a delay before or during a game carries its cause", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const day = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  );
  const [upcoming, underway] = [
    day.games.find((game) => game.status.abstractGameState === "Preview"),
    day.games.find((game) => game.status.abstractGameState === "Live"),
  ];
  upcoming.status = {
    ...upcoming.status,
    codedGameState: "P",
    detailedState: "Delayed Start",
    reason: "Rain",
  };
  underway.status = { ...underway.status, codedGameState: "I", detailedState: "Delayed" };
  const { slate } = buildSnapshot(fixture);
  const delays = slate.today.games
    .filter((game) => game.delay)
    .map((game) => [game.state, game.delay]);
  assert.deepEqual(delays.sort(), [
    ["live", "Delayed"],
    ["pre", "Delayed: Rain"],
  ]);
});

const listClubsIn = (games) => games.flatMap((game) => [game.away, game.home]).filter(Boolean);
const describeGame = (game) =>
  `${game.date} ${game.away}@${game.home}` + (game.doubleheader ? ` G${game.doubleheader}` : "");

test("previous and next: every game on the dates of each club's last and first game", () => {
  const { slate } = buildSnapshot(EVENING);
  for (const games of [slate.previous, slate.next]) {
    assert.equal(new Set(listClubsIn(games)).size, 30);
    assert.equal(new Set(games.map(describeGame)).size, games.length);
  }
  assert.ok(slate.previous.every((game) => game.date < "2026-09-24" && game.state === "final"));
  assert.ok(slate.next.every((game) => game.date > "2026-09-24" && game.state === "pre"));
});

test("a date in previous or next lists all its games, not only each club's last or first", () => {
  const { slate } = buildSnapshot(EVENING);
  const previous = slate.previous.map(describeGame);
  assert.ok(previous.includes("2026-09-23 TOR@BAL G1"));
  assert.ok(previous.includes("2026-09-23 TOR@BAL G2"));
  const next = slate.next.map(describeGame);
  for (const doubleheader of ["CHC@BOS", "BAL@NYY"]) {
    assert.ok(next.includes(`2026-09-25 ${doubleheader} G1`));
    assert.ok(next.includes(`2026-09-25 ${doubleheader} G2`));
  }
});

test("a postseason game counts as next before its opponent is known", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const [firstGame] = fixture.responses.postseason.dates
    .flatMap((day) => day.games)
    .filter((game) => game.gameType === "D");
  firstGame.teams.home.team = { id: 139, name: "Tampa Bay Rays" };
  const now = Date.parse("2026-09-30T16:00:00Z");
  const { slate } = buildSnapshot(fixture, now);
  const next = slate.next.find((game) => game.home === "TB");
  assert.equal(next.away, null);
  assert.equal(next.date, firstGame.officialDate);
  assert.ok(slate.previous.some((game) => listClubsIn([game]).includes("TB")));
});

test("when to ask again: closely during games, otherwise sleep until the next", () => {
  const computePollDelay = (games, now = "2026-09-24T22:00:00Z") =>
    MLBSnapshot.choosePollDelay({ slate: { today: { games }, nextDay: null } }, Date.parse(now));
  const MINUTE_MS = 60 * 1000;
  assert.equal(
    computePollDelay([{ state: "live" }, { state: "pre", start: "2026-09-25T02:10:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T22:10:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  // Past its start and still "pre" means a delay.
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T21:05:00Z" }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  // 6:00 PM ET now, 6:40 first pitch: wake fifteen minutes early, at 6:25.
  assert.equal(
    computePollDelay([{ state: "final" }, { state: "pre", start: "2026-09-24T22:40:00Z" }]),
    25 * MINUTE_MS,
  );
  assert.equal(
    computePollDelay([{ state: "final" }, { state: "pre", start: "2026-09-25T17:05:00Z" }]),
    GAME_DAY_CHECK_MS,
  );
  assert.equal(computePollDelay([]), OFF_DAY_CHECK_MS);
  assert.equal(
    computePollDelay([{ state: "pre", start: "2026-09-24T22:05:00Z", tbd: true }]),
    OFF_DAY_CHECK_MS,
  );
  assert.equal(MLBSnapshot.choosePollDelay({ slate: null }), null);
});

test("from the 9th inning on, a live game is followed faster", () => {
  const computePollDelay = (games) =>
    MLBSnapshot.choosePollDelay(
      { slate: { today: { games }, nextDay: null } },
      Date.parse("2026-09-24T22:00:00Z"),
    );
  const live = (inning, half) => ({ state: "live", inning, half });
  assert.equal(computePollDelay([live(8, "bottom")]), MLBSnapshot.POLL_LIVE_MS);
  assert.equal(computePollDelay([live(8, "end")]), MLBSnapshot.POLL_LIVE_MS);
  assert.equal(computePollDelay([live(9, "top")]), MLBSnapshot.POLL_CLOSING_MS);
  assert.equal(computePollDelay([live(9, "bottom")]), MLBSnapshot.POLL_CLOSING_MS);
  assert.equal(computePollDelay([live(12, "top")]), MLBSnapshot.POLL_CLOSING_MS);
  assert.equal(computePollDelay([live(3, "top"), live(10, "bottom")]), MLBSnapshot.POLL_CLOSING_MS);
  assert.equal(
    computePollDelay([live(3, "top"), { state: "final", inning: 9 }]),
    MLBSnapshot.POLL_LIVE_MS,
  );
  assert.ok(MLBSnapshot.POLL_CLOSING_MS < MLBSnapshot.POLL_LIVE_MS);
});

test("a game with no start time doesn't make the next ask come at once", () => {
  const games = [{ state: "pre" }, { state: "pre", start: "2026-09-25T17:05:00Z" }];
  assert.equal(
    MLBSnapshot.choosePollDelay(
      { slate: { today: { games }, nextDay: null } },
      Date.parse("2026-09-24T22:00:00Z"),
    ),
    GAME_DAY_CHECK_MS,
  );
});

test("a rainout keeps a day either side a game day, past midnight too, while its make-up is set", () => {
  const fixture = JSON.parse(JSON.stringify(EVENING));
  const rainedOut = fixture.responses.schedule.dates.find(
    (scheduleDate) => scheduleDate.date === "2026-09-24",
  ).games[0];
  rainedOut.status = {
    abstractGameState: "Final",
    codedGameState: "D",
    detailedState: "Postponed",
  };
  const { putOffStarts } = buildSnapshot(fixture);
  assert.deepEqual(putOffStarts, [rainedOut.gameDate]);
  const afterMidnight = Date.parse("2026-09-25T06:35:00Z");
  const computePollDelay = (starts) =>
    MLBSnapshot.choosePollDelay(
      { slate: { today: { games: [] }, nextDay: null }, putOffStarts: starts },
      afterMidnight,
    );
  assert.equal(computePollDelay(putOffStarts), GAME_DAY_CHECK_MS);
  assert.equal(computePollDelay([]), OFF_DAY_CHECK_MS);
});

test("an off day with the page open: one look every few hours, not a poll", () => {
  const snapshot = MLBSnapshot.buildSnapshot(EVENING.responses, {
    season: 2026,
    now: Date.parse("2026-09-25T11:00:00Z"),
  });
  assert.equal(
    MLBSnapshot.choosePollDelay(snapshot, Date.parse("2026-09-25T11:00:00Z")),
    GAME_DAY_CHECK_MS,
  );
});

test("what to fetch: a past season skips the schedule", () => {
  const now = Date.parse("2026-09-24T22:00:00Z");
  assert.equal(MLBSnapshot.listMlbRequests(2025, now).schedule, null);
  assert.match(
    MLBSnapshot.listMlbRequests(2026, now, "2026-09-27").schedule,
    /startDate=2026-09-20&endDate=2026-09-28/,
  );
});

test("what to fetch: the postseason and the season's whole schedule ask for each game's inning, so a final says in which it ended", () => {
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse("2026-10-10T16:00:00Z"));
  for (const request of [requests.postseason, requests.seasonGames]) {
    const params = new URL(request, MLBSnapshot.MLB_API).searchParams;
    assert.ok(params.get("hydrate")?.split(",").includes("linescore"), request);
    assert.ok(params.get("fields")?.split(",").includes("currentInning"), request);
  }
});

test("what to fetch: in October the schedule reaches back to the regular season's last days", () => {
  const now = Date.parse("2026-10-20T16:00:00Z");
  assert.match(
    MLBSnapshot.listMlbRequests(2026, now, "2026-09-27").schedule,
    /startDate=2026-09-24&endDate=2026-10-24/,
  );
});

test("fetchSnapshot asks for exactly the requests it builds", async () => {
  const fixture = EVENING;
  const asked = [];
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
  );
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      asked.push(path);
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  const liveIds = listFixtureLiveGameIds(fixture);
  assert.ok(liveIds.length > 0);
  assert.equal(asked.length, 5 + liveIds.length);
  assert.equal(asked[0], requests.season);
  assert.ok(asked.includes(requests.seasonGames));
  for (const id of liveIds) assert.ok(asked.includes(MLBSnapshot.nameLiveGameRequest(id)));
  assert.deepEqual(snapshot, buildSnapshot(fixture));
});

/** @param {any} fixture */
const listFixtureLiveGameIds = (fixture) =>
  fixture.responses.schedule.dates
    .flatMap((/** @type {any} */ day) => day.games)
    .filter((/** @type {any} */ game) => MLBSnapshot.readGameState(game.status) === "live")
    .map((/** @type {any} */ game) => String(game.gamePk));

test("a game being played takes its inning, outs, and score from MLB's live feed, which runs ahead of the schedule's copy, and keeps the copy when the feed didn't answer", () => {
  const fixture = EVENING;
  const [ahead, behind] = listFixtureLiveGameIds(fixture);
  const fromSchedule = buildSnapshot(fixture).slate.today.games;
  const liveFeed = {
    gameData: { status: { abstractGameState: "Live", codedGameState: "I" } },
    liveData: {
      linescore: {
        currentInning: 12,
        inningState: "Bottom",
        outs: 2,
        teams: { away: { runs: 9 }, home: { runs: 8 } },
      },
    },
  };
  const games = buildSnapshot({
    ...fixture,
    responses: { ...fixture.responses, liveGames: { [ahead]: liveFeed } },
  }).slate.today.games;
  const findGame = (/** @type {any[]} */ list, /** @type {string} */ id) =>
    list.find((game) => game.id === id);

  assert.deepEqual(
    [findGame(games, ahead).inning, findGame(games, ahead).half, findGame(games, ahead).outs],
    [12, "bottom", 2],
  );
  assert.deepEqual(findGame(games, ahead).score, [9, 8]);
  assert.notDeepEqual(findGame(fromSchedule, ahead).score, [9, 8]);
  assert.deepEqual(findGame(games, behind), findGame(fromSchedule, behind));
});

test("a game whose live feed says it ended is final, before the schedule says so", () => {
  const fixture = EVENING;
  const [id] = listFixtureLiveGameIds(fixture);
  const liveFeed = {
    gameData: { status: { abstractGameState: "Final", codedGameState: "F" } },
    liveData: { linescore: { currentInning: 9, inningState: "Bottom", outs: 3 } },
  };
  const games = buildSnapshot({
    ...fixture,
    responses: { ...fixture.responses, liveGames: { [id]: liveFeed } },
  }).slate.today.games;

  assert.equal(games.find((game) => game.id === id).state, "final");
});

// Starters as MLB names them on the schedule, keyed by game, and its answer about them.
function addStarters(fixture, probables, people) {
  const copy = structuredClone(fixture);
  for (const game of copy.responses.schedule.dates.flatMap((date) => date.games)) {
    const [away, home] = probables[game.gamePk] || [];
    if (away) game.teams.away.probablePitcher = { id: away };
    if (home) game.teams.home.probablePitcher = { id: home };
  }
  copy.responses.pitchers = { people };
  return copy;
}
const describePerson = (id, [useName, useLastName], hand) => ({
  id,
  ...(useName && { useName }),
  useLastName,
  pitchHand: { code: hand },
});
const findSlateGame = (snapshot, away, home) =>
  [
    ...snapshot.slate.today.games,
    ...(snapshot.slate.nextDay?.games || []),
    ...snapshot.slate.previous,
    ...snapshot.slate.next,
  ].find((game) => game.away === away && game.home === home);

const EVENING_STARTERS = {
  824223: [7, null], // WSH at DET, yesterday
  823326: [1, 2], // STL at PIT, final
  824707: [3, 4], // CLE at BOS, live
  823895: [5, null], // SD at LAD, not started
  824703: [6, null], // CHC at BOS, tomorrow
};
const EVENING_PEOPLE = [
  describePerson(1, ["Matthew", "Liberatore"], "L"),
  describePerson(2, ["Mitch", "Keller"], "R"),
  describePerson(3, ["Tanner", "Bibee"], "R"),
  describePerson(4, ["Garrett", "Crochet"], "L"),
  describePerson(5, [null, "King"], "R"),
];

test("starters: every game listed names each club's starter, with his first name when MLB gives one, and his arm", () => {
  const snapshot = buildSnapshot(addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE));
  assert.deepEqual(findSlateGame(snapshot, "STL", "PIT").starters, [
    { id: 1, name: "Liberatore", firstName: "Matthew", hand: "L" },
    { id: 2, name: "Keller", firstName: "Mitch", hand: "R" },
  ]);
  assert.deepEqual(findSlateGame(snapshot, "CLE", "BOS").starters, [
    { id: 3, name: "Bibee", firstName: "Tanner", hand: "R" },
    { id: 4, name: "Crochet", firstName: "Garrett", hand: "L" },
  ]);
  assert.deepEqual(findSlateGame(snapshot, "SD", "LAD").starters, [
    { id: 5, name: "King", hand: "R" },
    null,
  ]);
  assert.deepEqual(snapshot.missing, []);
});

test("starters: one MLB couldn't describe keeps his id", () => {
  const snapshot = buildSnapshot(addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE));
  assert.deepEqual(findSlateGame(snapshot, "CHC", "BOS").starters, [{ id: 6 }, null]);
  assert.deepEqual(findSlateGame(snapshot, "WSH", "DET").starters, [{ id: 7 }, null]);
});

test("fetchSnapshot looks up the listed games' starters in one sorted request", async () => {
  const fixture = addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE);
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
  const pitcherRequest = MLBSnapshot.listPitcherRequest([7, 1, 2, 3, 4, 5, 6]);
  const byPath = {
    ...Object.fromEntries(
      Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
    ),
    [pitcherRequest]: fixture.responses.pitchers,
  };
  const asked = [];
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      asked.push(path);
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  assert.equal(asked.at(-1), pitcherRequest);
  assert.match(pitcherRequest, /personIds=1,2,3,4,5,6,7&/);
  assert.deepEqual(snapshot, buildSnapshot(fixture));
});

test("fetchSnapshot looks up the starters of every game the slate lists, the postseason's too", async () => {
  const fixture = DIVISION_SERIES;
  const now = Date.parse(fixture.now);
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, now, regularSeasonEnd);
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
  );
  let pitcherRequest = "";
  await MLBSnapshot.fetchSnapshot(
    async (path, name) => {
      if (name !== "pitchers") return byPath[path];
      pitcherRequest = path;
      return fixture.responses.pitchers;
    },
    2026,
    now,
  );
  const listed = MLBSnapshot.listStarterIds(buildSnapshot(fixture).slate);
  assert.equal(pitcherRequest, MLBSnapshot.listPitcherRequest(listed));
});

test("fetchSnapshot still builds the games when MLB can't name their starters", async () => {
  const fixture = addStarters(EVENING, EVENING_STARTERS, EVENING_PEOPLE);
  const regularSeasonEnd = fixture.responses.season.seasons[0].regularSeasonEndDate;
  const requests = MLBSnapshot.listMlbRequests(2026, Date.parse(fixture.now), regularSeasonEnd);
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [path, fixture.responses[key]]),
  );
  const snapshot = await MLBSnapshot.fetchSnapshot(
    async (path) => {
      if (!byPath[path]) throw new Error("MLB Stats API answered 503");
      return byPath[path];
    },
    2026,
    Date.parse(fixture.now),
  );
  assert.deepEqual(findSlateGame(snapshot, "CLE", "BOS").starters, [{ id: 3 }, { id: 4 }]);
  assert.deepEqual(findSlateGame(snapshot, "STL", "PIT").starters, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(snapshot.missing, []);
});

// MLB's answers to the evening's requests, with the named ones failing.
function answerEveningExcept(...failing) {
  const regularSeasonEnd = EVENING.responses.season.seasons[0].regularSeasonEndDate;
  const now = Date.parse(EVENING.now);
  const requests = {
    ...MLBSnapshot.listMlbRequests(2026, now, regularSeasonEnd),
    // Without the season's dates, the schedule reaches back only its usual days.
    fallbackSchedule: MLBSnapshot.listMlbRequests(2026, now).schedule,
  };
  const byPath = Object.fromEntries(
    Object.entries(requests).map(([key, path]) => [
      path,
      EVENING.responses[key === "fallbackSchedule" ? "schedule" : key],
    ]),
  );
  return async (path) => {
    const key = Object.keys(requests).find((name) => requests[name] === path);
    if (failing.includes(key)) throw new Error("MLB Stats API answered 503");
    return byPath[path];
  };
}

test("fetchSnapshot still builds the games when the standings or the season's dates don't answer", async () => {
  const full = buildSnapshot(EVENING);
  for (const failing of ["standings", "season"]) {
    const snapshot = await MLBSnapshot.fetchSnapshot(
      answerEveningExcept(failing),
      2026,
      Date.parse(EVENING.now),
    );
    assert.deepEqual(snapshot.slate.today, full.slate.today, failing);
    assert.ok(snapshot.missing.length > 0, failing);
  }
});

test("fetchSnapshot fails when the postseason or the schedule doesn't answer", async () => {
  for (const failing of ["postseason", "schedule"]) {
    await assert.rejects(
      MLBSnapshot.fetchSnapshot(answerEveningExcept(failing), 2026, Date.parse(EVENING.now)),
      /503/,
    );
  }
});

test("a snapshot is small enough to poll", () => {
  assert.ok(JSON.stringify(buildSnapshot(EVENING)).length < 20000);
});

test("a set bracket still builds when a club is missing from the standings", () => {
  const full = buildSnapshot(SEASON_2025);
  const responses = JSON.parse(JSON.stringify(SEASON_2025.responses));
  for (const division of responses.standings.records)
    division.teamRecords = division.teamRecords.filter((record) => record.team.id !== 113);
  const snapshot = MLBSnapshot.buildSnapshot(responses, {
    season: 2025,
    now: Date.parse(SEASON_2025.now),
  });
  assert.equal(snapshot.projected, false);
  assert.deepEqual(snapshot.teams.CIN, { league: "NL", seed: full.teams.CIN.seed });
  assert.deepEqual(snapshot.series, full.series);
});

test("standings missing a division are no standings, and project no field", () => {
  for (const [keep, missing] of [
    [() => false, false],
    [(record) => record.division.id !== 200, true],
  ]) {
    const fixture = JSON.parse(JSON.stringify(EVENING));
    fixture.responses.standings.records = fixture.responses.standings.records.filter(keep);
    const snapshot = buildSnapshot(fixture);
    assert.equal(snapshot.standings, null);
    assert.equal(snapshot.projected, true);
    assert.equal(MLBSnapshot.hasKnownField(snapshot), false);
    assert.equal(snapshot.missing.includes("records"), missing);
  }
  assert.equal(MLBSnapshot.hasKnownField(buildSnapshot(EVENING)), true);
});

test("a set field read without the standings isn't known, since its records come from them", () => {
  const snapshot = buildSnapshot(SEASON_2025);
  assert.equal(MLBSnapshot.hasKnownField(snapshot), true);
  assert.equal(MLBSnapshot.hasKnownField({ ...snapshot, standings: null }), false);
});

test("the bracket walk seats seeds and advances winners, 1 against the 4/5 winner", () => {
  const teams = {};
  for (const league of ["AL", "NL"])
    for (let seed = 1; seed <= 6; seed++) teams[`${league}${seed}`] = { league, seed };
  const bracket = MLBSnapshot.resolveBracket(teams, (_, __, teamA) => teamA);
  assert.deepEqual([bracket.AL_WC2.teamA, bracket.AL_WC2.teamB], ["AL4", "AL5"]);
  assert.deepEqual([bracket.AL_DS1.teamA, bracket.AL_DS1.teamB], ["AL1", "AL4"]);
  assert.deepEqual([bracket.AL_DS2.teamA, bracket.AL_DS2.teamB], ["AL2", "AL3"]);
  assert.deepEqual([bracket.WS.teamA, bracket.WS.teamB], ["AL1", "NL1"]);
  assert.equal(MLBSnapshot.findFeederSeries("NL_DS1", 1), "NL_WC2");
  assert.equal(MLBSnapshot.findFeederSeries("NL_DS1", 0), null);
  assert.equal(MLBSnapshot.findFeederSeries("WS", 1), "NL_CS");
});

test("a snapshot carries the day spring training starts", () => {
  assert.equal(buildSnapshot(EVENING).springStart, "2026-02-20");
  assert.equal(buildSnapshot(SEASON_2025).springStart, "2025-02-20");
});

test("a division tied at the top still has a magic number: a tie at the end doesn't clinch", () => {
  const tied = JSON.parse(JSON.stringify(EVENING));
  const alWest = tied.responses.standings.records.find((record) => record.division.id === 200);
  const astros = alWest.teamRecords.find((record) => record.team.id === 117);
  Object.assign(astros, { wins: 79, losses: 80, eliminationNumber: "-", divisionGamesBack: "-" });
  const [leader, chaser] = buildSnapshot(tied).standings.divisions["AL West"];
  assert.deepEqual([leader.id, chaser.id, chaser.elim], ["TEX", "HOU", "-"]);
  assert.equal(leader.magic, "4");
  assert.equal(buildSnapshot(EVENING).standings.divisions["AL West"][0].magic, "4");
});

test("a division is won only once every other club in it is out of the race, whatever MLB flags", () => {
  const flagged = JSON.parse(JSON.stringify(EVENING));
  const alEast = flagged.responses.standings.records.find((record) => record.division.id === 201);
  const yankees = alEast.teamRecords.find((record) => record.team.id === 147);
  Object.assign(yankees, { divisionChamp: true, clinchIndicator: "y" });
  const [leader, wildCard] = buildSnapshot(flagged).standings.divisions["AL East"];
  assert.deepEqual([leader.id, leader.clinched], ["TB", true]);
  assert.deepEqual([wildCard.id, wildCard.clinched], ["NYY", false]);
  assert.equal(buildSnapshot(EVENING).standings.divisions["AL Central"][0].clinched, false);
});

// The fixture's regular season games had all ended, so one is put back before its first pitch.
function reopenGame(fixture, date, homeId) {
  const copy = JSON.parse(JSON.stringify(fixture));
  const game = copy.responses.schedule.dates
    .find((day) => day.date === date)
    .games.find((each) => each.teams.home.team.id === homeId);
  game.status = { ...game.status, abstractGameState: "Preview", codedGameState: "S" };
  game.status.detailedState = "Scheduled";
  return copy;
}

test("a playoff game still to come says where it's on, each channel and its streaming apart", () => {
  const snapshot = buildSnapshot(BROADCASTS);
  assert.deepEqual(findSlateGame(snapshot, "CLE", "CWS").networks, ["TBS", "HBO MAX", "TruTV"]);
  assert.deepEqual(findSlateGame(snapshot, "MIL", "SD").networks, ["FS1", "FOX ONE"]);
});

test("a game that has ended says nothing of where it was on", () => {
  const { slate } = buildSnapshot(BROADCASTS);
  const finals = [...slate.previous, slate.lastFinal].filter((game) => game.state === "final");
  assert.ok(finals.length);
  assert.ok(finals.every((game) => !("networks" in game)));
});

test("a national channel comes before each club's own, the visitors' first, without sponsors", () => {
  const dodgers = buildSnapshot(
    reopenGame(BROADCASTS, "2026-09-24", 119),
    Date.parse("2026-09-24T20:00:00Z"),
  );
  assert.deepEqual(findSlateGame(dodgers, "SD", "LAD").networks, [
    "MLB Network",
    "Padres.TV",
    "SportsNet LA",
  ]);
  const twins = buildSnapshot(
    reopenGame(BROADCASTS, "2026-09-25", 142),
    Date.parse("2026-09-25T20:00:00Z"),
  );
  assert.deepEqual(findSlateGame(twins, "TEX", "MIN").networks, [
    "Rangers Sports Network",
    "CW33",
    "Twins.TV",
  ]);
});

test("radio and Spanish broadcasts are left out of where to watch", () => {
  const { slate } = buildSnapshot(BROADCASTS);
  const networks = slate.today.games.flatMap((game) => game.networks ?? []);
  assert.ok(networks.length);
  assert.ok(networks.every((name) => !/radio|univision|deportes|\bAM\b|\bFM\b/i.test(name)));
});

test("the schedule asks MLB where each game is on, in the same request as its games", () => {
  const { schedule } = MLBSnapshot.listMlbRequests(2026, Date.parse(BROADCASTS.now));
  const hydrate = new URL(schedule, MLBSnapshot.MLB_API).searchParams.get("hydrate");
  assert.ok(hydrate.split(",").includes("broadcasts"));
});

test("a channel's app, or its owner's name for it, shows as the channel, once", () => {
  const fixture = JSON.parse(JSON.stringify(BROADCASTS));
  const game = fixture.responses.schedule.dates
    .find((day) => day.date === "2026-10-07")
    .games.find((each) => each.teams.home.team.id === 135);
  const [first, second] = game.broadcasts.filter((broadcast) => broadcast.type === "TV");
  first.name = "ESPN/ESPN App";
  second.name = "Amazon Prime Video";
  const snapshot = buildSnapshot(fixture);
  assert.deepEqual(findSlateGame(snapshot, "MIL", "SD").networks, ["ESPN", "Prime Video"]);
});

/**
 * The evening's schedule with the All-Star Game on its night, under way.
 * @param {any} fixture
 */
function addAllStarGame(fixture) {
  const copy = structuredClone(fixture);
  const day = copy.responses.schedule.dates.find((each) => each.date === "2026-09-24");
  const [template] = day.games;
  day.games.push({
    ...template,
    gamePk: 823443,
    gameType: "A",
    gameDate: "2026-09-25T00:00:00Z",
    status: { abstractGameState: "Live", codedGameState: "I", detailedState: "In Progress" },
    teams: {
      away: { team: { id: 159, name: "American League All-Stars" }, score: 2 },
      home: { team: { id: 160, name: "National League All-Stars" }, score: 1 },
    },
    linescore: { currentInning: 5, inningState: "Top", outs: 1, teams: { home: {}, away: {} } },
    seriesDescription: "MLB All-Star Game",
  });
  return copy;
}

test("the All-Star Game sits beside the slate's lists, its leagues for its clubs, without starters", () => {
  const { slate } = buildSnapshot(addAllStarGame(EVENING));
  assert.deepEqual(
    {
      id: slate.allStar.id,
      date: slate.allStar.date,
      clubs: [slate.allStar.away, slate.allStar.home],
      state: slate.allStar.state,
      score: slate.allStar.score,
      allStar: slate.allStar.allStar,
    },
    {
      id: "823443",
      date: "2026-09-24",
      clubs: ["AL", "NL"],
      state: "live",
      score: [2, 1],
      allStar: true,
    },
  );
  assert.equal(slate.allStar.starters, undefined);
  const listed = [slate.today, slate.nextDay, slate.lastNight]
    .filter(Boolean)
    .flatMap((day) => day.games)
    .concat(slate.previous, slate.next, slate.lastFinal ?? []);
  assert.ok(!listed.some((game) => game.id === "823443"));
});

test("a live All-Star Game is followed as closely as any live game", () => {
  const slate = { today: { date: "2026-07-14", games: [] }, nextDay: null };
  const now = Date.parse("2026-07-15T01:00:00Z");
  const allStar = {
    id: "823443",
    away: "AL",
    home: "NL",
    state: "live",
    start: "2026-07-15T00:00:00Z",
  };
  assert.equal(
    MLBSnapshot.choosePollDelay({ slate: { ...slate, allStar } }, now),
    MLBSnapshot.POLL_LIVE_MS,
  );
  assert.notEqual(MLBSnapshot.choosePollDelay({ slate }, now), MLBSnapshot.POLL_LIVE_MS);
});

const SEASON_GAMES = readFixture("2026-10-09-season");
const listScheduled = (snapshot) => Object.values(snapshot.schedule).flat();
/** @param {any} schedule MLB's schedule */
const findListing = (schedule, gamePk) =>
  schedule.dates.flatMap((day) => day.games).find((game) => game.gamePk === gamePk);

test("a read without the standings once the playoffs list a club leaves out what their series decide, and keeps the rest", () => {
  const whole = buildSnapshot(SEASON_GAMES);
  const partial = buildSnapshot({
    ...SEASON_GAMES,
    responses: { ...SEASON_GAMES.responses, standings: null },
  });
  assert.deepEqual([whole.isSeriesKnown, partial.isSeriesKnown], [true, false]);
  assert.ok("next" in whole.slate && "previous" in whole.slate);
  assert.ok(!("next" in partial.slate) && !("previous" in partial.slate));
  assert.deepEqual(partial.slate.today, whole.slate.today);
  assert.deepEqual(Object.keys(partial.schedule), [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ]);
  assert.deepEqual(partial.schedule["2026-08"], whole.schedule["2026-08"]);
  assert.deepEqual(
    partial.schedule["2026-09"],
    whole.schedule["2026-09"].filter((game) => !game.postseason),
  );
});

test("a read without the standings before the playoffs list a club leaves the slate whole", () => {
  const partial = buildSnapshot({
    ...EVENING,
    responses: { ...EVENING.responses, standings: null, postseason: { dates: [] } },
  });
  assert.equal(partial.isSeriesKnown, true);
  assert.ok("next" in partial.slate);
});

test("each club's last games list two doubleheaders on one day each in game order, among the day's games by start", () => {
  /** @param {number} gamePk @param {number} away @param {number} home @param {string} start @param {number} [gameNumber] */
  const listFinal = (gamePk, away, home, start, gameNumber) => ({
    gamePk,
    gameType: "R",
    gameDate: start,
    officialDate: "2026-09-26",
    status: {
      abstractGameState: "Final",
      codedGameState: "F",
      detailedState: "Final",
      startTimeTBD: false,
    },
    teams: { away: { team: { id: away }, score: 1 }, home: { team: { id: home }, score: 2 } },
    doubleHeader: gameNumber ? "S" : "N",
    gameNumber: gameNumber ?? 1,
  });
  const schedule = {
    dates: [
      {
        date: "2026-09-26",
        games: [
          listFinal(1, 110, 147, "2026-09-26T17:05:00Z", 1),
          listFinal(2, 110, 147, "2026-09-26T22:05:00Z", 2),
          listFinal(3, 139, 111, "2026-09-26T20:05:00Z", 1),
          listFinal(4, 139, 111, "2026-09-27T01:05:00Z", 2),
          listFinal(5, 141, 116, "2026-09-26T18:10:00Z"),
        ],
      },
    ],
  };
  const snapshot = MLBSnapshot.buildSnapshot(
    { schedule, postseason: { dates: [] } },
    { season: 2026, now: Date.parse("2026-09-28T16:00:00Z") },
  );
  assert.deepEqual(
    snapshot.slate.previous.map((game) => `${game.away}@${game.home}${game.doubleheader ?? ""}`),
    ["BAL@NYY1", "BAL@NYY2", "TOR@DET", "TB@BOS1", "TB@BOS2"],
  );
});

test("today's games list a doubleheader in game order even when MLB lists its second game with the earlier start", () => {
  /** @param {number} gamePk @param {number} away @param {number} home @param {string} start @param {number} [gameNumber] */
  const listGame = (gamePk, away, home, start, gameNumber) => ({
    gamePk,
    gameType: "R",
    gameDate: start,
    officialDate: "2026-09-26",
    status: {
      abstractGameState: "Preview",
      codedGameState: "S",
      detailedState: "Scheduled",
      startTimeTBD: false,
    },
    teams: { away: { team: { id: away } }, home: { team: { id: home } } },
    doubleHeader: gameNumber ? "S" : "N",
    gameNumber: gameNumber ?? 1,
  });
  const schedule = {
    dates: [
      {
        date: "2026-09-26",
        games: [
          listGame(1, 110, 147, "2026-09-26T17:05:00Z", 2),
          listGame(2, 141, 116, "2026-09-26T18:10:00Z"),
          listGame(3, 110, 147, "2026-09-26T22:05:00Z", 1),
        ],
      },
    ],
  };
  const snapshot = MLBSnapshot.buildSnapshot(
    { schedule, postseason: { dates: [] } },
    { season: 2026, now: Date.parse("2026-09-26T12:00:00Z") },
  );
  assert.deepEqual(
    snapshot.slate.today.games.map((game) => `${game.away}@${game.home}${game.doubleheader ?? ""}`),
    ["BAL@NYY1", "BAL@NYY2", "TOR@DET"],
  );
});

test("each club's standings row counts its season's games, one fewer for a rainout MLB cancelled", () => {
  const rows = Object.values(buildSnapshot(SEASON_GAMES).standings.divisions).flat();
  const shortened = rows.filter((row) => row.scheduled !== 162);
  assert.deepEqual(
    shortened.map((row) => [row.id, row.scheduled, row.w + row.l]),
    [
      ["NYY", 161, 161],
      ["BAL", 161, 161],
    ],
  );
  assert.equal(rows.length, 30);
  assert.equal(MLBSnapshot.countSeasonGames(shortened[0]), 161);
  assert.equal(MLBSnapshot.countSeasonGames({}), 162);
});

test("a leader tied with a club a game short for a rainout never made up counts its magic number from that club's games", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const east = fixture.responses.standings.records.find((record) => record.division.id === 201);
  const set = (id, fields) =>
    Object.assign(
      east.teamRecords.find((record) => record.team.id === id),
      fields,
    );
  set(139, { wins: 90, losses: 68, divisionChamp: false, clinchIndicator: undefined });
  set(147, { wins: 90, losses: 68, eliminationNumber: "-" });
  const rows = buildSnapshot(fixture).standings.divisions["AL East"];
  const [leader, yankees] = rows;
  assert.deepEqual(
    [leader.id, leader.clinched, yankees.id, yankees.scheduled],
    ["TB", false, "NYY", 161],
  );
  assert.equal(leader.magic, "4");
});

test("a division leader whose chaser MLB never eliminates wins it once both have played out their own seasons, one a game short for a rainout never made up", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const east = fixture.responses.standings.records.find((record) => record.division.id === 201);
  const set = (id, fields) =>
    Object.assign(
      east.teamRecords.find((record) => record.team.id === id),
      fields,
    );
  set(147, { divisionLeader: true, divisionRank: "1", divisionChamp: false, clinchIndicator: "x" });
  set(139, {
    wins: 93,
    losses: 69,
    divisionLeader: false,
    divisionRank: "2",
    divisionChamp: false,
    clinchIndicator: "x",
    eliminationNumber: "-",
    wildCardRank: "1",
  });
  const [yankees, rays] = buildSnapshot(fixture).standings.divisions["AL East"];
  assert.deepEqual(
    [yankees.id, yankees.w + yankees.l, yankees.scheduled, rays.id, rays.elim],
    ["NYY", 161, 161, "TB", "-"],
  );
  assert.equal(yankees.clinched, true);
});

test("the season's whole schedule lists every game by month, from Opening Day to the World Series", () => {
  const snapshot = buildSnapshot(SEASON_GAMES);
  assert.deepEqual(Object.keys(snapshot.schedule), [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
  ]);
  const games = listScheduled(snapshot);
  assert.equal(games.filter((game) => !game.postseason && !game.allStar).length, 2459);
  assert.deepEqual(games[0], {
    date: "2026-03-25",
    id: "823244",
    away: "NYY",
    home: "SF",
    state: "final",
    start: "2026-03-26T00:05:00Z",
    score: [7, 0],
    records: ["1-0", "0-1"],
    starters: [
      { id: 608331, name: "Fried", hand: "L", firstName: "Max" },
      { id: 657277, name: "Webb", hand: "R" },
    ],
  });
  assert.deepEqual(
    games.filter((game) => game.allStar),
    [
      {
        date: "2026-07-14",
        id: "823443",
        away: "AL",
        home: "NL",
        state: "final",
        start: "2026-07-15T00:00:00Z",
        score: [4, 0],
        allStar: true,
      },
    ],
  );
  const worldSeries = games.filter((game) => game.date >= "2026-10-23");
  assert.equal(worldSeries.length, 7);
  assert.ok(worldSeries.every((game) => game.postseason && game.away === null));
  assert.equal(new Set(games.map((game) => `${game.id} ${game.date}`)).size, games.length);
});

test("a postponed game is listed on the day it was to be played and on the day it's made up", () => {
  const games = listScheduled(buildSnapshot(SEASON_GAMES));
  assert.deepEqual(
    games.filter((game) => game.id === "823042"),
    [
      {
        date: "2026-06-25",
        id: "823042",
        away: "ARI",
        home: "STL",
        state: "off",
        start: "2026-06-25T23:45:00Z",
        detail: "Postponed",
      },
      {
        date: "2026-07-23",
        id: "823042",
        away: "ARI",
        home: "STL",
        state: "final",
        start: "2026-07-23T21:15:00Z",
        score: [10, 6],
        records: ["54-49", "52-50"],
        starters: [
          { id: 694297, name: "Pfaadt", hand: "R", firstName: "Brandon" },
          { id: 700241, name: "McGreevy", hand: "R", firstName: "Michael" },
        ],
      },
    ],
  );
});

/**
 * MLB's listing of a ballpark.
 * @param {number} id
 * @param {string} name
 * @param {string} city
 * @param {string} [state]
 */
const makeVenue = (id, name, city, state) => ({
  id,
  name,
  location: { city, ...(state && { stateAbbrev: state }) },
  timeZone: { id: "America/New_York", tz: "EDT" },
});

test("each listed game says where it's played, and a game away from its home club's own ballpark is at a neutral site", () => {
  const fixture = structuredClone(SEASON_GAMES);
  for (const day of fixture.responses.seasonGames.dates)
    for (const game of day.games) {
      const home = game.teams.home.team.id;
      game.venue = makeVenue(home, `Park ${home}`, `City ${home}`, "ST");
    }
  findListing(fixture.responses.seasonGames, 823244).venue = {
    ...makeVenue(9999, "London Stadium", "London"),
    timeZone: { id: "Europe/London", tz: "BST" },
  };
  delete findListing(fixture.responses.seasonGames, 824059).venue;
  const games = listScheduled(buildSnapshot(fixture));
  const findGame = (/** @type {string} */ id) => games.find((game) => game.id === id);

  assert.deepEqual(findGame("823244").ballpark, {
    name: "London Stadium",
    city: "London",
    state: "",
    timeZone: "Europe/London",
  });
  assert.equal(findGame("823244").neutral, true);
  assert.deepEqual(findGame("823326").ballpark, {
    name: "Park 134",
    city: "City 134",
    state: "ST",
    timeZone: "America/New_York",
  });
  assert.equal(findGame("823326").neutral, undefined);
  assert.equal(findGame("824059").ballpark, undefined);
  assert.equal(findGame("824059").neutral, undefined);
});

test("the days around today count over the season's schedule, and a game under way is listed as before it started", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const { responses } = fixture;
  const playing = findListing(responses.schedule, 849832);
  const behind = findListing(responses.seasonGames, 849832);
  behind.status = { ...behind.status, abstractGameState: "Preview", codedGameState: "S" };
  delete behind.teams.away.score;
  delete behind.teams.home.score;
  assert.equal(
    listScheduled(buildSnapshot(fixture)).find((game) => game.id === "849832").state,
    "final",
  );

  playing.status = {
    ...playing.status,
    abstractGameState: "Live",
    codedGameState: "I",
    detailedState: "In Progress",
  };
  const live = listScheduled(buildSnapshot(fixture)).find((game) => game.id === "849832");
  assert.equal(live.state, "pre");
  assert.equal(live.score, undefined);
});

test("a decided series' games still to play aren't listed, and its games played are", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const decided = findListing(fixture.responses.postseason, 849838);
  const unneeded = {
    ...structuredClone(decided),
    gamePk: 849899,
    gameDate: "2026-10-10T22:00:00Z",
    officialDate: "2026-10-10",
    seriesGameNumber: 5,
    status: {
      abstractGameState: "Preview",
      codedGameState: "S",
      detailedState: "Scheduled",
      startTimeTBD: false,
    },
  };
  delete unneeded.teams.away.score;
  delete unneeded.teams.home.score;
  fixture.responses.postseason.dates.push({ date: "2026-10-10", games: [unneeded] });
  const snapshot = buildSnapshot(fixture);
  assert.ok(snapshot.log.some((entry) => entry.kind === "clinch" && entry.series === "AL_DS1"));
  const ids = listScheduled(snapshot).map((game) => game.id);
  assert.ok(ids.includes("849838"));
  assert.ok(!ids.includes("849899"));
});

test("a playoff game MLB dropped from the postseason isn't listed, though the season's whole schedule still lists it", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const decided = findListing(fixture.responses.seasonGames, 849838);
  const dropped = {
    ...structuredClone(decided),
    gamePk: 849899,
    gameDate: "2026-10-10T22:00:00Z",
    officialDate: "2026-10-10",
    seriesGameNumber: 5,
    ifNecessary: "Y",
    status: {
      abstractGameState: "Preview",
      codedGameState: "S",
      detailedState: "Scheduled",
      startTimeTBD: false,
    },
  };
  delete dropped.teams.away.score;
  delete dropped.teams.home.score;
  fixture.responses.seasonGames.dates.push({ date: "2026-10-10", games: [dropped] });
  const ids = listScheduled(buildSnapshot(fixture)).map((game) => game.id);
  assert.ok(ids.includes("849838"));
  assert.ok(!ids.includes("849899"));
});

test("without the season's whole schedule, there's no schedule to save", () => {
  assert.equal(buildSnapshot(EVENING).schedule, null);
  const responses = { ...SEASON_GAMES.responses, seasonGames: null };
  const snapshot = MLBSnapshot.buildSnapshot(responses, {
    season: 2026,
    now: Date.parse(SEASON_GAMES.now),
  });
  assert.equal(snapshot.schedule, null);
  assert.deepEqual(snapshot.missing, []);
});

test("a postseason final names its series and its game in it, and shows its starters but not its series record, which MLB lists as the clubs' records", () => {
  const games = listScheduled(buildSnapshot(SEASON_GAMES));
  assert.deepEqual(
    games.find((game) => game.id === "849845"),
    {
      date: "2026-09-29",
      id: "849845",
      away: "PHI",
      home: "ATL",
      state: "final",
      start: "2026-09-29T18:00:00Z",
      score: [3, 5],
      postseason: true,
      series: "NL_WC1",
      number: 1,
      starters: [
        { id: 666200, name: "Luzardo", hand: "L" },
        { id: 519242, name: "Sale", hand: "L" },
      ],
    },
  );
});

test("a postseason game names its series and its game before both its clubs are known", () => {
  const games = listScheduled(buildSnapshot(SEASON_GAMES));
  const opener = games.find((game) => game.date === "2026-10-12" && game.home === "TB");
  assert.equal(opener.away, null);
  assert.equal(opener.series, "AL_CS");
  assert.equal(opener.number, 1);
  const worldSeries = games.filter((game) => game.date >= "2026-10-23");
  assert.deepEqual(
    worldSeries.map((game) => `${game.series} ${game.number}`),
    ["WS 1", "WS 2", "WS 3", "WS 4", "WS 5", "WS 6", "WS 7"],
  );
});

/**
 * @param {any} fixture
 * @param {number} gamePk
 * @param {string} flag
 */
function markIfNecessary(fixture, gamePk, flag) {
  const { postseason, schedule } = fixture.responses;
  for (const listing of [findListing(postseason, gamePk), findListing(schedule, gamePk)])
    if (listing) listing.ifNecessary = flag;
}

test("a postseason game MLB marks If Necessary says so until it's played", () => {
  const fixture = structuredClone(SEASON_GAMES);
  markIfNecessary(fixture, 849808, "Y");
  markIfNecessary(fixture, 849845, "Y");
  const games = listScheduled(buildSnapshot(fixture));
  const findGame = (id) => games.find((game) => game.id === id);
  assert.deepEqual([findGame("849808").state, findGame("849808").ifNecessary], ["pre", true]);
  assert.deepEqual(
    [findGame("849845").state, findGame("849845").ifNecessary],
    ["final", undefined],
  );

  markIfNecessary(fixture, 849808, "N");
  const needed = listScheduled(buildSnapshot(fixture)).find((game) => game.id === "849808");
  assert.equal(needed.ifNecessary, undefined);
});

test("a game MLB still marks If Necessary once its series needs it isn't marked", () => {
  const fixture = structuredClone(SEASON_GAMES);
  markIfNecessary(fixture, 849831, "Y");
  const snapshot = buildSnapshot(fixture);
  assert.deepEqual([snapshot.series.AL_DS2.winsA, snapshot.series.AL_DS2.winsB], [2, 2]);
  const deciding = listScheduled(snapshot).find((game) => game.id === "849831");
  assert.deepEqual([deciding.state, deciding.number, deciding.ifNecessary], ["pre", 5, undefined]);
});

test("a final that went extra innings, or was called short, says in which inning it ended", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const { seasonGames, postseason, schedule } = fixture.responses;
  /** @param {any} listing @param {number} inning */
  const endIn = (listing, inning) => (listing.linescore = { currentInning: inning });
  const regular = seasonGames.dates
    .flatMap((day) => day.games)
    .filter((game) => game.gameType === "R");
  const [extra, short, regulation] = regular.filter(
    (game) => game.status.abstractGameState === "Final",
  );
  endIn(extra, 10);
  endIn(short, 7);
  endIn(regulation, 9);
  for (const feed of [seasonGames, postseason, schedule]) endIn(findListing(feed, 849845), 11);
  const games = listScheduled(buildSnapshot(fixture));
  const findInnings = (listing) => games.find((game) => game.id === String(listing.gamePk)).innings;
  assert.equal(findInnings(extra), 10);
  assert.equal(findInnings(short), 7);
  assert.equal(findInnings(regulation), undefined);
  assert.equal(findInnings(findListing(postseason, 849845)), 11);
});

test("a game still to play lists each club's probable starter once MLB names him, with his arm, named by whichever read describes him", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const { seasonGames, schedule } = fixture.responses;
  for (const listing of [findListing(seasonGames, 849831), findListing(schedule, 849831)]) {
    delete listing.teams.away.probablePitcher;
    delete listing.teams.home.probablePitcher;
  }
  const findGame = () => listScheduled(buildSnapshot(fixture)).find((each) => each.id === "849831");
  assert.equal(findGame().state, "pre");
  assert.equal(findGame().starters, undefined);

  findListing(schedule, 849831).teams.away.probablePitcher = { id: 1 };
  findListing(seasonGames, 849831).teams.away.probablePitcher = {
    id: 1,
    useLastName: "Pitcher",
    pitchHand: { code: "L" },
  };
  assert.deepEqual(findGame().starters, [{ id: 1, name: "Pitcher", hand: "L" }, null]);
});

test("a regular season game's records are each club's as MLB lists them with it, and a game called off has none", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const listing = findListing(fixture.responses.seasonGames, 823244);
  listing.teams.away.leagueRecord = { wins: 2, losses: 0 };
  const games = listScheduled(buildSnapshot(fixture));
  assert.deepEqual(games.find((game) => game.id === "823244").records, ["2-0", "0-1"]);
  const postponed = games.find((game) => game.id === "823042" && game.state === "off");
  assert.equal(postponed.records, undefined);
});

test("a game still to come keeps no records, since each club's record now comes from the standings", () => {
  const fixture = structuredClone(SEASON_GAMES);
  const listing = findListing(fixture.responses.seasonGames, 823244);
  listing.status = {
    abstractGameState: "Preview",
    codedGameState: "S",
    detailedState: "Scheduled",
  };
  const game = listScheduled(buildSnapshot(fixture)).find((each) => each.id === "823244");
  assert.equal(game.state, "pre");
  assert.equal(game.records, undefined);
});

test("each club's standings row keeps its runs scored and allowed and its records at home and on the road, and leaves out any MLB didn't answer with", () => {
  const responses = structuredClone(EVENING.responses);
  const rays = responses.standings.records
    .flatMap((/** @type {any} */ division) => division.teamRecords)
    .find((/** @type {any} */ record) => record.team.id === 139);
  Object.assign(rays, {
    runsScored: 736,
    runsAllowed: 650,
    records: {
      splitRecords: [
        { type: "home", wins: 55, losses: 26 },
        { type: "away", wins: 43, losses: 38 },
        { type: "night", wins: 60, losses: 40 },
      ],
    },
  });
  const { divisions } = buildSnapshot({ ...EVENING, responses }).standings;
  const [tampa, yankees] = divisions["AL East"];

  assert.deepEqual(
    { rs: tampa.rs, ra: tampa.ra, home: tampa.home, road: tampa.road },
    { rs: 736, ra: 650, home: "55-26", road: "43-38" },
  );
  assert.equal(yankees.id, "NYY");
  for (const field of ["rs", "ra", "home", "road"]) assert.ok(!(field in yankees), field);
});

test("a decided series's games it didn't need are called off, and every other playoff game is played", () => {
  const gamesBySeries = {
    AL_WC1: [
      { id: "1", state: "final" },
      { id: "2", state: "final" },
      { id: "3", state: "pre" },
    ],
    NL_WC1: [
      { id: "4", state: "final" },
      { id: "5", state: "pre" },
    ],
  };
  const log = [
    { kind: "clinch", series: "AL_WC1" },
    { kind: "win", series: "NL_WC1" },
  ];
  const { needed, calledOffIds } = splitPostseasonGames(gamesBySeries, log);
  assert.deepEqual(
    needed.map((game) => game.id),
    ["1", "2", "4", "5"],
  );
  assert.deepEqual([...calledOffIds], ["3"]);
});

test("reminders join current playoff state and channels, excluding unconfirmed and ineligible games", () => {
  const original = buildSnapshot(DIVISION_SERIES);
  const candidate = MLBSnapshot.listReminderGames(original).find((game) =>
    DIVISION_SERIES.responses.schedule.dates.some((day) =>
      day.games.some((listing) => String(listing.gamePk) === game.id),
    ),
  );
  assert.ok(candidate);
  const buildChanged = (change) => {
    const fixture = structuredClone(DIVISION_SERIES);
    for (const feed of ["postseason", "schedule", "seasonGames"])
      for (const day of fixture.responses[feed]?.dates ?? [])
        for (const game of day.games ?? []) if (String(game.gamePk) === candidate.id) change(game);
    if (fixture.responses.liveGames) delete fixture.responses.liveGames[candidate.id];
    return buildSnapshot(fixture);
  };
  const listed = buildChanged((game) => {
    game.broadcasts = [{ name: "FOX", type: "TV", language: "en", isNational: true }];
  });
  assert.deepEqual(
    MLBSnapshot.listReminderGames(listed).find((game) => game.id === candidate.id).networks,
    ["FOX"],
  );
  assert.deepEqual(
    listed.slate.today.games.find((game) => game.id === candidate.id)?.networks ??
      listed.slate.nextDay.games.find((game) => game.id === candidate.id).networks,
    ["FOX"],
  );
  for (const change of [
    (game) => {
      game.status = { abstractGameState: "Live", codedGameState: "I" };
    },
    (game) => {
      game.status = { abstractGameState: "Final", codedGameState: "F" };
    },
    (game) => {
      game.status = { abstractGameState: "Final", codedGameState: "D", detailedState: "Postponed" };
    },
    (game) => {
      game.status.startTimeTBD = true;
    },
    (game) => {
      game.teams.away.team = { id: 0, name: "TBD" };
    },
    (game) => {
      game.ifNecessary = "Y";
      game.seriesGameNumber = 99;
    },
    (game) => {
      game.gameType = "A";
    },
  ])
    assert.ok(
      !MLBSnapshot.listReminderGames(buildChanged(change)).some((game) => game.id === candidate.id),
    );
});

test("an if-needed division series Game 5 becomes eligible only after a 2-2 tie", () => {
  const fixture = structuredClone(DIVISION_SERIES);
  const targetIds = new Set(
    fixture.responses.postseason.dates
      .flatMap((day) => day.games)
      .filter(
        (game) =>
          game.gameType === "D" && [game.teams.away.team.id, game.teams.home.team.id].includes(114),
      )
      .map((game) => game.gamePk),
  );
  let fifthId;
  for (const feed of ["postseason", "schedule", "seasonGames"])
    for (const day of fixture.responses[feed]?.dates ?? [])
      for (const game of day.games ?? []) {
        if (!targetIds.has(game.gamePk)) continue;
        const number = game.seriesGameNumber;
        game.status = {
          abstractGameState: number <= 4 ? "Final" : "Preview",
          codedGameState: number <= 4 ? "F" : "S",
          startTimeTBD: false,
        };
        if (number <= 4) {
          const winner = number % 2 ? 114 : 145;
          for (const side of ["away", "home"])
            game.teams[side].score = game.teams[side].team.id === winner ? 8 : 1;
        } else {
          fifthId = String(game.gamePk);
          game.ifNecessary = "Y";
        }
        delete fixture.responses.liveGames?.[game.gamePk];
      }
  const tied = buildSnapshot(fixture);
  assert.equal(
    Object.values(tied.series).some((series) => series.winsA === 2 && series.winsB === 2),
    true,
  );
  assert.equal(
    MLBSnapshot.listReminderGames(tied).some((game) => game.id === fifthId),
    true,
  );
  for (const feed of ["postseason", "schedule", "seasonGames"])
    for (const day of fixture.responses[feed]?.dates ?? [])
      for (const game of day.games ?? [])
        if (targetIds.has(game.gamePk) && game.seriesGameNumber === 4)
          game.status = { abstractGameState: "Preview", codedGameState: "S", startTimeTBD: false };
  assert.equal(
    MLBSnapshot.listReminderGames(buildSnapshot(fixture)).some((game) => game.id === fifthId),
    false,
  );
});

test("a failed required MLB reminder read retains pending facts rather than confirming cancellation", () => {
  for (const feed of ["postseason", "schedule"]) {
    const fixture = structuredClone(DIVISION_SERIES);
    fixture.responses[feed] = null;
    assert.equal(MLBSnapshot.listReminderGames(buildSnapshot(fixture)), null, feed);
  }
});
