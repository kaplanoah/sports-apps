import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as WNBASnapshot from "../page/js/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
// The next day's games, with the whole season's schedule.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
// Where ESPN lists each playoff game, from its scoreboard for each month they're played in.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-02-espn-scoreboard.json`, "utf8"),
);
const RESPONSES = AFTERNOON.responses;
const buildAfternoon = (responses = RESPONSES) =>
  WNBASnapshot.buildSnapshot(responses, {
    season: AFTERNOON.season,
    now: Date.parse(AFTERNOON.now),
  });

test("a playoff game's ID names its round, series, and game", () => {
  assert.deepEqual(WNBASnapshot.readPlayoffGameId("1042600132"), {
    season: 2026,
    round: 1,
    series: 3,
    game: 2,
  });
  assert.deepEqual(WNBASnapshot.readPlayoffGameId("1042500307"), {
    season: 2025,
    round: 3,
    series: 0,
    game: 7,
  });
  assert.equal(WNBASnapshot.readPlayoffGameId("1022600097"), null);
});

test("a new year's snapshot leaves out the last season's games, which the feeds still hold", () => {
  const nextYear = WNBASnapshot.buildSnapshot(
    { ...RESPONSES, bracket: null },
    { season: 2027, now: Date.parse(AFTERNOON.now) },
  );
  assert.deepEqual([nextYear.games, nextYear.series], [[], []]);
  assert.equal(buildAfternoon().games.length, 28);
});

// The afternoon's scores, with the whole season's schedule from the next day, its regular season
// and all.
/** @param {object} [responses] */
const buildWithWholeSeason = (responses = {}) =>
  buildAfternoon({ ...RESPONSES, schedule: GAMES.preview.schedule, ...responses });

/**
 * @param {any[]} games
 * @param {string} team
 */
const listTeamIds = (games, team) =>
  games.filter((game) => game.away.team === team || game.home.team === team).map((game) => game.id);

/** @param {(game: any) => boolean} isKept */
const keepScheduledGames = (isKept) => ({
  leagueSchedule: {
    ...GAMES.preview.schedule.leagueSchedule,
    gameDates: GAMES.preview.schedule.leagueSchedule.gameDates.map((day) => ({
      ...day,
      games: day.games.filter(isKept),
    })),
  },
});

// Tonight's game in Chicago, as the scoreboard has it in the third quarter.
const SEATTLE_AT_CHICAGO = {
  ...AFTERNOON.responses.scoreboard.scoreboard.games[0],
  gameId: "1022600400",
  gameStatus: 2,
  gameStatusText: "Q3 4:12",
  period: 3,
  gameClock: "PT04M12.00S",
  awayTeam: { teamTricode: "SEA", score: 61 },
  homeTeam: { teamTricode: "CHI", score: 58 },
};

/** @param {any} game */
const addToScoreboard = (game) => {
  const { scoreboard } = AFTERNOON.responses;
  const games = [...scoreboard.scoreboard.games, game];
  return { scoreboard: { ...scoreboard, scoreboard: { ...scoreboard.scoreboard, games } } };
};

test("each team's nearest games come from its whole season, while the games are only the playoffs'", () => {
  const { games, nearestGames } = buildWithWholeSeason();
  assert.ok(games.every((game) => game.round));
  assert.deepEqual(listTeamIds(nearestGames, "SEA"), ["1022600325"]);
  assert.deepEqual(listTeamIds(nearestGames, "ATL"), ["1042600131", "1042600132", "1042600201"]);
  assert.ok(
    nearestGames.every((game, index) => index === 0 || game.start >= nearestGames[index - 1].start),
  );
  const seattle = nearestGames.find((game) => game.id === "1022600325");
  assert.deepEqual(
    [seattle.state, seattle.round, seattle.away.team, seattle.away.score, seattle.home.score],
    ["final", null, "DAL", 103, 91],
  );
});

test("the Commissioner's Cup final counts among a team's games, and the preseason and the All-Star Game don't", () => {
  const { nearestGames } = buildWithWholeSeason({
    schedule: keepScheduledGames((game) => /^10[135]/.test(game.gameId)),
  });
  assert.deepEqual(listTeamIds(nearestGames, "LVA"), ["1052600001"]);
  assert.ok(nearestGames.every((game) => !/^10[13]/.test(game.id)));
});

