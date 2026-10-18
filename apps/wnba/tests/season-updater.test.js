import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot, readPlayoffGameId } from "../page/js/snapshot.js";
import { listUpcomingMeetings } from "../worker/src/preview.js";
import {
  listNotifications,
  loadCurrentSnapshot,
  readSchedule,
  readUpdates,
  saveSnapshot,
} from "../worker/src/season-updater.js";
import { createDocs } from "../../../tests/job-context.js";
import { readSeasonAverages } from "./player-fixtures.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The next day's games, with the whole season's schedule.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const RESPONSES = AFTERNOON.responses;
const SNAPSHOT = buildSnapshot(RESPONSES, { season: 2026, now: NOW });

// The afternoon's scores, with the whole season's schedule from the next day, its regular season
// and all.
const WHOLE_SEASON = buildSnapshot(
  { ...RESPONSES, schedule: GAMES.preview.schedule },
  { season: 2026, now: NOW },
);

/** The snapshot as the Worker reads it, with each upcoming game's meetings from the schedule. */
const SNAPSHOT_WITH_MEETINGS = {
  ...SNAPSHOT,
  meetings: listUpcomingMeetings(GAMES.preview.schedule, SNAPSHOT),
};

// Tonight's first game, finished, with the series it settles.
function finishTonight(snapshot, [awayScore, homeScore]) {
  const games = snapshot.games.map((game) =>
    game.id === "1042600132"
      ? {
          ...game,
          state: "final",
          status: "Final",
          away: { ...game.away, score: awayScore },
          home: { ...game.home, score: homeScore },
        }
      : game,
  );
  const series = snapshot.series.map((record) =>
    record.id === "1-3"
      ? { ...record, top: { ...record.top, wins: 2 }, winner: "ATL", status: "ATL wins 2-0" }
      : record,
  );
  return { ...snapshot, games, series };
}

test("the season saves its version, games, series, and standings, and only when they change", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, asOf: "2026-09-30T22:00:00Z" });

  assert.deepEqual(docs.writes, ["seasons/2026", "schedules/2026"]);
  const saved = await readUpdates(docs, 2026);
  assert.equal(saved.version, SNAPSHOT.version);
  assert.equal(saved.games.length, 28);
  assert.equal(saved.series.length, 7);
  assert.equal(saved.standings.length, 15);
  assert.ok(!("averages" in saved));
});

/**
 * @param {any} snapshot
 * @param {string} state
 */
const setTonightsState = (snapshot, state) => ({
  ...snapshot,
  games: snapshot.games.map((game) => (game.id === "1042600132" ? { ...game, state } : game)),
});

const findTonight = (season) => season.games.find((game) => game.id === "1042600132");

test("each upcoming game's meetings are saved for its two teams, only when they change, and stay as they were without the schedule", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT_WITH_MEETINGS);
  await saveSnapshot(docs, SNAPSHOT_WITH_MEETINGS);

  const meetingKeys = docs.writes.filter((key) => key.startsWith("meetings/"));
  assert.deepEqual(meetingKeys, [
    "meetings/2026-ATL-WAS",
    "meetings/2026-DAL-GSV",
    "meetings/2026-IND-LVA",
  ]);
  const saved = await docs.read("meetings/2026-IND-LVA");
  assert.deepEqual(saved.teams, ["IND", "LVA"]);
  assert.equal(saved.meetings.length, 3);

  const changed = structuredClone(SNAPSHOT_WITH_MEETINGS);
  changed.meetings[0].meetings.pop();
  await saveSnapshot(docs, { ...changed, missing: ["schedule"] });
  assert.equal(docs.writes.filter((key) => key.startsWith("meetings/")).length, 3);
  await saveSnapshot(docs, changed);
  assert.equal(docs.writes.at(-1), "meetings/2026-ATL-WAS");
});

test("a team's next game outside the playoffs has its two teams' meetings listed too", () => {
  const seattlesLast = WHOLE_SEASON.nearestGames.find((game) => game.id === "1022600325");
  const nextGame = {
    ...seattlesLast,
    id: "1022600400",
    state: "pre",
    away: { ...seattlesLast.home, score: null },
    home: { ...seattlesLast.away, team: "CHI", score: null },
  };
  const pairs = listUpcomingMeetings(GAMES.preview.schedule, {
    season: 2026,
    games: [],
    nearestGames: [seattlesLast, nextGame],
  });
  assert.deepEqual(
    pairs.map((pair) => pair.teams),
    [["CHI", "SEA"]],
  );
  assert.ok(pairs[0].meetings.length > 0);
});

