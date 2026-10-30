import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ESPN_DAY_REQUEST,
  listReminderGames,
  NETWORKS_REQUEST,
  REQUESTS,
} from "../worker/src/adapters/wnba.js";
import { findTeamCodeByEspnId, TEAMS } from "../page/js/teams.js";
import {
  createEspnGameReader,
  nameScoreboardRequest,
  nameSummaryRequest,
} from "../worker/src/adapters/lead.js";
import { describePreview } from "../worker/src/adapters/preview.js";
import { createDocs } from "../../../tests/job-context.js";
import {
  saveSnapshot,
  describeSnapshotStatus,
  listFeedFailures,
} from "../worker/src/season-updater.js";
import { NETWORKS_MS, createSnapshotLoader, describeFailures } from "../worker/src/snapshot.js";
import { ESPN, readAfternoonEspn, SEP_30 } from "./espn-fixtures.js";
import { nameFeedKey } from "../../../shared/worker/feed-keeper.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The next day's games, with the whole season's schedule.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const RESPONSES = AFTERNOON.responses;

// Where ESPN says the afternoon's games, and the day before's, were on.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-02-espn-scoreboard.json`, "utf8"),
);

const FEEDS = {
  [REQUESTS.scoreboard]: "scoreboard",
  [REQUESTS.schedule]: "schedule",
  [REQUESTS.bracket(2026)]: "bracket",
  [REQUESTS.standings(2026)]: "standings",
  [REQUESTS.bracket(2025)]: "bracket",
  [REQUESTS.standings(2025)]: "standings",
};

const isNetworksRequest = (url) =>
  url === NETWORKS_REQUEST(new URL(url).searchParams.get("dates") ?? "");

/**
 * Answers the league's feeds from the fixture, or from `answers` in its place, counting reads,
 * unless a feed is told to refuse. ESPN's month scoreboards answer from the afternoon's recording
 * unless told to refuse as `networks`, and the rest of ESPN from `espn`, by URL, or with a 404.
 * @param {{ refuse?: Record<string, "page" | "error">, answers?: Record<string, any>, espn?: Record<string, any> }} [options]
 */
function createLeague({ refuse = {}, answers = {}, espn = {} } = {}) {
  const reads = [];
  const fetchImpl = async (url, init) => {
    if (url in espn) {
      reads.push({ feed: "espn", url, headers: init.headers, cacheSeconds: init.cf?.cacheTtl });
      return new Response(JSON.stringify(espn[url]));
    }
    if (isNetworksRequest(url)) {
      reads.push({ feed: "networks", url, headers: init.headers });
      return url in ESPN_SCOREBOARD.answers && !refuse.networks
        ? new Response(JSON.stringify(ESPN_SCOREBOARD.answers[url]))
        : new Response("", { status: 503 });
    }
    if (!FEEDS[url]) {
      reads.push({ feed: "espn", url, headers: init.headers, cacheSeconds: init.cf?.cacheTtl });
      return new Response("", { status: 404 });
    }
    const feed = FEEDS[url];
    reads.push({ feed, headers: init.headers, cacheSeconds: init.cf?.cacheTtl });
    if (refuse[feed] === "page") return new Response("<!DOCTYPE html><html></html>");
    if (refuse[feed] === "error") return new Response("", { status: 503 });
    return new Response(JSON.stringify(answers[feed] ?? RESPONSES[feed]));
  };
  return {
    reads,
    fetchImpl,
    countReads: (feed) => reads.filter((read) => read.feed === feed).length,
  };
}

for (const isWarm of [false, true]) {
  test(`malformed ESPN listings cannot poison a ${isWarm ? "kept" : "cold"} month or freeze the season`, async () => {
    const espn = structuredClone(ESPN_SCOREBOARD.answers);
    const league = createLeague({ espn });
    let now = NOW;
    const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
    const first = isWarm ? await loader.loadSnapshot(2026) : null;
    if (isWarm) now += NETWORKS_MS + 1;
    for (const answer of Object.values(espn))
      for (const event of answer.events) {
        event.competitions[0].date = "unreadable-date";
        event.competitions[0].timeValid = true;
      }
    const snapshot = await loader.loadSnapshot(2026);
    assert.equal(snapshot.games.length, 28);
    assert.match(snapshot.failures.networks, /Invalid sports data at start/);
    if (first)
      assert.deepEqual(
        snapshot.games.map((game) => game.networks),
        first.games.map((game) => game.networks),
      );
    const reads = league.countReads("espn");
    now += 5000;
    const repeated = await loader.loadSnapshot(2026);
    assert.equal(repeated.games.length, 28);
    assert.equal(league.countReads("espn"), reads);
  });
}

test("an invalid ESPN backup period is a failed answer while the league season stays usable", async () => {
  const espn = structuredClone(ESPN.answers);
  for (const answer of Object.values(espn))
    for (const event of answer.events) event.competitions[0].status.period = "invalid";
  const league = createLeague({ refuse: { scoreboard: "error" }, espn });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });
  const snapshot = await loader.loadSnapshot(2026);
  assert.equal(snapshot.games.length, 28);
  assert.match(snapshot.failures.backup, /Invalid sports data at period/);
  assert.equal(league.countReads("espn"), 2);
});

