import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import wnbaWorker, { SeasonStore as WnbaStore } from "../apps/wnba/worker/src/index.js";
import mlbWorker, { SeasonStore as MlbStore } from "../apps/mlb/worker/src/index.js";
import { describeBoxScore as describeBasketball } from "../apps/wnba/worker/src/adapters/box-score.js";
import { describeBoxScore as describeBaseball } from "../apps/mlb/worker/src/adapters/box-score.js";
import { createWnbaGameDetailsJob } from "../apps/wnba/worker/src/game-details-updater.js";
import { createMlbGameDetailsJob } from "../apps/mlb/worker/src/game-details-updater.js";
import { createDurableObjectContext } from "./durable-object-context.js";
import { listEspnMatches, nameSummaryRequest } from "../apps/wnba/worker/src/adapters/lead.js";
import { buildSnapshot } from "../apps/wnba/worker/src/adapters/wnba.js";
import { createHighlightsUpdater } from "../apps/mlb/worker/src/highlights-updater.js";
import { DETAIL_REUSE_MS } from "../shared/worker/detail-reads.js";
import { UPSTREAM_TIMEOUT_MS } from "../shared/worker/upstream.js";
import { createRequestBudget, HISTORY_REQUESTS_PER_RUN } from "../shared/worker/request-budget.js";

const readFixture = (app, file) =>
  JSON.parse(
    readFileSync(new URL(`../apps/${app}/tests/fixtures/${file}`, import.meta.url), "utf8"),
  );
const BASKETBALL = readFixture("wnba", "2026-10-01-games.json").boxScores["1042600122"];
const BASEBALL = readFixture("mlb", "2026-10-07-games.json").feeds["849819"];
const NOW = Date.parse("2026-10-30T12:00:00Z");

test("native basketball box scores reject malformed team, player, shooting and game-state values", () => {
  for (const corrupt of [
    (feed) => {
      feed.game.homeTeam.score = "bad";
    },
    (feed) => {
      feed.game.period = -1;
    },
    (feed) => {
      feed.game.gameStatus = 999;
    },
    (feed) => {
      feed.game.homeTeam.players.find(
        (player) => player.played === "1",
      ).statistics.minutesCalculated = "invalid";
    },
    (feed) => {
      feed.game.homeTeam.statistics.fieldGoalsMade = 999;
    },
    (feed) => {
      feed.game.homeTeam.players.find((player) => player.played === "1").statistics.points = -1;
    },
  ]) {
    const feed = structuredClone(BASKETBALL);
    corrupt(feed);
    assert.throws(() => describeBasketball(feed), /Invalid sports data/);
  }
});