test("a regular-season game on the scoreboard is a team's game now, with its clock", () => {
  const { nearestGames } = buildWithWholeSeason(addToScoreboard(SEATTLE_AT_CHICAGO));
  const live = nearestGames.find((game) => game.id === "1022600400");
  assert.deepEqual(
    [live.state, live.period, live.clock, live.away.score, live.home.score],
    ["live", 3, "4:12", 61, 58],
  );
});

test("the schedule lists every game of the season in order, with only a final's score and status, and a game under way as before it started", () => {
  const { schedule } = buildWithWholeSeason(addToScoreboard(SEATTLE_AT_CHICAGO));
  assert.ok(schedule.length > 300);
  assert.ok(
    schedule.every((game, index) => index === 0 || game.start >= schedule[index - 1].start),
  );
  assert.ok(schedule.every((game) => !/^101/.test(game.id)));
  const seattle = schedule.find((game) => game.id === "1022600325");
  assert.deepEqual([seattle.state, seattle.away.score, seattle.home.score], ["final", 103, 91]);
  const live = schedule.find((game) => game.id === "1022600400");
  assert.deepEqual(
    [live.state, live.status, live.period, live.clock, live.away.score, live.home.score],
    ["pre", "", null, null, null, null],
  );
});

test("the schedule lists the All-Star Game with its teams' names, which no other game carries", () => {
  const { schedule, games, nearestGames } = buildWithWholeSeason(
    addToScoreboard(SEATTLE_AT_CHICAGO),
  );
  const allStar = schedule.find((game) => game.id === "1032600001");
  assert.deepEqual(
    {
      start: allStar.start,
      state: allStar.state,
      allStar: allStar.allStar,
      scores: [allStar.away.score, allStar.home.score],
    },
    {
      start: "2026-07-26T00:30:00Z",
      state: "final",
      allStar: { away: "Spoon", home: "Coop" },
      scores: [129, 122],
    },
  );
  assert.deepEqual(
    schedule.filter((game) => game.allStar).map((game) => game.id),
    ["1032600001"],
  );
  assert.ok(![...games, ...nearestGames].some((game) => game.id === "1032600001"));
});

test("the clock reads as minutes and seconds, and tenths in the last minute", () => {
  assert.equal(WNBASnapshot.readClock("PT04M32.00S"), "4:32");
  assert.equal(WNBASnapshot.readClock("PT10M00.00S"), "10:00");
  assert.equal(WNBASnapshot.readClock("PT00M42.30S"), "42.3");
  assert.equal(WNBASnapshot.readClock(""), null);
});

test("every playoff game is listed in order, with the scoreboard's word on today's", () => {
  const { games } = buildAfternoon();
  assert.equal(games.length, 28);
  assert.ok(games.every((game, index) => index === 0 || game.start >= games[index - 1].start));
  const opener = games.find((game) => game.id === "1042600101");
  assert.deepEqual(
    {
      series: opener.series,
      number: opener.number,
      state: opener.state,
      away: [opener.away.team, opener.away.seed, opener.away.score],
      home: [opener.home.team, opener.home.seed, opener.home.score],
    },
    { series: "1-0", number: 1, state: "final", away: ["NYL", 8, 91], home: ["MIN", 1, 75] },
  );
  const tonight = games.find((game) => game.id === "1042600132");
  assert.equal(tonight.state, "pre");
  assert.equal(tonight.status, "7:00 pm ET");
  assert.equal(tonight.start, "2026-09-30T23:00:00Z");
});

test("every game says where it's on or was, from a finished one to one days ahead", () => {
  const { games } = buildAfternoon({
    ...RESPONSES,
    networks: Object.values(ESPN_SCOREBOARD.answers),
  });
  const readNetworks = (id) => games.find((game) => game.id === id)?.networks;
  assert.deepEqual(readNetworks("1042600101"), ["ABC"], "finished");
  assert.deepEqual(readNetworks("1042600132"), ["ESPN"], "tonight");
  assert.deepEqual(readNetworks("1042600123"), ["USA Net", "CNBC"], "the day after tomorrow");
  assert.deepEqual(readNetworks("1042600201"), [], "not on ESPN's list yet");
  assert.ok(buildAfternoon().games.every((game) => !game.networks.length));
});