test("ESPN listing reads ignore score periods while backup reads ignore channel names", async () => {
  const networks = structuredClone(ESPN_SCOREBOARD.answers);
  for (const answer of Object.values(networks))
    for (const event of answer.events)
      event.competitions[0].status = { type: { state: "in" }, period: "unused" };
  const listingLeague = createLeague({ espn: networks });
  const listed = await createSnapshotLoader({
    fetchImpl: listingLeague.fetchImpl,
    now: () => NOW,
  }).loadSnapshot(2026);
  assert.equal(listed.failures.networks, undefined);
  assert.ok(listed.games.some((game) => game.networks.length));
  const backup = structuredClone(ESPN.answers);
  for (const answer of Object.values(backup))
    for (const event of answer.events) event.competitions[0].broadcasts = [{ names: [42] }];
  const backupLeague = createLeague({ refuse: { scoreboard: "error" }, espn: backup });
  const scored = await createSnapshotLoader({
    fetchImpl: backupLeague.fetchImpl,
    now: () => Date.parse(ESPN.now),
  }).loadSnapshot(2026);
  assert.equal(scored.failures.backup, undefined);
  assert.ok(scored.scoreboardCover);
});

test("a snapshot is reused only within the closing stretch's 5-second wait", async () => {
  const league = createLeague();
  let clock = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => clock });

  await loader.loadSnapshot(2026);
  clock += 1000;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("scoreboard"), 1);
  clock = NOW + 5000;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("scoreboard"), 2);
});

test("the Worker reads every feed as the league's own site would", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  const leagueReads = league.reads.filter((read) => read.feed !== "networks");
  assert.deepEqual(leagueReads.map((read) => read.feed).sort(), [
    "bracket",
    "schedule",
    "scoreboard",
    "standings",
  ]);
  for (const { headers } of leagueReads) {
    assert.match(headers["user-agent"], /Chrome/);
    assert.equal(headers.referer, "https://www.wnba.com/");
    assert.equal(headers["sec-fetch-mode"], "cors");
    assert.equal(headers["accept-encoding"], "gzip");
  }
  assert.equal(snapshot.games.length, 28);
  assert.deepEqual(snapshot.missing, []);
});

test("the snapshot has each upcoming game's meetings from the schedule it read, and none without it", async () => {
  const league = createLeague({ answers: { schedule: GAMES.preview.schedule } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const { meetings } = await loader.loadSnapshot(2026);

  const pair = meetings.find((each) => each.teams.join() === "IND,LVA");
  assert.deepEqual(
    pair.meetings,
    describePreview(GAMES.preview.schedule, { season: 2026, away: "IND", home: "LVA" }).meetings,
  );
  assert.equal(pair.meetings.length, 3);
  const refused = createLeague({ refuse: { schedule: "error" } });
  const withoutSchedule = createSnapshotLoader({ fetchImpl: refused.fetchImpl, now: () => NOW });
  assert.deepEqual((await withoutSchedule.loadSnapshot(2026)).meetings, []);
});

test("the scoreboard comes from Cloudflare's cache no more than 5 seconds old", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  await loader.loadSnapshot(2026);

  const scoreboardRead = league.reads.find((read) => read.feed === "scoreboard");
  assert.ok(scoreboardRead.cacheSeconds <= 5);
});

test("a feed that answers with a web page counts as missing, and the rest still show", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
  assert.equal(snapshot.games.length, 28);
});

test("while the scoreboard doesn't answer, ESPN stands in for the games it has started", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" }, espn: ESPN.answers });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [["scoreboard"], "espn"]);
  const describe = (id) => {
    const game = snapshot.games.find((candidate) => candidate.id === id);
    return [game.state, game.status, game.period, game.away.score, game.home.score];
  };
  assert.deepEqual(describe("1042600132"), ["final", "Final", 4, 93, 75]);
  assert.deepEqual(describe("1042600112"), ["final", "Final/OT", 5, 100, 108]);
  assert.deepEqual(describe("1042600123"), ["pre", "9:00 pm ET", null, 0, 0]);
});

// What the store's status says of ESPN's backup, or null when it says nothing.
const readBackupReason = (snapshot) =>
  describeSnapshotStatus(snapshot)
    .reasons.split("; ")
    .find((reason) => reason.startsWith("backup: "))
    ?.slice("backup: ".length) ?? null;

const OCT_1 = ESPN_DAY_REQUEST("20261001");
const BACKUP_PATH = new URL(SEP_30).pathname;

/**
 * ESPN's answers with the named days' games left out.
 * @param {string[]} days
 */
function leaveOutGames(...days) {
  const espn = structuredClone(ESPN.answers);
  for (const day of days) espn[day].events = [];
  return espn;
}

test("ESPN's backup takes a score it sends as a number, and leaves a game it gives no score for to the league", async () => {
  const espn = structuredClone(ESPN.answers);
  const [numbered, unscored] = espn[SEP_30].events.map((event) => event.competitions[0]);
  for (const competitor of numbered.competitors) competitor.score = Number(competitor.score);
  unscored.competitors.find((competitor) => competitor.homeAway === "home").score = "--";
  const loadGames = async (answers) => {
    const league = createLeague({ refuse: { scoreboard: "page" }, espn: answers });
    const loader = createSnapshotLoader({
      fetchImpl: league.fetchImpl,
      now: () => Date.parse(ESPN.now),
    });
    return (await loader.loadSnapshot(2026)).games;
  };

  const [games, leagueGames] = await Promise.all([
    loadGames(espn),
    loadGames(leaveOutGames(SEP_30)),
  ]);

  const findGame = (list, id) => list.find((game) => game.id === id);
  const numberedGame = findGame(games, "1042600132");
  assert.deepEqual(
    [numberedGame.state, numberedGame.away.score, numberedGame.home.score],
    ["final", 93, 75],
  );
  assert.deepEqual(findGame(games, "1042600112"), findGame(leagueGames, "1042600112"));
});

