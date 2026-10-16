import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NETWORKS_REQUEST, REQUESTS } from "../page/js/snapshot.js";
import { TEAMS } from "../page/js/teams.js";
import { nameScoreboardRequest, nameSummaryRequest } from "../worker/src/lead.js";
import { describePreview } from "../worker/src/preview.js";
import { createSnapshotServer } from "../worker/src/snapshot.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The afternoon's recording has no players' averages, so the next day's stand in for them.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const RESPONSES = { ...AFTERNOON.responses, players: GAMES.preview.players };
// ESPN's answers the next afternoon, with both games of Sep 30 finished.
const ESPN = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-core.json`, "utf8"),
);

// Where ESPN says the afternoon's games, and the day before's, were on.
const ESPN_SCOREBOARD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-02-espn-scoreboard.json`, "utf8"),
);

const FEEDS = {
  [REQUESTS.scoreboard]: "scoreboard",
  [REQUESTS.schedule]: "schedule",
  [REQUESTS.bracket(2026)]: "bracket",
  [REQUESTS.standings(2026)]: "standings",
  [REQUESTS.players(2026)]: "players",
  [REQUESTS.bracket(2025)]: "bracket",
  [REQUESTS.standings(2025)]: "standings",
  [REQUESTS.players(2025)]: "players",
};

const NETWORKS_PATH = new URL(NETWORKS_REQUEST("")).pathname;
const isNetworksRequest = (url) => new URL(url).pathname === NETWORKS_PATH;

/**
 * Answers the league's feeds from the fixture, or from `answers` in its place, counting reads,
 * unless a feed is told to refuse. ESPN's scoreboard answers from the afternoon's recording
 * unless told to refuse as `networks`, and the rest of ESPN from `espn`, by URL, or not at all.
 * @param {{ refuse?: Record<string, "page" | "error">, answers?: Record<string, any>, espn?: Record<string, any> }} [options]
 */
function createLeague({ refuse = {}, answers = {}, espn = {} } = {}) {
  const reads = [];
  const fetchImpl = async (url, init) => {
    if (url in espn) {
      reads.push({ feed: "espn", headers: init.headers });
      return new Response(JSON.stringify(espn[url]));
    }
    if (isNetworksRequest(url)) {
      reads.push({ feed: "networks", url, headers: init.headers });
      return url in ESPN_SCOREBOARD.answers && !refuse.networks
        ? new Response(JSON.stringify(ESPN_SCOREBOARD.answers[url]))
        : new Response("", { status: 503 });
    }
    if (!FEEDS[url]) {
      reads.push({ feed: "espn", headers: init.headers });
      return url in espn
        ? new Response(JSON.stringify(espn[url]))
        : new Response("", { status: 404 });
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

test("a snapshot is reused only within the closing stretch's 5-second wait", async () => {
  const league = createLeague();
  let clock = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => clock });

  await server.loadSnapshot(2026);
  clock += 1000;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("scoreboard"), 1);
  clock = NOW + 5000;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("scoreboard"), 2);
});

test("the Worker reads every feed as the league's own site would", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  const leagueReads = league.reads.filter((read) => read.feed !== "networks");
  assert.deepEqual(leagueReads.map((read) => read.feed).sort(), [
    "bracket",
    "players",
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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const { meetings } = await server.loadSnapshot(2026);

  const pair = meetings.find((each) => each.teams.join() === "IND,LVA");
  assert.deepEqual(
    pair.meetings,
    describePreview(GAMES.preview.schedule, { season: 2026, away: "IND", home: "LVA" }).meetings,
  );
  assert.equal(pair.meetings.length, 3);
  const refused = createLeague({ refuse: { schedule: "error" } });
  const withoutSchedule = createSnapshotServer({ fetchImpl: refused.fetchImpl, now: () => NOW });
  assert.deepEqual((await withoutSchedule.loadSnapshot(2026)).meetings, []);
});

test("the scoreboard comes from Cloudflare's cache no more than 5 seconds old", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  await server.loadSnapshot(2026);

  const scoreboardRead = league.reads.find((read) => read.feed === "scoreboard");
  assert.ok(scoreboardRead.cacheSeconds <= 5);
});

test("a feed that answers with a web page counts as missing, and the rest still show", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
  assert.equal(snapshot.games.length, 28);
});