test("a game ends when it's first found final after being seen live, and keeps that end", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, setTonightsState(SNAPSHOT, "live"));
  const ending = { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T01:12:00Z" };
  await saveSnapshot(docs, ending);
  await saveSnapshot(docs, { ...ending, asOf: "2026-10-01T01:40:00Z" });
  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).end, "2026-10-01T01:12:00Z");
});

test("a game's end from ESPN replaces the one the Worker found", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, setTonightsState(SNAPSHOT, "live"));
  const ending = { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T01:12:00Z" };
  await saveSnapshot(docs, ending);
  const games = ending.games.map((game) =>
    game.id === "1042600132" ? { ...game, end: "2026-10-01T01:11:27Z" } : game,
  );
  await saveSnapshot(docs, { ...ending, games, asOf: "2026-10-01T01:14:00Z" });
  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).end, "2026-10-01T01:11:27Z");
});

test("a game found final without being seen live has no end", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T04:00:00Z" });
  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).end, undefined);
  const earlier = saved.games.find((game) => game.id === "1042600102");
  assert.equal(earlier.end, undefined);
});

test("a game keeps when the Worker first found it final, after ESPN's earlier end replaces its own", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, setTonightsState(SNAPSHOT, "live"));
  const ending = { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T01:12:00Z" };
  await saveSnapshot(docs, ending);
  const games = ending.games.map((game) =>
    game.id === "1042600132" ? { ...game, end: "2026-10-01T01:11:27Z" } : game,
  );
  await saveSnapshot(docs, { ...ending, games, asOf: "2026-10-01T01:14:00Z" });
  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).finalAt, "2026-10-01T01:12:00Z");
});

test("a game the Worker saved before it was final keeps when it was found final, and one final at its first save has no such time", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T04:00:00Z" });
  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).finalAt, "2026-10-01T04:00:00Z");
  const earlier = saved.games.find((game) => game.id === "1042600102");
  assert.equal(earlier.finalAt, undefined);
});

// The afternoon's feeds with the whole season's schedule, and tonight's first game on the
// scoreboard as it stands: under way at the half, or over.
function buildTonight(gameStatus, [awayScore, homeScore] = [0, 0]) {
  const games = AFTERNOON.responses.scoreboard.scoreboard.games.map((game) =>
    game.gameId === "1042600132"
      ? {
          ...game,
          gameStatus,
          gameStatusText: gameStatus === 3 ? "Final" : "Half",
          period: 2,
          awayTeam: { ...game.awayTeam, score: awayScore },
          homeTeam: { ...game.homeTeam, score: homeScore },
        }
      : game,
  );
  const scoreboard = { scoreboard: { ...AFTERNOON.responses.scoreboard.scoreboard, games } };
  return buildSnapshot(
    { ...RESPONSES, schedule: GAMES.preview.schedule, scoreboard },
    { season: 2026, now: NOW },
  );
}

const findScheduledTonight = (schedule) => schedule.games.find((game) => game.id === "1042600132");

test("every game of the season is saved apart from the season, regular season and all", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, WHOLE_SEASON);
  const schedule = await readSchedule(docs, 2026);
  assert.equal(schedule.version, WHOLE_SEASON.version);
  assert.equal(schedule.games.length, WHOLE_SEASON.schedule.length);
  assert.ok(schedule.games.length > 300);
  assert.ok(schedule.games.some((game) => game.round === null));
  assert.ok(schedule.games.some((game) => game.round === 3));
  assert.ok(!("schedule" in (await readUpdates(docs, 2026))));
});