/**
 * ESPN's answers with today's game as `changeToday` leaves it, and the same two teams' final the
 * night before, 23 hours ahead of it, at 10:00 pm ET.
 * @param {(espn: any) => void} changeToday
 */
function addNightBeforeFinal(changeToday) {
  const espn = structuredClone(ESPN.answers);
  const nightBefore = structuredClone(espn[OCT_1].events[0]);
  nightBefore.id = "401918999";
  const competition = nightBefore.competitions[0];
  competition.date = new Date(Date.parse(competition.date) - 23 * 60 * 60 * 1000).toISOString();
  competition.status = structuredClone(espn[SEP_30].events[0].competitions[0].status);
  const [first, second] = competition.competitors;
  [first.score, second.score] = ["81", "77"];
  changeToday(espn);
  espn[SEP_30].events.push(nightBefore);
  return espn;
}

/**
 * Today's game started and scored as `state` and `score` give it.
 * @param {string} state
 * @param {string} score
 */
const setToday = (state, score) => (espn) => {
  const competition = espn[OCT_1].events[0].competitions[0];
  competition.status.type.state = state;
  for (const competitor of competition.competitors) competitor.score = score;
};

for (const today of [
  { name: "hasn't started", change: setToday("pre", "0") },
  { name: "gives no score for", change: setToday("in", "--") },
  {
    name: "leaves out",
    change: (espn) => {
      espn[OCT_1].events = [];
    },
  },
]) {
  test(`a game ESPN ${today.name} keeps the league's own word on it, not the same teams' final the night before`, async () => {
    const league = createLeague({
      refuse: { scoreboard: "page" },
      espn: addNightBeforeFinal(today.change),
    });
    const loader = createSnapshotLoader({
      fetchImpl: league.fetchImpl,
      now: () => Date.parse(ESPN.now),
    });

    const snapshot = await loader.loadSnapshot(2026);

    const game = snapshot.games.find((candidate) => candidate.id === "1042600123");
    assert.deepEqual([game.state, game.away.score, game.home.score], ["pre", 0, 0]);
  });
}

test("while the scoreboard doesn't answer, ESPN covers nothing with a started game it gives no score for, and the status says so", async () => {
  const espn = leaveOutGames(SEP_30);
  const competition = espn[OCT_1].events[0].competitions[0];
  competition.status.type.state = "in";
  for (const competitor of competition.competitors) competitor.score = "--";
  const league = createLeague({ refuse: { scoreboard: "page" }, espn });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual([snapshot.standIn, snapshot.scoreboardCover], [null, null]);
  assert.equal(
    readBackupReason(snapshot),
    "ESPN gave a score for none of the league's games on 20260930 or 20261001, of 1 in all",
  );
});

test("ESPN's backup reads only its site scoreboard of yesterday and today, which answers a Worker, not its core API, which turns one away", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" }, espn: ESPN.answers });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  await loader.loadSnapshot(2026);

  const espnReads = league.reads.filter((read) => read.feed === "espn").map((read) => read.url);
  assert.deepEqual(espnReads.sort(), [SEP_30, OCT_1]);
});

test("the backup and the game sheet keep a day's ESPN scoreboard at the edge as long as the league's scoreboard, so the backup never reads older scores than those it stands in for", async () => {
  const [game] = ESPN.answers[OCT_1].events;
  const league = createLeague({
    refuse: { scoreboard: "page" },
    espn: { ...ESPN.answers, [nameSummaryRequest(game.id)]: {} },
  });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });
  await loader.loadSnapshot(2026);
  const [home, away] = ["home", "away"].map((place) =>
    findTeamCodeByEspnId(
      game.competitions[0].competitors.find((competitor) => competitor.homeAway === place).id,
    ),
  );

  await createEspnGameReader({ fetchImpl: league.fetchImpl }).fetchSummary(
    {
      away,
      home,
      start: game.date,
    },
    async () => null,
  );

  const cacheTimes = league.reads
    .filter((read) => read.url === OCT_1)
    .map((read) => read.cacheSeconds);
  const scoreboardRead = league.reads.find((read) => read.feed === "scoreboard");
  assert.deepEqual(cacheTimes, [scoreboardRead.cacheSeconds, scoreboardRead.cacheSeconds]);
});

test("a day ESPN doesn't answer for doesn't keep the other's games from standing in", async () => {
  const espn = structuredClone(ESPN.answers);
  delete espn[OCT_1];
  const league = createLeague({ refuse: { scoreboard: "page" }, espn });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.equal(snapshot.standIn, "espn");
  const readState = (id) => snapshot.games.find((game) => game.id === id).state;
  assert.deepEqual([readState("1042600132"), readState("1042600112")], ["final", "final"]);
  assert.equal(
    readBackupReason(snapshot),
    `ESPN didn't answer for 20261001: ESPN answered 404 for ${BACKUP_PATH}`,
  );
});

test("while the scoreboard doesn't answer, ESPN covers it before any of its games has started, and its scores stand in for none", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" }, espn: leaveOutGames(SEP_30) });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(
    [snapshot.missing, snapshot.standIn, snapshot.scoreboardCover],
    [["scoreboard"], null, "espn"],
  );
  assert.equal(describeSnapshotStatus(snapshot).standIn, "espn");
  assert.equal(snapshot.games.find((game) => game.id === "1042600132").state, "pre");
  assert.equal(readBackupReason(snapshot), null);
});