test("a game whose teams ESPN hasn't named yet isn't matched to any of the league's games", () => {
  const answers = structuredClone(Object.values(ESPN_SCOREBOARD.answers));
  const finalsGameOne = answers[1].events.find((event) => event.date === "2026-10-17T19:30Z");
  assert.deepEqual(finalsGameOne.competitions[0].broadcasts[0].names, ["NBC"]);
  const { games } = buildAfternoon({ ...RESPONSES, networks: answers });
  assert.deepEqual(games.find((game) => game.id === "1042600301").networks, []);
});

test("a game's national channels come before a team's own", () => {
  const answers = structuredClone(Object.values(ESPN_SCOREBOARD.answers));
  const [competition] = answers[0].events.find(
    (event) => event.date === "2026-09-30T23:00Z",
  ).competitions;
  competition.broadcasts = [
    { market: "home", names: ["Monumental"] },
    { market: "national", names: ["ESPN", "Disney+"] },
    { market: "away", names: ["Peachtree TV", "ESPN"] },
  ];
  const { games } = buildAfternoon({ ...RESPONSES, networks: answers });
  const tonight = games.find((game) => game.id === "1042600132");
  assert.deepEqual(tonight.networks, ["ESPN", "Disney+", "Monumental", "Peachtree TV"]);
});

test("a game still to be scheduled says its time isn't set, and a game that may not be played says so", () => {
  const { games } = buildAfternoon();
  const semifinal = games.find((game) => game.id === "1042600201");
  assert.equal(semifinal.isTimeSet, false);
  const deciding = games.find((game) => game.id === "1042600133");
  assert.equal(deciding.isIfNeeded, true);
});

/**
 * ESPN's listing of the semifinal opener between the Liberty and the Dream, at a time of its own.
 * @param {string} start
 * @param {boolean} isTimeValid
 */
function listSemifinalOpener(start, isTimeValid) {
  const answers = structuredClone(Object.values(ESPN_SCOREBOARD.answers));
  const opener = answers
    .flatMap((answer) => answer.events)
    .find((event) => event.shortName === "NY @ ATL");
  const [competition] = opener.competitions;
  Object.assign(competition, { date: start, timeValid: isTimeValid });
  opener.date = start;
  return answers;
}

// The afternoon's schedule doesn't know the Liberty's opponent yet, so the Dream stands in.
const SCHEDULE_WITH_OPENER = structuredClone(RESPONSES.schedule);
SCHEDULE_WITH_OPENER.leagueSchedule.gameDates
  .flatMap((day) => day.games)
  .find((game) => game.gameId === "1042600201").homeTeam.teamTricode = "ATL";

const buildWithOpener = (networks) =>
  buildAfternoon({ ...RESPONSES, schedule: SCHEDULE_WITH_OPENER, networks });
const findSemifinalOpener = (networks) =>
  buildWithOpener(networks).games.find((game) => game.id === "1042600201");

test("a game the league hasn't timed takes ESPN's time once ESPN has set it", () => {
  const timed = findSemifinalOpener(listSemifinalOpener("2026-10-04T18:00Z", true));
  assert.deepEqual([timed.start, timed.isTimeSet], ["2026-10-04T18:00Z", true]);
  const untimed = findSemifinalOpener(listSemifinalOpener("2026-10-04T04:00Z", false));
  assert.deepEqual([untimed.start, untimed.isTimeSet], ["2026-10-04T04:00:00Z", false]);
});

test("ESPN's time for the same teams on another day leaves a game's time unset", () => {
  const dayBefore = findSemifinalOpener(listSemifinalOpener("2026-10-03T23:30Z", true));
  assert.deepEqual([dayBefore.start, dayBefore.isTimeSet], ["2026-10-04T04:00:00Z", false]);
});

test("a game timed from ESPN takes its place among the day's games by its start", () => {
  const { games } = buildWithOpener(listSemifinalOpener("2026-10-04T21:00Z", true));
  const onTheDay = games.filter((game) => game.start.startsWith("2026-10-04"));
  assert.deepEqual(
    onTheDay.map((game) => game.id),
    ["1042600211", "1042600201"],
  );
});

test("each series names its seeds, its wins, its winner, and its next game", () => {
  const { series } = buildAfternoon();
  assert.equal(series.length, 7);
  const [decided, , , , semifinal, , finals] = series;
  assert.deepEqual(decided, {
    id: "1-0",
    round: 1,
    top: { team: "MIN", seed: 1, wins: 0 },
    bottom: { team: "NYL", seed: 8, wins: 2 },
    winner: "NYL",
    status: "NYL wins 2-0",
    nextGame: null,
  });
  assert.deepEqual(semifinal.top, { team: "NYL", seed: 8, wins: 0 });
  assert.equal(semifinal.bottom, null);
  assert.deepEqual([finals.top, finals.bottom], [null, null]);
});