test("native baseball box scores reject malformed batting, pitching, innings, lineup and runs values", () => {
  const plays = readFixture("mlb", "2026-10-11-plays.json").feeds["849809"];
  for (const corrupt of [
    (feed) => {
      feed.liveData.linescore.innings[0].away.runs = "bad";
    },
    (feed) => {
      Object.values(feed.liveData.boxscore.teams.home.players).find(
        (player) => player.battingOrder,
      ).stats.batting.atBats = -1;
    },
    (feed) => {
      const team = feed.liveData.boxscore.teams.home;
      team.players[`ID${team.pitchers[0]}`].stats.pitching.inningsPitched = "1.9";
    },
    (feed) => {
      feed.liveData.linescore.outs = 4;
    },
    (feed) => {
      feed.liveData.plays.allPlays.find((play) => play.about.isScoringPlay).result.awayScore = -1;
    },
  ]) {
    const feed = structuredClone(plays);
    corrupt(feed);
    assert.throws(() => describeBaseball("849809", feed), /Invalid sports data/);
  }
  const lineup = readFixture("mlb", "2026-10-07-games.json").feeds["849838"];
  const team = lineup.liveData.boxscore.teams.home;
  team.players[`ID${team.batters[0]}`].seasonStats.batting.avg = "1.000";
  assert.equal(describeBaseball("849838", lineup).home.batters[0].average, "1.000");
  team.players[`ID${team.batters[0]}`].seasonStats.batting.avg = ".---";
  assert.equal(describeBaseball("849838", lineup).home.batters[0].average, null);
  team.players[`ID${team.batters[0]}`].seasonStats.batting.avg = "bad";
  assert.throws(() => describeBaseball("849838", lineup), /Invalid sports data/);
});
const LEAGUES = [
  {
    app: "wnba",
    worker: wnbaWorker,
    Store: WnbaStore,
    id: "1042600122",
    feed: BASKETBALL,
    query: "id=1042600122&away=LVA&home=IND&start=2026-09-29T22%3A30%3A00Z",
    describe: (feed) => describeBasketball(feed),
    corrupt: (feed) => {
      feed.game.homeTeam.statistics.fieldGoalsMade = -1;
    },
    createJob: createWnbaGameDetailsJob,
    game: {
      id: "1042600122",
      state: "final",
      start: "2026-09-29T22:30:00Z",
      away: { team: "LVA" },
      home: { team: "IND" },
    },
    season: { year: 2026, games: [], nearestGames: [] },
    endpoints: ["box-score", "highlights", "lead", "preview", "roster", "player"],
  },
  {
    app: "mlb",
    worker: mlbWorker,
    Store: MlbStore,
    id: "849819",
    feed: BASEBALL,
    query: "id=849819",
    describe: (feed) => describeBaseball("849819", feed),
    corrupt: (feed) => {
      feed.liveData.linescore.teams.home.runs = -1;
    },
    createJob: createMlbGameDetailsJob,
    game: { id: "849819", state: "final", start: "2026-10-07T22:00:00Z" },
    season: { year: 2026, slate: null },
    endpoints: ["box-score", "highlights", "pitcher", "rotation"],
  },
];