test("while the scoreboard doesn't answer, ESPN's days without the league's games cover nothing, and the status says so", async () => {
  const league = createLeague({
    refuse: { scoreboard: "page" },
    espn: leaveOutGames(SEP_30, OCT_1),
  });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual([snapshot.standIn, snapshot.scoreboardCover], [null, null]);
  assert.equal(
    readBackupReason(snapshot),
    "ESPN gave a score for none of the league's games on 20260930 or 20261001, of 0 in all",
  );
});

test("while the scoreboard doesn't answer and no score is due, ESPN's days without the league's games give no backup reason", async () => {
  const { schedule } = readNextMorning();
  const games = schedule.leagueSchedule.gameDates.flatMap((day) => day.games);
  Object.assign(
    games.find((game) => game.gameId === "1042600112"),
    {
      gameStatus: 3,
      gameStatusText: "Final/OT",
    },
  );
  const league = createLeague({
    refuse: { scoreboard: "page" },
    answers: { schedule },
    espn: leaveOutGames(SEP_30, OCT_1),
  });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.hasScoreDue], [["scoreboard"], false]);
  assert.equal(readBackupReason(snapshot), null);
});

test("while the scoreboard answers, ESPN's days without a game the schedule holds as under way give no backup reason", async () => {
  const league = createLeague({ answers: readNextMorning(), espn: leaveOutGames(SEP_30, OCT_1) });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [[], null]);
  assert.equal(readBackupReason(snapshot), null);
});

test("while neither the scoreboard nor ESPN answers, nothing covers it", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" } });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(
    [snapshot.missing, snapshot.standIn, snapshot.scoreboardCover],
    [["scoreboard"], null, null],
  );
  assert.equal(describeSnapshotStatus(snapshot).standIn, "");
  assert.equal(readBackupReason(snapshot), `ESPN answered 404 for ${BACKUP_PATH}`);
});

test("while the scoreboard answers, ESPN's scores aren't read", async () => {
  const league = createLeague({ espn: ESPN.answers });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.equal(league.countReads("espn"), 0);
  assert.equal(snapshot.standIn, null);
});

const MINUTE_MS = 60 * 1000;

// ESPN's scoreboard of every day around the afternoon's, with no games, which a probe reads.
const ESPN_EMPTY_DAYS = Object.fromEntries(
  ["20260929", "20260930", "20261001"].map((day) => [ESPN_DAY_REQUEST(day), { events: [] }]),
);

test("while the scoreboard answers, ESPN's backup is read once an hour, two days a read, and nothing more", async () => {
  const league = createLeague({ espn: ESPN_EMPTY_DAYS });
  let clock = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => clock });

  const espnReadsByLoad = [];
  for (let minutes = 0; minutes <= 180; minutes += 5) {
    clock = NOW + minutes * MINUTE_MS;
    const before = league.countReads("espn");
    const snapshot = await loader.loadSnapshot(2026);
    assert.equal(readBackupReason(snapshot), null);
    if (league.countReads("espn") > before)
      espnReadsByLoad.push([minutes, league.countReads("espn") - before]);
  }

  assert.deepEqual(espnReadsByLoad, [
    [60, 2],
    [120, 2],
    [180, 2],
  ]);
  const urls = league.reads.filter((read) => read.feed === "espn").map((read) => read.url);
  assert.ok(urls.every((url) => url in ESPN_EMPTY_DAYS));
});

test("while the scoreboard answers, a probe of ESPN's backup that fails says why until a read a few minutes later answers", async () => {
  const espn = {};
  const league = createLeague({ espn });
  let clock = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => clock });
  const loadAt = async (minutes) => {
    clock = NOW + minutes * MINUTE_MS;
    const snapshot = await loader.loadSnapshot(2026);
    return [league.countReads("espn"), readBackupReason(snapshot)];
  };
  assert.deepEqual(await loadAt(0), [0, null]);
  const reason = `ESPN answered 404 for ${BACKUP_PATH}`;
  assert.deepEqual(await loadAt(60), [2, reason]);
  assert.deepEqual(await loadAt(62), [2, reason]);
  Object.assign(espn, ESPN_EMPTY_DAYS);
  assert.deepEqual(await loadAt(65), [4, null]);
  assert.deepEqual(await loadAt(70), [4, null]);
});

test("a backup that failed while it was needed says why after the scoreboard is back, until a read a few minutes later answers", async () => {
  const espn = {};
  /** @type {Record<string, "page" | "error">} */
  const refuse = { scoreboard: "error" };
  const league = createLeague({ refuse, espn });
  let clock = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => clock });
  const loadAt = async (minutes) => {
    clock = NOW + minutes * MINUTE_MS;
    const snapshot = await loader.loadSnapshot(2026);
    return [league.countReads("espn"), readBackupReason(snapshot)];
  };
  const reason = `ESPN answered 404 for ${BACKUP_PATH}`;
  assert.deepEqual(await loadAt(0), [2, reason]);
  delete refuse.scoreboard;
  assert.deepEqual(await loadAt(1), [2, reason]);
  Object.assign(espn, ESPN_EMPTY_DAYS);
  assert.deepEqual(await loadAt(4), [2, reason]);
  assert.deepEqual(await loadAt(5), [4, null]);
});

test("a feed's failure counts as one to look into, but the scoreboard's only while a score is due", () => {
  const failures = { scoreboard: "The scoreboard answered 503", backup: "ESPN answered 404" };
  assert.deepEqual(listFeedFailures({ failures, hasScoreDue: true }), failures);
  assert.deepEqual(listFeedFailures({ failures, hasScoreDue: false }), {
    backup: "ESPN answered 404",
  });
  assert.deepEqual(listFeedFailures({ hasScoreDue: true }), {});
});