test("the season's games are saved again only as a game ends, not while one is played", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, WHOLE_SEASON);
  docs.writes.length = 0;

  await saveSnapshot(docs, buildTonight(2, [41, 38]));
  assert.ok(!docs.writes.includes("schedules/2026"));
  const live = (await readUpdates(docs, 2026)).games.find((game) => game.id === "1042600132");
  assert.equal(live.state, "live");
  assert.equal(findScheduledTonight(await readSchedule(docs, 2026)).state, "pre");

  await saveSnapshot(docs, buildTonight(3, [84, 79]));
  assert.ok(docs.writes.includes("schedules/2026"));
  const final = findScheduledTonight(await readSchedule(docs, 2026));
  assert.equal(final.state, "final");
  assert.deepEqual([final.away.score, final.home.score], [84, 79]);
});

test("a saved final stays final when a later read has the game under way again", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, buildTonight(3, [84, 79]));

  await saveSnapshot(docs, buildTonight(2));

  const tonight = findTonight(await readUpdates(docs, 2026));
  const scheduled = findScheduledTonight(await readSchedule(docs, 2026));
  assert.deepEqual([tonight.state, tonight.away.score, tonight.home.score], ["final", 84, 79]);
  assert.deepEqual(
    [scheduled.state, scheduled.away.score, scheduled.home.score],
    ["final", 84, 79],
  );
});

test("the season's games stay as they were unless both the scoreboard and the schedule answered", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, buildTonight(3, [84, 79]));
  const saved = await readSchedule(docs, 2026);

  for (const feed of ["scoreboard", "schedule"]) {
    const without = buildSnapshot(
      { ...RESPONSES, schedule: GAMES.preview.schedule, [feed]: null },
      { season: 2026, now: NOW },
    );
    await saveSnapshot(docs, without);
  }
  assert.deepEqual(await readSchedule(docs, 2026), saved);
});

/**
 * The recorded schedule as the league lists the next season's before it starts: its preseason and
 * regular season a year later, numbered for that season, none of them played, and no playoffs.
 * @param {any} schedule
 */
function moveScheduleToNextSeason(schedule) {
  const nextSeason = Number(schedule.leagueSchedule.seasonYear) + 1;
  /** @param {any} team */
  const clearScore = (team) => ({ ...team, score: 0 });
  /** @param {any} game */
  const moveGame = (game) => {
    const start = new Date(game.gameDateTimeUTC);
    start.setUTCFullYear(nextSeason);
    return {
      ...game,
      gameId: `${game.gameId.slice(0, 3)}${nextSeason % 100}${game.gameId.slice(5)}`,
      gameStatus: 1,
      gameDateTimeUTC: start.toISOString().replace(".000Z", "Z"),
      awayTeam: clearScore(game.awayTeam),
      homeTeam: clearScore(game.homeTeam),
    };
  };
  const gameDates = schedule.leagueSchedule.gameDates
    .map((/** @type {any} */ day) => ({
      ...day,
      games: day.games
        .filter((/** @type {any} */ game) => !readPlayoffGameId(game.gameId))
        .map(moveGame),
    }))
    .filter((/** @type {any} */ day) => day.games.length);
  return { leagueSchedule: { seasonYear: String(nextSeason), gameDates } };
}

test("a season keeps its games once the league's schedule lists only the next season's", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, WHOLE_SEASON);
  const savedSchedule = await readSchedule(docs, 2026);
  const savedSeason = await readUpdates(docs, 2026);

  const nextSeasonsOnly = moveScheduleToNextSeason(GAMES.preview.schedule);
  assert.equal(nextSeasonsOnly.leagueSchedule.gameDates[0].games[0].gameId, "1012700001");
  await saveSnapshot(
    docs,
    buildSnapshot({ ...RESPONSES, schedule: nextSeasonsOnly }, { season: 2026, now: NOW }),
  );

  assert.deepEqual(await readSchedule(docs, 2026), savedSchedule);
  const season = await readUpdates(docs, 2026);
  assert.deepEqual(season.games, savedSeason.games);
  assert.deepEqual(season.nearestGames, savedSeason.nearestGames);
});

/**
 * @param {any} snapshot
 * @param {string} state
 */
const setSeattlesLastState = (snapshot, state) => ({
  ...snapshot,
  nearestGames: snapshot.nearestGames.map((game) =>
    game.id === "1022600325" ? { ...game, state } : game,
  ),
});