test("ingested ESPN matches survive a store restart and avoid another scoreboard lookup", async () => {
  const lead = readFixture("wnba", "2026-10-01-espn-lead.json");
  const afternoon = readFixture("wnba", "2026-09-30-afternoon.json");
  const game = {
    id: "1042600112",
    ...lead.game,
    away: { team: lead.game.away },
    home: { team: lead.game.home },
  };
  const scoreboard = {
    events: lead.scoreboard.events.map((event) => ({ ...event, date: lead.game.start })),
  };
  const matches = listEspnMatches({ games: [game], nearestGames: [game] }, [scoreboard]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].eventId, String(lead.eventId));
  const ambiguous = structuredClone(scoreboard);
  ambiguous.events.push({
    ...ambiguous.events.find((event) => String(event.id) === String(lead.eventId)),
    id: "other-event",
  });
  assert.deepEqual(listEspnMatches({ games: [game], nearestGames: [] }, [ambiguous]), []);
  const requests = [];
  const harness = createHarness(LEAGUES[0], async (url) => {
    requests.push(url);
    return url === nameSummaryRequest(lead.eventId)
      ? Response.json(lead.summary)
      : new Response(null, { status: 503 });
  });
  const snapshot = buildSnapshot(afternoon.responses, {
    season: 2026,
    now: Date.parse(afternoon.now),
  });
  await harness.getStore().saveSeason({ ...snapshot, espnMatches: matches });
  harness.restart();
  const params = new URLSearchParams({ id: game.id, ...lead.game });
  const response = await harness.request(`lead?${params}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isOver, true);
  assert.deepEqual(requests, [nameSummaryRequest(lead.eventId)]);
});

test("unfilled historical sheets return availability without vendor reads", async () => {
  let requests = 0;
  for (const league of LEAGUES) {
    const harness = createHarness(league, async () => {
      requests += 1;
      throw new Error("Unexpected request");
    });
    await harness.getStore().docs.write("live/current", { season: 2026 });
    const paths =
      league.app === "wnba"
        ? ["roster?team=NYL&season=2025", "player?id=1627668&team=NYL&season=2025"]
        : ["highlights?id=849819&season=2025"];
    for (const path of paths) {
      const response = await harness.request(path);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, "not_available_yet");
    }
  }
  assert.equal(requests, 0);
});

test("malformed WNBA native details use a valid ESPN stand-in, preserve a league final and recover", async () => {
  const league = LEAGUES[0];
  const espn = readFixture("wnba", "2026-10-29-espn-box-scores.json").games[league.id];
  let feed = structuredClone(league.feed);
  league.corrupt(feed);
  const harness = createHarness(league, async (url) => {
    if (url.includes("boxscore")) return Response.json(feed);
    if (url.includes("scoreboard")) return Response.json(espn.scoreboard);
    if (url.includes("summary")) return Response.json(espn.summary);
    return new Response(null, { status: 404 });
  });
  const store = harness.getStore();
  await store.docs.write("live/current", { season: 2026 });
  await store.docs.write("seasons/2026", { year: 2026, games: [league.game], nearestGames: [] });
  await store.refreshDetails(league.id, { games: [league.game], nearestGames: [] });
  assert.equal((await store.docs.read(`games/${league.id}`)).boxScore.source, "espn");
  const fillArchive = async () => {
    await store.createJobStorage("games").delete("final-reads:2026");
    await createWnbaGameDetailsJob().updateStore({
      docs: store.docs,
      storage: store.createJobStorage("games"),
      env: {},
      now: () => NOW,
      fetchImpl: store.fetchImpl,
      createLoadSnapshot: () => async () => null,
    });
  };
  const valid = describeBasketball(league.feed);
  await store.docs.write(`games/${league.id}`, { boxScore: valid, lead: null });
  await fillArchive();
  assert.deepEqual((await store.docs.read(`games/${league.id}`)).boxScore, valid);
  await store.docs.write(`games/${league.id}`, {
    boxScore: { ...valid, source: "espn" },
    lead: null,
  });
  feed = structuredClone(league.feed);
  await fillArchive();
  assert.deepEqual((await store.docs.read(`games/${league.id}`)).boxScore, valid);
});

test("MLB historical highlights fill newest season first in the remaining budget and never use paid still checks", async () => {
  const media = readFixture("mlb", "2026-10-07-highlights.json");
  const requests = [];
  const harness = createHarness(LEAGUES[1], async (url) => {
    requests.push(url);
    const id = /game\/(\d+)/.exec(url)?.[1];
    return Response.json(
      url.includes("/content")
        ? (media.content[id] ?? media.content["849826"])
        : (media.plays[id] ?? media.plays["849826"]),
    );
  });
  const store = harness.getStore();
  await store.docs.write("live/current", { season: 2026 });
  for (const year of [2024, 2025]) await store.docs.write(`seasons/${year}`, { year, slate: null });
  await store.docs.write("schedules-2025/10", {
    games: ["849826", "849838"].map((id) => ({
      id,
      state: "final",
      start: "2025-10-07T20:00:00Z",
    })),
  });
  await store.docs.write("schedules-2024/10", {
    games: [{ id: "111", state: "final", start: "2024-10-07T20:00:00Z" }],
  });
  const fillArchive = async (limit) => {
    const budget = createRequestBudget(store.fetchImpl, limit);
    await createHighlightsUpdater().updateHistory({
      docs: store.docs,
      storage: store.createJobStorage("highlights"),
      env: {},
      now: () => NOW,
      fetchImpl: budget.fetchImpl,
      remainingRequests: budget.remaining,
      createLoadSnapshot: () => async () => null,
    });
  };
  await fillArchive(0);
  assert.equal(requests.length, 0);
  await fillArchive(HISTORY_REQUESTS_PER_RUN);
  assert.equal(requests.length, 4);
  assert.ok(await store.docs.read("highlights/849826"));
  assert.ok(await store.docs.read("highlights/849838"));
  assert.equal(await store.docs.read("highlights/111"), null);
  await fillArchive(2);
  assert.equal(requests.length, 6);
  assert.ok(await store.docs.read("highlights/111"));
  assert.ok(requests.every((url) => url.startsWith("https://statsapi.mlb.com/")));
  await fillArchive(HISTORY_REQUESTS_PER_RUN);
  assert.equal(requests.length, 6);
  const before = requests.length;
  assert.equal((await harness.request("highlights?id=111&season=2024")).status, 200);
  assert.equal(requests.length, before);
});

function describeLiveFeed(league) {
  const feed = structuredClone(league.feed);
  if (league.app === "wnba") feed.game.gameStatus = 2;
  else
    feed.gameData.status = {
      abstractGameState: "Live",
      codedGameState: "I",
      detailedState: "In Progress",
    };
  return feed;
}

function createHarness(league, fetchImpl) {
  const context = createDurableObjectContext();
  let now = NOW;
  const options = { fetchImpl, now: () => now };
  let store = new league.Store(context.ctx, {}, options);
  const forwarded = [];
  const env = {
    APP_KEY: "k3y",
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch(request) {
          forwarded.push(new URL(request.url).pathname);
          return store.fetch(request);
        },
      }),
    },
  };
  return {
    context,
    forwarded,
    getStore: () => store,
    advance: () => {
      now += DETAIL_REUSE_MS + 1;
    },
    restart: () => {
      store = new league.Store(context.ctx, {}, options);
    },
    request: (path = `box-score?${league.query}`) =>
      league.worker.fetch(new Request(`https://app.example/k3y/${path}`), env),
  };
}