// The next morning: the scoreboard has moved on to the new day, and the schedule still holds the
// night's last game, which ended in overtime, as under way, as the league's schedule can for hours.
function readNextMorning() {
  const schedule = structuredClone(AFTERNOON.responses.schedule);
  const games = schedule.leagueSchedule.gameDates.flatMap((day) => day.games);
  const findGame = (id) => games.find((game) => game.gameId === id);
  Object.assign(findGame("1042600132"), { gameStatus: 3, gameStatusText: "Final" });
  Object.assign(findGame("1042600112"), { gameStatus: 2, gameStatusText: "1st OT" });
  const scoreboard = structuredClone(AFTERNOON.responses.scoreboard);
  Object.assign(scoreboard.scoreboard, { gameDate: "2026-10-01", games: [] });
  return { schedule, scoreboard };
}

test("ESPN stands in for a game the schedule holds as under way once the scoreboard has moved on", async () => {
  const league = createLeague({ answers: readNextMorning(), espn: ESPN.answers });
  const loader = createSnapshotLoader({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await loader.loadSnapshot(2026);

  const game = snapshot.games.find((candidate) => candidate.id === "1042600112");
  assert.deepEqual(
    [game.state, game.status, game.period, game.away.score, game.home.score],
    ["final", "Final/OT", 5, 100, 108],
  );
  assert.deepEqual([snapshot.missing, snapshot.standIn], [[], "espn"]);
});

test("a schedule that holds a game as under way once the scoreboard has moved on is read again every five minutes until it catches up", async () => {
  const answers = readNextMorning();
  const league = createLeague({ answers, espn: ESPN.answers });
  let now = Date.parse(ESPN.now);
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  now += 4 * 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("schedule"), 1);

  now += 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("schedule"), 2);

  answers.schedule = RESPONSES.schedule;
  now += 5 * 60 * 1000;
  await loader.loadSnapshot(2026);
  const espnReads = league.countReads("espn");
  now += 5 * 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.deepEqual([league.countReads("schedule"), league.countReads("espn")], [3, espnReads]);
});

test("the store's status says why each feed that didn't answer failed", async () => {
  const league = createLeague({ refuse: { scoreboard: "error", standings: "page" } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const status = describeSnapshotStatus(await loader.loadSnapshot(2026));

  assert.equal(status.detail, "scoreboard, standings");
  const scoreboardPath = new URL(REQUESTS.scoreboard).pathname;
  const standingsPath = new URL(REQUESTS.standings(2026)).pathname;
  assert.equal(
    status.reasons,
    `scoreboard: The WNBA answered 503 for ${scoreboardPath}; standings: The WNBA answered ${standingsPath} with a web page rather than data; backup: ESPN answered 404 for ${BACKUP_PATH}`,
  );
});

test("the store's status gives no reasons while every feed answers", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const status = describeSnapshotStatus(await loader.loadSnapshot(2026));

  assert.deepEqual([status.error, status.reasons], ["", ""]);
});

test("the store's status gives a slow feed's same reason while it waits to be asked again, so it doesn't change with each update", async () => {
  const league = createLeague({ refuse: { standings: "error" } });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });

  const failed = describeSnapshotStatus(await loader.loadSnapshot(2026));
  now += 60 * 1000;
  const waiting = describeSnapshotStatus(await loader.loadSnapshot(2026));

  assert.equal(league.countReads("standings"), 1);
  assert.match(failed.reasons, /^standings: The WNBA answered 503 for \//);
  assert.deepEqual(waiting, failed);
});

test("the reasons name the feeds in one order, whichever failed first, with ESPN's backup last", () => {
  assert.equal(
    describeFailures({
      backup: "ESPN answered 403",
      standings: "The WNBA answered 503",
      scoreboard: "The WNBA answered 403",
    }),
    "scoreboard: The WNBA answered 403; standings: The WNBA answered 503; backup: ESPN answered 403",
  );
});

test("a feed that answers JSON without its data counts as missing", async () => {
  const league = createLeague({ answers: { scoreboard: { meta: { code: 200 } } } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
});

const SLOW_FEEDS = ["schedule", "bracket", "standings"];
const HOUR_MS = 60 * 60 * 1000;

test("the schedule, bracket, and standings are read again only after a day", async () => {
  const league = createLeague();
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });

  await loader.loadSnapshot(2026);
  now += 23 * HOUR_MS;
  await loader.loadSnapshot(2026);
  assert.deepEqual(["scoreboard", ...SLOW_FEEDS].map(league.countReads), [2, 1, 1, 1]);

  now += HOUR_MS;
  await loader.loadSnapshot(2026);
  assert.deepEqual(["scoreboard", ...SLOW_FEEDS].map(league.countReads), [3, 2, 2, 2]);
});

/** @param {{ reads: { feed: string, url?: string }[] }} league */
const listNetworksReads = (league) =>
  league.reads.filter((read) => read.feed === "networks").map((read) => read.url);

test("where each game is on comes from ESPN's scoreboard for each month with a playoff game", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(listNetworksReads(league), [
    NETWORKS_REQUEST("202609"),
    NETWORKS_REQUEST("202610"),
  ]);
  const readNetworks = (id) => snapshot.games.find((game) => game.id === id)?.networks;
  assert.deepEqual(readNetworks("1042600101"), ["ABC"]);
  assert.deepEqual(readNetworks("1042600132"), ["ESPN"]);
  assert.deepEqual(readNetworks("1042600123"), ["USA Net", "CNBC"]);
});