test("while the scoreboard doesn't answer, ESPN stands in for the games it has started", async () => {
  const league = createLeague({ refuse: { scoreboard: "page" }, espn: ESPN.answers });
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [["scoreboard"], "espn"]);
  const describe = (id) => {
    const game = snapshot.games.find((candidate) => candidate.id === id);
    return [game.state, game.status, game.period, game.away.score, game.home.score];
  };
  assert.deepEqual(describe("1042600132"), ["final", "Final", 4, 93, 75]);
  assert.deepEqual(describe("1042600112"), ["final", "Final/OT", 5, 100, 108]);
  assert.deepEqual(describe("1042600123"), ["pre", "9:00 pm ET", null, 0, 0]);
});

test("a game ESPN doesn't answer for doesn't keep its others from standing in", async () => {
  const espn = structuredClone(ESPN.answers);
  const dallasStatus = Object.keys(espn).find((url) => url.includes("401918020/status"));
  delete espn[dallasStatus];
  const league = createLeague({ refuse: { scoreboard: "page" }, espn });
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

  assert.equal(snapshot.standIn, "espn");
  const readState = (id) => snapshot.games.find((game) => game.id === id).state;
  assert.deepEqual([readState("1042600132"), readState("1042600112")], ["final", "pre"]);
});

test("ESPN doesn't stand in until one of its games has started", async () => {
  const espn = structuredClone(ESPN.answers);
  const listing = Object.keys(espn).find((url) => url.includes("/events?dates="));
  espn[listing].items = espn[listing].items.filter((item) => item.$ref.includes("401918022"));
  const league = createLeague({ refuse: { scoreboard: "page" }, espn });
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual([snapshot.missing, snapshot.standIn], [["scoreboard"], null]);
});

test("while the scoreboard answers, ESPN's game-by-game feeds aren't read", async () => {
  const league = createLeague({ espn: ESPN.answers });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.equal(league.countReads("espn"), 0);
  assert.equal(snapshot.standIn, null);
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
  const server = createSnapshotServer({
    fetchImpl: league.fetchImpl,
    now: () => Date.parse(ESPN.now),
  });

  const snapshot = await server.loadSnapshot(2026);

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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  now += 4 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("schedule"), 1);

  now += 60 * 1000;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("schedule"), 2);

  answers.schedule = RESPONSES.schedule;
  now += 5 * 60 * 1000;
  await server.loadSnapshot(2026);
  const espnReads = league.countReads("espn");
  now += 5 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual([league.countReads("schedule"), league.countReads("espn")], [3, espnReads]);
});

test("a feed that answers JSON without its data counts as missing", async () => {
  const league = createLeague({ answers: { scoreboard: { meta: { code: 200 } } } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

  assert.deepEqual(snapshot.missing, ["scoreboard"]);
});

const SLOW_FEEDS = ["schedule", "bracket", "standings", "players"];
const HOUR_MS = 60 * 60 * 1000;

test("the schedule, bracket, standings, and players' averages are read again only after a day", async () => {
  const league = createLeague();
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });

  await server.loadSnapshot(2026);
  now += 23 * HOUR_MS;
  await server.loadSnapshot(2026);
  assert.deepEqual(["scoreboard", ...SLOW_FEEDS].map(league.countReads), [2, 1, 1, 1, 1]);

  now += HOUR_MS;
  await server.loadSnapshot(2026);
  assert.deepEqual(["scoreboard", ...SLOW_FEEDS].map(league.countReads), [3, 2, 2, 2, 2]);
});

/** @param {{ reads: { feed: string, url?: string }[] }} league */
const listNetworksReads = (league) =>
  league.reads.filter((read) => read.feed === "networks").map((read) => read.url);

test("where each game is on comes from ESPN's scoreboard for each month with a playoff game", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  await server.loadSnapshot(2026);

  assert.deepEqual(listNetworksReads(league), [NETWORKS_REQUEST("202609")]);
});

test("a month that's over is read once more, and then keeps that answer", async () => {
  const league = createLeague();
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  now = Date.parse("2026-10-05T16:00:00Z");
  await server.loadSnapshot(2026);
  assert.deepEqual(listNetworksReads(league).slice(2), [
    NETWORKS_REQUEST("202609"),
    NETWORKS_REQUEST("202610"),
  ]);

  now += 6 * HOUR_MS;
  const snapshot = await server.loadSnapshot(2026);
  assert.deepEqual(listNetworksReads(league).slice(4), [NETWORKS_REQUEST("202610")]);
  assert.deepEqual(snapshot.games.find((game) => game.id === "1042600101").networks, ["ABC"]);
});