for (const league of LEAGUES) {
  test(`${league.app}: an unreachable store is retryable and never bypassed with vendor reads`, async (context) => {
    let requests = 0;
    context.mock.method(globalThis, "fetch", async () => {
      requests += 1;
      throw new Error("Unexpected vendor read");
    });
    const request = () => new Request(`https://app.example/k3y/box-score?${league.query}`);
    for (const env of [
      { APP_KEY: "k3y" },
      {
        APP_KEY: "k3y",
        STORE: {
          idFromName: (name) => name,
          get: () => ({
            fetch: async () => {
              throw new Error("Store unavailable");
            },
          }),
        },
      },
    ]) {
      const response = await league.worker.fetch(request(), env);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "store_unavailable");
    }
    assert.equal(requests, 0);
  });

  test(`${league.app}: concurrent store-gap reads update the local diagnostics counter`, async () => {
    let reads = 0;
    const harness = createHarness(league, async () => {
      reads += 1;
      return new Response(null, { status: 503 });
    });
    const store = harness.getStore();
    await store.docs.write("live/current", { season: 2026 });
    const paths =
      league.app === "wnba"
        ? ["player?id=1627668&team=NYL&season=2026", "player?id=1629477&team=NYL&season=2026"]
        : [
            "pitcher?id=1&season=2026",
            "pitcher?id=2&season=2026",
            "rotation?club=CLE&date=2026-10-30",
          ];
    const responses = await Promise.all(paths.map((path) => harness.request(path)));
    assert.ok(responses.every((response) => response.status === 502));
    assert.ok(reads > 0);
    const job = league.app === "wnba" ? "players" : "pitchers";
    assert.equal(await store.createJobStorage(job).get("count:leagueReads"), paths.length);
  });

  test(`${league.app}: every detail route reaches the store before validation or adapter work`, async () => {
    let reads = 0;
    const harness = createHarness(league, async () => {
      reads += 1;
      throw new Error("Unexpected vendor request");
    });
    for (const endpoint of league.endpoints) {
      assert.equal((await harness.request(endpoint)).status, 400);
      assert.equal(harness.forwarded.at(-1), `/${endpoint}`);
    }
    assert.equal(reads, 0);
  });

  test(`${league.app}: concurrent and repeated route reads share the store's adapter request, survive restart and recover`, async () => {
    const feed = describeLiveFeed(league);
    let reads = 0;
    let nativeReads = 0;
    let refusal = 0;
    const harness = createHarness(league, async (url) => {
      reads += 1;
      if (url.includes("boxscore") || url.includes("feed/live")) nativeReads += 1;
      if (refusal || (!url.includes("boxscore") && !url.includes("feed/live")))
        return new Response(null, { status: refusal || 503 });
      return Response.json(feed);
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => harness.request()));
    assert.deepEqual(
      results.map((response) => response.status),
      [200, 200, 200, 200, 200],
    );
    const expected = league.describe(feed);
    for (const response of results) assert.deepEqual(await response.json(), expected);
    assert.equal(reads, 1);
    assert.equal((await harness.request()).status, 200);
    assert.equal(reads, 1);
    for (const status of [403, 404, 503]) {
      refusal = status;
      const readsBefore = nativeReads;
      harness.restart();
      assert.deepEqual(await (await harness.request()).json(), expected);
      assert.equal(nativeReads, readsBefore + 1);
    }
    const failedReads = reads;
    refusal = 0;
    harness.advance();
    assert.deepEqual(await (await harness.request()).json(), expected);
    assert.equal(reads, failedReads + 1);
  });

  test(`${league.app}: a timed out cold read is retryable, and a stored live answer survives a timeout`, async (context) => {
    const feed = describeLiveFeed(league);
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let announce;
    let started = new Promise((resolve) => {
      announce = resolve;
    });
    let hangs = true;
    const harness = createHarness(league, async (url, options) => {
      if (!url.includes("boxscore") && !url.includes("feed/live"))
        return new Response(null, { status: 503 });
      if (!hangs) return Response.json(feed);
      announce();
      return new Promise((resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        }),
      );
    });
    const pending = harness.request();
    await started;
    context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);
    assert.equal((await pending).status, 502);
    hangs = false;
    assert.equal((await harness.request()).status, 200);
    harness.advance();
    hangs = true;
    started = new Promise((resolve) => {
      announce = resolve;
    });
    const kept = harness.request();
    await started;
    context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);
    assert.deepEqual(await (await kept).json(), league.describe(feed));
  });

  test(`${league.app}: actual watched-game and background writers reject malformed native scores and preserve usable finals`, async () => {
    const broken = structuredClone(league.feed);
    league.corrupt(broken);
    const harness = createHarness(league, async (url) =>
      url.includes("boxscore") || url.includes("feed/live")
        ? Response.json(broken)
        : new Response(null, { status: 503 }),
    );
    const store = harness.getStore();
    const season = structuredClone(league.season);
    if (league.app === "wnba") season.games = [league.game];
    await store.docs.write("live/current", { season: 2026 });
    await store.docs.write("seasons/2026", season);
    if (league.app === "mlb") await store.docs.write("schedules-2026/10", { games: [league.game] });
    await store.refreshDetails(league.id, {
      games: [league.game],
      nearestGames: [],
      slate: { today: { games: [league.game] }, previous: [], next: [] },
    });
    assert.equal(await store.docs.read(`games/${league.id}`), null);
    const job = league.createJob();
    const fillArchive = () =>
      job.updateStore({
        docs: store.docs,
        storage: store.createJobStorage("games"),
        env: {},
        fetchImpl: store.fetchImpl,
        now: () => NOW,
        createLoadSnapshot: () => async () => null,
      });
    await fillArchive();
    const cold = await store.docs.read(`games/${league.id}`);
    assert.ok(!cold || (league.app === "wnba" && cold.boxScore === null));
    const valid = league.describe(league.feed);
    const kept = league.app === "wnba" ? { boxScore: valid, lead: null } : valid;
    await store.docs.write(`games/${league.id}`, kept);
    await store.refreshDetails(league.id, {
      games: [league.game],
      nearestGames: [],
      slate: { today: { games: [league.game] }, previous: [], next: [] },
    });
    assert.deepEqual(await store.docs.read(`games/${league.id}`), kept);
    await store.createJobStorage("games").delete("final-reads:2026");
    await fillArchive();
    assert.deepEqual(await store.docs.read(`games/${league.id}`), kept);
  });
}

for (const league of LEAGUES) {
  test(`${league.app}: a previously stored live box score survives failure before any detail cache exists`, async () => {
    const harness = createHarness(league, async () => new Response(null, { status: 503 }));
    const boxScore = league.describe(describeLiveFeed(league));
    const stored = league.app === "wnba" ? { boxScore, lead: null } : boxScore;
    await harness.getStore().docs.write(`games/${league.id}`, stored);
    const response = await harness.request();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), boxScore);
    assert.equal(
      (await harness.getStore().createJobStorage("details").list("detail-answer:")).size,
      0,
    );
  });
}

test("WNBA keeps a stored live lead through a failed summary with no secondary cache", async () => {
  const harness = createHarness(LEAGUES[0], async () => new Response(null, { status: 503 }));
  const lead = { periods: 2, isOver: false, scores: [[1, 12, 9]] };
  await harness.getStore().docs.write(`games/${LEAGUES[0].id}`, { lead, boxScore: null });
  const response = await harness.request(`lead?${LEAGUES[0].query}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), lead);
});