test("without the bracket, a series counts its wins from its finished games", () => {
  const { series, missing } = buildAfternoon({ ...RESPONSES, bracket: null });
  assert.deepEqual(missing, ["bracket"]);
  const decided = series.find((record) => record.id === "1-0");
  assert.deepEqual(
    [decided.top, decided.bottom, decided.winner],
    [{ team: "MIN", seed: 1, wins: 0 }, { team: "NYL", seed: 8, wins: 2 }, "NYL"],
  );
  const semifinal = series.find((record) => record.id === "2-0");
  assert.deepEqual([semifinal.top, semifinal.bottom], [{ team: "NYL", seed: 8, wins: 0 }, null]);
});

// Moments just after a final, when the bracket still had the series as it was before the game.
const readFinal = (name) => {
  const moment = JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}`, "utf8"));
  const responses = { ...RESPONSES, ...moment.responses };
  return WNBASnapshot.buildSnapshot(responses, {
    season: moment.season,
    now: Date.parse(moment.now),
  });
};

test("a series counts a game that just finished before the bracket does", () => {
  const { series } = readFinal("2026-10-01-atlanta-final.json");
  const settled = series.find((record) => record.id === "1-3");
  assert.deepEqual(
    [settled.top, settled.bottom, settled.winner, settled.nextGame],
    [{ team: "ATL", seed: 4, wins: 2 }, { team: "WAS", seed: 5, wins: 0 }, "ATL", null],
  );
});

test("a series whose next game just finished names the game after it", () => {
  const { series } = readFinal("2026-10-01-dallas-final.json");
  const tied = series.find((record) => record.id === "1-1");
  assert.deepEqual(
    [tied.top.wins, tied.bottom.wins, tied.winner, tied.nextGame?.id],
    [1, 1, null, "1042600113"],
  );
});

test("the standings run 1 to 15 across the league, each with its conference place", () => {
  const { standings } = buildAfternoon();
  assert.equal(standings.length, 15);
  assert.deepEqual(
    standings.map((row) => row.team),
    [
      "MIN",
      "GSV",
      "LVA",
      "ATL",
      "WAS",
      "IND",
      "DAL",
      "NYL",
      "PDX",
      "PHX",
      "CHI",
      "LAS",
      "TOR",
      "CON",
      "SEA",
    ],
  );
  const atlanta = standings[3];
  assert.deepEqual(
    [atlanta.conference, atlanta.place, atlanta.conferencePlace, atlanta.wins, atlanta.losses],
    ["East", 4, 1, 30, 14],
  );
  assert.equal(standings[0].clinch, "x");
  assert.equal(standings[8].clinch, "o");
});

test("each team's standing has its points a game, for and against, and its home and road records", () => {
  const { standings } = buildAfternoon();
  const { pointsFor, pointsAgainst, margin, home, road, lastTen } = standings[0];
  assert.deepEqual(
    { pointsFor, pointsAgainst, margin, home, road, lastTen },
    {
      pointsFor: 90.8,
      pointsAgainst: 83.7,
      margin: 7.2,
      home: "15-7",
      road: "18-4",
      lastTen: "6-4",
    },
  );
});

test("polling waits until 15 minutes before the next set start, and runs every 15 seconds in a game", () => {
  const snapshot = buildAfternoon();
  const now = Date.parse(AFTERNOON.now);
  assert.equal(
    WNBASnapshot.choosePollDelay(snapshot, now),
    Date.parse("2026-09-30T23:00:00Z") - 15 * 60 * 1000 - now,
  );
  const live = {
    games: snapshot.games.map((game) =>
      game.id === "1042600132" ? { ...game, state: "live" } : game,
    ),
  };
  assert.equal(WNBASnapshot.choosePollDelay(live, now), 15 * 1000);
});

test("the last 5 minutes of the 4th quarter and all of overtime are followed every 5 seconds", () => {
  const now = Date.parse(AFTERNOON.now);
  const computePollDelay = (period, clock) =>
    WNBASnapshot.choosePollDelay({ games: [{ state: "live", period, clock }] }, now);
  assert.equal(computePollDelay(3, "1:12"), 15 * 1000);
  assert.equal(computePollDelay(3, "0.0"), 15 * 1000);
  assert.equal(computePollDelay(4, "10:00"), 15 * 1000);
  assert.equal(computePollDelay(4, "5:01"), 15 * 1000);
  assert.equal(computePollDelay(4, "5:00"), 5 * 1000);
  assert.equal(computePollDelay(4, "45.2"), 5 * 1000);
  assert.equal(computePollDelay(4, null), 15 * 1000);
  assert.equal(computePollDelay(5, "5:00"), 5 * 1000);
  assert.equal(computePollDelay(6, null), 5 * 1000);
  assert.equal(WNBASnapshot.readClock("PT05M00.00S"), "5:00");
  const final = { games: [{ state: "final", period: 4, clock: null }] };
  assert.notEqual(WNBASnapshot.choosePollDelay(final, now), 5 * 1000);
});

test("polling follows a team's game now as closely as a playoff game", () => {
  const now = Date.parse(AFTERNOON.now);
  const snapshot = buildWithWholeSeason(addToScoreboard(SEATTLE_AT_CHICAGO));
  assert.ok(snapshot.games.every((game) => game.state !== "live"));
  assert.equal(WNBASnapshot.choosePollDelay(snapshot, now), 15 * 1000);
});

test("the scheduled starts take in each team's nearest games as well as the playoffs'", () => {
  const starts = WNBASnapshot.listScheduledStarts(GAMES.preview.schedule, 2026);
  const seattle = buildWithWholeSeason().nearestGames.find((game) => game.id === "1022600325");
  assert.ok(starts.includes(seattle.start));
  assert.ok(buildWithWholeSeason().games.every((game) => starts.includes(game.start)));
});

test("a game that hasn't started is followed closely at first, then less, and then let go", () => {
  const lateGame = buildAfternoon().games.find((game) => game.id === "1042600132");
  const start = Date.parse(lateGame.start);
  const snapshot = { games: [lateGame] };
  const HOUR_MS = 60 * 60 * 1000;
  assert.equal(WNBASnapshot.choosePollDelay(snapshot, start + HOUR_MS / 2), 15 * 1000);
  assert.equal(WNBASnapshot.choosePollDelay(snapshot, start + 4 * HOUR_MS), 5 * 60 * 1000);
  assert.equal(WNBASnapshot.choosePollDelay(snapshot, start + 9 * HOUR_MS), 24 * HOUR_MS);
});

test("a playoff game the league put off isn't followed past its start as one about to tip off", () => {
  const lateGame = buildAfternoon().games.find((game) => game.id === "1042600132");
  const start = Date.parse(lateGame.start);
  const putOff = { games: [{ ...lateGame, status: "Postponed" }] };
  assert.equal(WNBASnapshot.choosePollDelay(putOff, start + 30 * 60 * 1000), 24 * 60 * 60 * 1000);
});

test("each game keeps the arena the schedule names, through the scoreboard's copy of today's games, and none while the league hasn't set it", () => {
  const { schedule, games } = buildAfternoon();
  const findArena = (list, id) => list.find((game) => game.id === id)?.arena;
  const barclays = { name: "Barclays Center", city: "Brooklyn", state: "NY" };
  assert.deepEqual(findArena(schedule, "1042600102"), barclays);
  assert.deepEqual(findArena(games, "1042600132"), {
    name: "CareFirst Arena",
    city: "Washington",
    state: "DC",
  });
  assert.equal(findArena(schedule, "1042600201"), undefined);
  assert.ok(schedule.every((game) => !game.isNeutral));
});

test("a game the league plays at a neutral site says so", () => {
  const neutralSchedule = structuredClone(RESPONSES.schedule);
  const game = neutralSchedule.leagueSchedule.gameDates
    .flatMap((day) => day.games)
    .find((each) => each.gameId === "1042600102");
  Object.assign(game, {
    isNeutral: true,
    arenaName: "Rogers Arena",
    arenaCity: "Vancouver",
    arenaState: "BC",
  });
  const { schedule } = buildAfternoon({ ...RESPONSES, schedule: neutralSchedule });
  const neutral = schedule.find((each) => each.id === "1042600102");
  assert.deepEqual([neutral.isNeutral, neutral.arena.city], [true, "Vancouver"]);
});