test("each team's nearest games are saved with the season, and stay as they were unless both the scoreboard and the schedule answered", async () => {
  const docs = createDocs();
  const live = setSeattlesLastState(WHOLE_SEASON, "live");
  await saveSnapshot(docs, live);
  const saved = await readUpdates(docs, 2026);
  assert.deepEqual(saved.nearestGames, live.nearestGames);

  for (const feed of ["scoreboard", "schedule"]) {
    const without = buildSnapshot(
      { ...RESPONSES, schedule: GAMES.preview.schedule, [feed]: null },
      { season: 2026, now: NOW },
    );
    await saveSnapshot(docs, without);
  }
  assert.deepEqual((await readUpdates(docs, 2026)).nearestGames, live.nearestGames);
  await saveSnapshot(docs, WHOLE_SEASON);
  const finished = (await readUpdates(docs, 2026)).nearestGames;
  assert.equal(finished.find((game) => game.id === "1022600325").state, "final");
});

test("a team's nearest game ends when it's first found final after being seen live", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, setSeattlesLastState(WHOLE_SEASON, "live"));
  await saveSnapshot(docs, { ...WHOLE_SEASON, asOf: "2026-09-24T04:05:00Z" });
  const saved = await readUpdates(docs, 2026);
  const seattle = saved.nearestGames.find((game) => game.id === "1022600325");
  assert.equal(seattle.end, "2026-09-24T04:05:00Z");
});

test("a feed that didn't answer leaves its saved field as it was", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  await saveSnapshot(docs, { ...SNAPSHOT, standings: [], missing: ["standings"] });

  assert.equal((await readUpdates(docs, 2026)).standings.length, 15);
});

test("an update leaves the top scorers as the player job saved them, even one that changes the season", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  const { leaders } = readSeasonAverages();
  await docs.write("seasons/2026", { ...(await readUpdates(docs, 2026)), leaders });

  await saveSnapshot(docs, { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T04:00:00Z" });

  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).state, "final");
  assert.deepEqual(saved.leaders, leaders);
});

test("an update and the player job that change the season at once each keep the other's change", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  const { leaders } = readSeasonAverages();
  // The store answers a read a moment later, as Cloudflare's storage does.
  const { read } = docs;
  docs.read = async (key) => {
    const doc = await read(key);
    await new Promise((resolve) => setImmediate(resolve));
    return doc;
  };

  await Promise.all([
    saveSnapshot(docs, { ...finishTonight(SNAPSHOT, [80, 70]), asOf: "2026-10-01T04:00:00Z" }),
    docs.update("seasons/2026", (/** @type {any} */ record) => ({ ...record, leaders })),
  ]);

  const saved = await readUpdates(docs, 2026);
  assert.equal(findTonight(saved).state, "final");
  assert.deepEqual(saved.leaders, leaders);
});

// The afternoon's feeds, with some that didn't answer.
const buildWithout = (feeds) =>
  buildSnapshot(
    { ...RESPONSES, ...Object.fromEntries(feeds.map((feed) => [feed, null])) },
    { season: 2026, now: NOW },
  );

test("the games stay as they were unless both the scoreboard and the schedule answered", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [84, 79]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, buildWithout(["scoreboard"]));
  await saveSnapshot(docs, buildWithout(["schedule"]));

  assert.deepEqual((await readUpdates(docs, 2026)).games, finished.games);
});

test("the games are saved while ESPN stands in for the scoreboard", async () => {
  const docs = createDocs();
  await saveSnapshot(docs, SNAPSHOT);
  const finished = finishTonight(SNAPSHOT, [93, 75]);

  await saveSnapshot(docs, { ...finished, missing: ["scoreboard"], standIn: "espn" });

  const foundFinal = finished.games.map((game) =>
    game.id === "1042600132" ? { ...game, finalAt: finished.asOf } : game,
  );
  assert.deepEqual((await readUpdates(docs, 2026)).games, foundFinal);
});

test("while ESPN stands in, a game it lacks keeps what was saved", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [93, 75]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, { ...SNAPSHOT, missing: ["scoreboard"], standIn: "espn" });

  assert.deepEqual((await readUpdates(docs, 2026)).games, finished.games);
});

test("while ESPN stands in, the series wait for the bracket", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [93, 75]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, { ...SNAPSHOT, missing: ["bracket", "scoreboard"], standIn: "espn" });

  assert.deepEqual((await readUpdates(docs, 2026)).series, finished.series);
});