test("without the league's schedule, ESPN's scoreboard is read for this month alone", async () => {
  const league = createLeague({ refuse: { schedule: "error" } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  await loader.loadSnapshot(2026);

  assert.deepEqual(listNetworksReads(league), [NETWORKS_REQUEST("202609")]);
});

test("a month that's over is read once more, and then keeps that answer", async () => {
  const league = createLeague();
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  now = Date.parse("2026-10-05T16:00:00Z");
  await loader.loadSnapshot(2026);
  assert.deepEqual(listNetworksReads(league).slice(2), [
    NETWORKS_REQUEST("202609"),
    NETWORKS_REQUEST("202610"),
  ]);

  now += 6 * HOUR_MS;
  const snapshot = await loader.loadSnapshot(2026);
  assert.deepEqual(listNetworksReads(league).slice(4), [NETWORKS_REQUEST("202610")]);
  assert.deepEqual(snapshot.games.find((game) => game.id === "1042600101").networks, ["ABC"]);
});

test("a month that's over and didn't answer keeps being read until it does", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  refuse.networks = "error";
  now = Date.parse("2026-10-05T16:00:00Z");
  await loader.loadSnapshot(2026);
  delete refuse.networks;
  now += 6 * HOUR_MS;
  await loader.loadSnapshot(2026);

  assert.deepEqual(listNetworksReads(league).slice(4), [
    NETWORKS_REQUEST("202609"),
    NETWORKS_REQUEST("202610"),
  ]);
});

test("ESPN's scoreboard is read again only after 6 hours, even after a failed read, and kept when it stops answering", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  now += 11 * 1000;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 2);

  refuse.networks = "error";
  now += 6 * HOUR_MS;
  const snapshot = await loader.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 4);
  assert.deepEqual(snapshot.games.find((game) => game.id === "1042600132").networks, ["ESPN"]);

  now += 11 * 1000;
  const later = await loader.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 4, "a failed read waits too");
  assert.deepEqual(later.games.find((game) => game.id === "1042600132").networks, ["ESPN"]);

  now += 6 * HOUR_MS;
  await loader.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 6);
});

test("without ESPN's scoreboard, the games still show, with nowhere to watch them", async () => {
  const league = createLeague({ refuse: { networks: "error" } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.equal(snapshot.games.length, 28);
  assert.deepEqual(snapshot.missing, []);
  assert.ok(snapshot.games.every((game) => !game.networks.length));
});

// Today's scoreboard with its first game finished.
function finishFirstGame(scoreboard) {
  const finished = structuredClone(scoreboard);
  Object.assign(finished.scoreboard.games[0], { gameStatus: 3, gameStatusText: "Final" });
  return finished;
}

const countSlowReads = (league) => SLOW_FEEDS.map(league.countReads);

test("a game that ends has the slow feeds read again at once, and once more ten minutes on", async () => {
  const answers = {};
  const league = createLeague({ answers });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  answers.scoreboard = finishFirstGame(AFTERNOON.responses.scoreboard);
  now += 11 * 1000;
  await loader.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [2, 2, 2]);

  now += 5 * 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [2, 2, 2]);

  now += 5 * 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [3, 3, 3]);

  now += 10 * 60 * 1000;
  await loader.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [3, 3, 3]);
});

for (const isKept of [false, true]) {
  test(`a game ending reuses a ${isKept ? "persisted" : "new"} ESPN match`, async () => {
    const live = structuredClone(AFTERNOON.responses.scoreboard);
    Object.assign(live.scoreboard.games[0], { gameStatus: 2, gameStatusText: "Q4 0:30" });
    const start = live.scoreboard.games[0].gameTimeUTC;
    const competitors = [
      { homeAway: "away", team: { id: String(TEAMS.ATL.espnId) } },
      { homeAway: "home", team: { id: String(TEAMS.WAS.espnId) } },
    ];
    const espn = {
      [nameScoreboardRequest(start)]: { events: [{ id: "401", competitions: [{ competitors }] }] },
      [nameSummaryRequest("401")]: {
        plays: [{ type: { text: "End Game" }, wallclock: "2026-10-01T01:11:27Z" }],
      },
    };
    const answers = { scoreboard: live };
    const league = createLeague({ answers, espn });
    let now = NOW;
    const loader = createSnapshotLoader({
      fetchImpl: league.fetchImpl,
      now: () => now,
      readDoc: async (key) =>
        isKept && key === "espnMatches/1042600132"
          ? { away: "ATL", home: "WAS", eventId: "401" }
          : null,
    });
    await loader.loadSnapshot(2026);

    answers.scoreboard = finishFirstGame(AFTERNOON.responses.scoreboard);
    now += 11 * 1000;
    const snapshot = await loader.loadSnapshot(2026);

    const ended = snapshot.games.find((game) => game.id === "1042600132");
    assert.equal(ended.end, "2026-10-01T01:11:27Z");
    const last = snapshot.nearestGames.find((game) => game.id === "1042600132");
    assert.equal(last.end, "2026-10-01T01:11:27Z");
    assert.equal(league.countReads("espn"), isKept ? 1 : 2);
  });
}

test("a scoreboard that misses a read doesn't look like a game ending once it's back", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const answers = { scoreboard: finishFirstGame(AFTERNOON.responses.scoreboard) };
  const league = createLeague({ refuse, answers });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  refuse.scoreboard = "error";
  now += 11 * 1000;
  await loader.loadSnapshot(2026);
  delete refuse.scoreboard;
  now += 11 * 1000;
  await loader.loadSnapshot(2026);

  assert.deepEqual(countSlowReads(league), [1, 1, 1]);
});

test("each season's slow feeds are kept apart", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  await loader.loadSnapshot(2026);
  await loader.loadSnapshot(2025);

  for (const feed of ["bracket", "standings"]) assert.equal(league.countReads(feed), 2);
  assert.equal(league.countReads("schedule"), 1);
});