test("a month that's over and didn't answer keeps being read until it does", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  refuse.networks = "error";
  now = Date.parse("2026-10-05T16:00:00Z");
  await server.loadSnapshot(2026);
  delete refuse.networks;
  now += 6 * HOUR_MS;
  await server.loadSnapshot(2026);

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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  now += 11 * 1000;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 2);

  refuse.networks = "error";
  now += 6 * HOUR_MS;
  const snapshot = await server.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 4);
  assert.deepEqual(snapshot.games.find((game) => game.id === "1042600132").networks, ["ESPN"]);

  now += 11 * 1000;
  const later = await server.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 4, "a failed read waits too");
  assert.deepEqual(later.games.find((game) => game.id === "1042600132").networks, ["ESPN"]);

  now += 6 * HOUR_MS;
  await server.loadSnapshot(2026);
  assert.equal(league.countReads("networks"), 6);
});

test("without ESPN's scoreboard, the games still show, with nowhere to watch them", async () => {
  const league = createLeague({ refuse: { networks: "error" } });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  const snapshot = await server.loadSnapshot(2026);

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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  answers.scoreboard = finishFirstGame(AFTERNOON.responses.scoreboard);
  now += 11 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [2, 2, 2, 2]);

  now += 5 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [2, 2, 2, 2]);

  now += 5 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [3, 3, 3, 3]);

  now += 10 * 60 * 1000;
  await server.loadSnapshot(2026);
  assert.deepEqual(countSlowReads(league), [3, 3, 3, 3]);
});

test("a game seen live and then final ends when ESPN logged its last play, as each team's last game too, looked up once", async () => {
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
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  answers.scoreboard = finishFirstGame(AFTERNOON.responses.scoreboard);
  now += 11 * 1000;
  const snapshot = await server.loadSnapshot(2026);

  const ended = snapshot.games.find((game) => game.id === "1042600132");
  assert.equal(ended.end, "2026-10-01T01:11:27Z");
  const last = snapshot.nearestGames.find((game) => game.id === "1042600132");
  assert.equal(last.end, "2026-10-01T01:11:27Z");
  assert.equal(league.countReads("espn"), 2);
});

test("a scoreboard that misses a read doesn't look like a game ending once it's back", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const answers = { scoreboard: finishFirstGame(AFTERNOON.responses.scoreboard) };
  const league = createLeague({ refuse, answers });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  refuse.scoreboard = "error";
  now += 11 * 1000;
  await server.loadSnapshot(2026);
  delete refuse.scoreboard;
  now += 11 * 1000;
  await server.loadSnapshot(2026);

  assert.deepEqual(countSlowReads(league), [1, 1, 1, 1]);
});

test("each season's slow feeds are kept apart", async () => {
  const league = createLeague();
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  await server.loadSnapshot(2026);
  await server.loadSnapshot(2025);

  for (const feed of ["bracket", "standings", "players"]) assert.equal(league.countReads(feed), 2);
  assert.equal(league.countReads("schedule"), 1);
});

test("a slow feed that stops answering keeps its last good answer", async () => {
  /** @type {Record<string, "page" | "error">} */
  const refuse = {};
  const league = createLeague({ refuse });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });
  await server.loadSnapshot(2026);

  refuse.bracket = "error";
  now += 24 * HOUR_MS;
  const snapshot = await server.loadSnapshot(2026);
  assert.equal(league.countReads("bracket"), 2);

  assert.deepEqual(snapshot.missing, []);
  assert.equal(snapshot.series.find((series) => series.id === "1-0").winner, "NYL");
});

test("a slow feed that didn't answer waits five minutes before it's asked again", async () => {
  const refuse = /** @type {Record<string, "page" | "error">} */ ({ standings: "error" });
  const league = createLeague({ refuse });
  let now = NOW;
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => now });

  await server.loadSnapshot(2026);
  now += 11 * 1000;
  const waiting = await server.loadSnapshot(2026);
  assert.equal(league.countReads("standings"), 1);
  assert.deepEqual(waiting.missing, ["standings"]);
  assert.equal(league.countReads("scoreboard"), 2);

  delete refuse.standings;
  now += 5 * 60 * 1000;
  const answered = await server.loadSnapshot(2026);
  assert.equal(league.countReads("standings"), 2);
  assert.deepEqual(answered.missing, []);
});

test("a snapshot says why it couldn't be read when no feed answers", async () => {
  const league = createLeague({
    refuse: { scoreboard: "error", schedule: "error", bracket: "error", standings: "error" },
  });
  const server = createSnapshotServer({ fetchImpl: league.fetchImpl, now: () => NOW });

  await assert.rejects(server.loadSnapshot(2026), /None of the WNBA's feeds answered/);
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
  const release = { version: "1.0.0", commit: "abc1234", builtAt: "2026-10-01T00:00:00Z" };
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