test("without the bracket, the series stay as they were unless the games answered", async () => {
  const docs = createDocs();
  const finished = finishTonight(SNAPSHOT, [84, 79]);
  await saveSnapshot(docs, finished);

  await saveSnapshot(docs, buildWithout(["bracket", "schedule"]));

  assert.deepEqual((await readUpdates(docs, 2026)).series, finished.series);
});

test("a game that decides its series is news, worded as the Updates box words it", async () => {
  const before = { games: SNAPSHOT.games, series: SNAPSHOT.series };
  const after = finishTonight(SNAPSHOT, [84, 79]);

  const notifications = listNotifications({
    before,
    after,
    now: Date.parse("2026-10-01T01:30:00Z"),
  });

  assert.deepEqual(notifications, [
    {
      title: "Dream beat the Mystics 84-79 to win the First Round 2-0",
      body: "",
      tag: "final:1042600132",
    },
  ]);
});

test("a game that leaves its series going is news, its result and where the series stands the title", () => {
  const isFeverGame2 = (game) => game.id === "1042600122";
  const before = {
    ...SNAPSHOT,
    games: SNAPSHOT.games.map((game) => (isFeverGame2(game) ? { ...game, state: "live" } : game)),
  };

  const notifications = listNotifications({
    before,
    after: SNAPSHOT,
    now: Date.parse("2026-09-30T01:00:00Z"),
  });

  assert.deepEqual(notifications, [
    {
      title: "Fever beat the Aces 99-89 in Game\u00a02, tie the First Round 1-1",
      body: "",
      tag: "final:1042600122",
    },
  ]);
});

test("a final's news counts the game itself, even while the bracket hasn't caught up", () => {
  const moment = JSON.parse(
    readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-atlanta-final.json`, "utf8"),
  );
  const now = Date.parse(moment.now);
  const after = buildSnapshot(
    { ...AFTERNOON.responses, ...moment.responses },
    { season: 2026, now },
  );

  const [news] = listNotifications({ before: SNAPSHOT, after, now });

  assert.deepEqual(news, {
    title: "Dream beat the Mystics 93-75 to win the First Round 2-0",
    body: "",
    tag: "final:1042600132",
  });
});

test("games already finished, or found finished long after, aren't news", () => {
  const after = finishTonight(SNAPSHOT, [84, 79]);
  assert.deepEqual(listNotifications({ before: after, after, now: NOW }), []);
  assert.deepEqual(
    listNotifications({ before: null, after, now: Date.parse("2026-10-02T12:00:00Z") }),
    [],
  );
});

test("a season opens on its first preseason game's day, from the league's whole schedule, and has no opening day without one", () => {
  assert.equal(WHOLE_SEASON.openingDay, "2026-04-25");
  const unlisted = buildSnapshot({ ...RESPONSES, schedule: null }, { season: 2026, now: NOW });
  assert.equal(unlisted.openingDay, null);
});

test("the new year's season is followed from its opening day, or once its standings have games played, and the last one's until then, though the schedule lists the new one's games", async () => {
  const unplayed = SNAPSHOT.standings.map((row) => ({ ...row, wins: 0, losses: 0 }));
  const seasons = {
    2026: SNAPSHOT,
    2027: { ...WHOLE_SEASON, season: 2027, openingDay: "2027-04-24", standings: unplayed },
  };
  const loadSnapshot = async (season) => seasons[season];
  const followAt = async (/** @type {string} */ time) =>
    (await loadCurrentSnapshot(loadSnapshot, Date.parse(time))).season;

  // Half past midnight on New Year's Day, Eastern.
  assert.equal(await followAt("2027-01-01T05:30:00Z"), 2026);
  // The evening before the opening day, Eastern.
  assert.equal(await followAt("2027-04-24T03:00:00Z"), 2026);
  // Its first minutes, Eastern.
  assert.equal(await followAt("2027-04-24T04:30:00Z"), 2027);

  seasons[2027] = { ...seasons[2027], openingDay: null, standings: SNAPSHOT.standings };
  assert.equal(await followAt("2027-01-01T05:30:00Z"), 2027);
});