// The players' averages a game, as the snapshot once read them for each season.
const AVERAGES_REQUEST =
  "https://stats.wnba.com/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=10&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=2026&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight=";

test("the players' averages the snapshot once read are forgotten from the slow feeds' storage, once a season", async () => {
  const league = createLeague();
  let clock = NOW;
  const values = new Map();
  const deleted = [];
  const storage = {
    get: async (key) => values.get(key),
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      deleted.push(key);
      return values.delete(key);
    },
  };
  const averagesKey = await nameFeedKey("players", AVERAGES_REQUEST);
  values.set(averagesKey, { answer: { at: NOW - 1000, data: RESPONSES.standings } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => clock, storage });

  await loader.loadSnapshot(2026);
  clock += 5000;
  await loader.loadSnapshot(2026);

  assert.equal(values.has(averagesKey), false);
  assert.equal(deleted.filter((key) => key === averagesKey).length, 1);
  assert.ok(values.size > 0);
});

test("a slow feed that stops answering keeps its last good answer", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  refuse.bracket = "error";
  now += 24 * HOUR_MS;
  const snapshot = await loader.loadSnapshot(2026);
  assert.equal(league.countReads("bracket"), 2);

  assert.deepEqual(snapshot.missing, []);
  assert.equal(snapshot.series.find((series) => series.id === "1-0").winner, "NYL");
});

test("a slow feed that answered and then fails is named with why, while its kept answer stands in", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  refuse.bracket = "error";
  now += 24 * HOUR_MS;
  const failed = await loader.loadSnapshot(2026);
  now += MINUTE_MS;
  const waiting = await loader.loadSnapshot(2026);

  const reason = `The WNBA answered 503 for ${new URL(REQUESTS.bracket(2026)).pathname}`;
  assert.deepEqual([failed.failures.bracket, waiting.failures.bracket], [reason, reason]);
  assert.equal(league.countReads("bracket"), 2);
  assert.deepEqual(failed.missing, []);
});

test("a slow feed that didn't answer waits five minutes before it's asked again", async () => {
  const refuse = /** @type {Record<string, "page" | "error">} */ ({ standings: "error" });
  const league = createLeague({ refuse });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });

  await loader.loadSnapshot(2026);
  now += 11 * 1000;
  const waiting = await loader.loadSnapshot(2026);
  assert.equal(league.countReads("standings"), 1);
  assert.deepEqual(waiting.missing, ["standings"]);
  assert.equal(league.countReads("scoreboard"), 2);

  delete refuse.standings;
  now += 5 * 60 * 1000;
  const answered = await loader.loadSnapshot(2026);
  assert.equal(league.countReads("standings"), 2);
  assert.deepEqual(answered.missing, []);
});

test("a snapshot says why it couldn't be read when no feed answers, without reading ESPN", async () => {
  const league = createLeague({
    refuse: { scoreboard: "error", schedule: "error", bracket: "error", standings: "error" },
  });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });

  await assert.rejects(
    loader.loadSnapshot(2026),
    /^Error: None of the WNBA's feeds answered with data: scoreboard: The WNBA answered 503 for \/[^;]+; schedule: The WNBA answered 503 for \/[^;]+; bracket: [^;]+; standings: [^;]+$/,
  );
  assert.equal(league.countReads("espn"), 0);
});

test("the Worker bundles with its page, and exports its store", async () => {
  const { buildWorker } = await import("../../../worker/build.mjs");
  const bundle = await import(
    `data:text/javascript,${encodeURIComponent(await buildWorker("wnba", { release: null }))}`
  );
  assert.equal(typeof bundle.SeasonStore, "function");
  const page = await bundle.default.fetch(new Request("https://app.example/k3y/"), {
    APP_KEY: "k3y",
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>WNBA<\/title>/);
});

test("the page serves both themes' icons and System's", async () => {
  const { listBundledFiles } = await import("../../../worker/build.mjs");
  const release = {
    version: "1.0.0",
    commit: "abc1234",
    builtAt: "2026-10-01T00:00:00Z",
    label: null,
  };
  const served = Object.keys(listBundledFiles("wnba", release));
  for (const icon of [
    "icon-180.png",
    "icon-light-180.png",
    "icon-system-180.png",
    "icon.svg",
    "icon-light.svg",
  ])
    assert.ok(served.includes(icon), icon);
});

test("each theme's icon draws its ball and its panels in that theme's colors", () => {
  const icons = {
    "icon-light.svg": { ball: "#ea6536", panels: "#f0f1e8" },
    "icon.svg": { ball: "#e35e31", panels: "#e5e7de" },
  };
  for (const [file, { ball, panels }] of Object.entries(icons)) {
    const svg = readFileSync(`${import.meta.dirname}/../page/${file}`, "utf8");
    assert.ok(svg.includes(`<circle cx="90" cy="90" r="58" fill="${ball}"/>`), file);
    assert.ok(svg.includes(`fill="${panels}" fill-rule="evenodd"`), file);
  }
});

test("reminder verification refreshes schedule, scoreboard and bracket without rereading standings", async () => {
  const league = createLeague();
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  const before = league.countReads("networks");
  await loader.loadSnapshot(2026, { verify: true });
  assert.equal(league.countReads("networks"), before + 2);
  assert.equal(league.countReads("schedule"), 2);
  assert.equal(league.countReads("scoreboard"), 2);
  assert.equal(league.countReads("bracket"), 2);
  assert.equal(league.countReads("standings"), 1);
});

test("a reminder verification takes the kept schedule and bracket when they fail, once the scoreboard lists today's games", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  refuse.bracket = "error";
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.equal(league.countReads("schedule"), 2);
  assert.equal(league.countReads("bracket"), 2);
  assert.deepEqual(verified.missing, []);
  assert.ok(verified.failures.schedule);
  assert.match(verified.failures.bracket, /The WNBA answered 503/);
  const answering = createSnapshotLoader({ fetchImpl: createLeague().fetchImpl, now: () => NOW });
  const expected = listReminderGames(await answering.loadSnapshot(2026, { verify: true }));
  assert.ok(expected?.length);
  assert.deepEqual(listReminderGames(verified), expected);
});

test("a reminder verification takes the kept schedule when it and the scoreboard fail, once ESPN answers for today's games", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse, espn: readAfternoonEspn() });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  refuse.scoreboard = "error";
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.equal(league.countReads("schedule"), 2);
  assert.deepEqual(verified.missing, ["scoreboard"]);
  const answering = createSnapshotLoader({ fetchImpl: createLeague().fetchImpl, now: () => NOW });
  const expected = listReminderGames(await answering.loadSnapshot(2026, { verify: true }));
  assert.ok(expected?.length);
  assert.deepEqual(listReminderGames(verified), expected);
});

test("a reminder verification confirms nothing when the scoreboard and ESPN both fail", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  refuse.scoreboard = "error";
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.ok(verified.failures.backup);
  assert.deepEqual(verified.missing, ["schedule", "scoreboard"]);
  assert.equal(listReminderGames(verified), null);
});

test("a reminder verification takes no kept schedule while ESPN, standing in for the scoreboard, leaves out one of today's games", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({
    refuse,
    espn: readAfternoonEspn((events) => events.slice(1)),
  });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  refuse.scoreboard = "error";
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.deepEqual(verified.missing, ["schedule", "scoreboard"]);
  assert.equal(listReminderGames(verified), null);
});

test("a reminder verification takes no kept schedule while the scoreboard leaves out one of today's games", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  /** @type {Record<string, any>} */
  const answers = {};
  const league = createLeague({ refuse, answers });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  const { scoreboard } = RESPONSES.scoreboard;
  answers.scoreboard = { scoreboard: { ...scoreboard, games: scoreboard.games.slice(0, 1) } };
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.ok(verified.missing.includes("schedule"));
  assert.ok(verified.failures.schedule);
  assert.equal(listReminderGames(verified), null);
});

test("a reminder verification keeps a schedule read now while the scoreboard leaves out one of today's games", async () => {
  /** @type {Record<string, any>} */
  const answers = {};
  const league = createLeague({ answers });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  const { scoreboard } = RESPONSES.scoreboard;
  answers.scoreboard = { scoreboard: { ...scoreboard, games: scoreboard.games.slice(0, 1) } };
  const verified = await loader.loadSnapshot(2026, { verify: true });
  assert.equal(verified.failures.schedule, undefined);
  assert.ok(!verified.missing.includes("schedule"));
  assert.notEqual(listReminderGames(verified), null);
});

test("an ordinary update keeps the kept schedule while it fails and the scoreboard leaves out one of today's games", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  /** @type {Record<string, any>} */
  const answers = {};
  const league = createLeague({ refuse, answers });
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  const first = await loader.loadSnapshot(2026);
  refuse.schedule = "page";
  const { scoreboard } = RESPONSES.scoreboard;
  answers.scoreboard = { scoreboard: { ...scoreboard, games: scoreboard.games.slice(0, 1) } };
  await loader.loadSnapshot(2026, { verify: true });
  now += 60_000;
  const updated = await loader.loadSnapshot(2026);
  assert.ok(updated.failures.schedule);
  assert.ok(!updated.missing.includes("schedule"));
  assert.ok(first.nearestGames.length);
  assert.deepEqual(
    updated.nearestGames.map((game) => game.id),
    first.nearestGames.map((game) => game.id),
  );
});

test("reminder verification refreshes open network months while reusing finalized months", async () => {
  const league = createLeague();
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);
  now = Date.parse("2026-10-05T16:00:00Z");
  await loader.loadSnapshot(2026);
  const before = listNetworksReads(league).length;
  await loader.loadSnapshot(2026, { verify: true });
  assert.deepEqual(listNetworksReads(league).slice(before), [NETWORKS_REQUEST("202610")]);
});

test("a malformed scoreboard is named before snapshot composition and leaves the schedule usable", async () => {
  const scoreboard = structuredClone(RESPONSES.scoreboard);
  scoreboard.scoreboard.games[0].homeTeam.score = "invalid";
  const league = createLeague({ answers: { scoreboard } });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  const snapshot = await loader.loadSnapshot(2026);
  assert.match(snapshot.failures.scoreboard, /Invalid sports data at 0.home.score/);
  assert.equal(snapshot.games.length, 28);
});

test("the snapshot loader supplies persisted ESPN matches from recorded network answers", async () => {
  const league = createLeague({ espn: readAfternoonEspn() });
  const loader = createSnapshotLoader({ fetchImpl: league.fetchImpl, now: () => NOW });
  const snapshot = await loader.loadSnapshot(2026);
  assert.ok(snapshot.espnMatches.length > 0);
  const docs = createDocs();
  await saveSnapshot(docs, snapshot);
  for (const match of snapshot.espnMatches) {
    assert.deepEqual(await docs.read(`espnMatches/${match.id}`), match);
    assert.ok(snapshot.games.concat(snapshot.nearestGames).some((game) => game.id === match.id));
  }
});
