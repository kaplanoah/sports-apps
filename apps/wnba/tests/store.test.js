import { readFileSync } from "node:fs";
import { buildSnapshot, REQUESTS } from "../worker/src/adapters/wnba.js";
import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_JOBS } from "../page/js/background-jobs.js";
import { createSnapshotLoader } from "../worker/src/snapshot.js";
import { SeasonStore } from "../worker/src/store.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import {
  FAILED_FEED_WAIT_MS,
  nameFeedKey,
  nameStoredFeedKey,
} from "../../../shared/worker/feed-keeper.js";
import { readAfternoonEspn } from "./espn-fixtures.js";

for (const withHistory of [false, true]) {
  test(`${withHistory ? "active" : "idle"} history reports only background work that ran to Diagnostics`, async () => {
    const { ctx, stored } = createDurableObjectContext();
    const now = Date.parse("2026-09-30T20:00:00Z");
    const store = new SeasonStore(
      ctx,
      {},
      {
        fetchImpl: async () => new Response("", { status: 503 }),
        createLoadSnapshot: () => async () => {
          throw new Error("The WNBA didn't answer");
        },
        now: () => now,
      },
    );

    await store.startDueJobs(now);
    await Promise.all(store.jobRuns.values());
    if (withHistory) {
      await store.docs.write("live/current", { season: 2026 });
      await store.docs.write("seasons/2025", { year: 2025, games: [], series: [], slate: null });
    }
    store.startHistory(0, store.alarmGeneration);
    await store.historyRun;

    const saved = [...stored.keys()].filter((key) => key.endsWith("/status"));
    assert.deepEqual(
      saved.sort(),
      BACKGROUND_JOBS.filter((name) => withHistory || !name.endsWith("-history"))
        .map((name) => `${name}/status`)
        .sort(),
    );
  });
}

test("the real league store saves confirmed playoff reminder facts from its snapshot", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
  );
  const now = Date.parse(fixture.now);
  const snapshot = buildSnapshot(fixture.responses, { season: fixture.season, now });
  const { ctx, stored } = createDurableObjectContext();
  const store = new SeasonStore(
    ctx,
    {},
    { now: () => now, createLoadSnapshot: () => async () => snapshot },
  );
  await store.updateSeason();
  const facts = stored.get("push:reminder-games");
  assert.ok(facts);
  assert.deepEqual(
    facts.games.find((game) => game.id === "1042600132"),
    {
      id: "1042600132",
      season: 2026,
      start: 1790809200000,
      away: "Dream",
      home: "Mystics",
      networks: [],
    },
  );
});

test("the real league store keeps what its last update saved when a reminder verification can't read the schedule", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
  );
  const now = Date.parse(fixture.now);
  const snapshot = buildSnapshot(fixture.responses, { season: fixture.season, now });
  const unverified = buildSnapshot(
    { ...fixture.responses, schedule: null },
    { season: fixture.season, now },
  );
  const { ctx, stored } = createDurableObjectContext();
  const store = new SeasonStore(
    ctx,
    {},
    {
      now: () => now,
      createLoadSnapshot: () => async (season, settings) =>
        settings?.verify ? unverified : snapshot,
    },
  );
  await store.updateSeason();
  const saved = structuredClone([...stored].filter(([key]) => key !== "push:reminder-games"));
  await store.verifyReminderGames();
  assert.deepEqual(
    [...stored].filter(([key]) => key !== "push:reminder-games"),
    saved,
  );
  assert.equal(stored.get("push:reminder-games").verifiedAt, null);
});

/**
 * A league store over the afternoon fixture's feeds, read through the real snapshot loader, with
 * each feed named in `downFeeds` answering a page instead, and ESPN answering `espn` by URL.
 * @param {{ espn?: Record<string, unknown> }} [options]
 */
function createLeagueStore({ espn = {} } = {}) {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
  );
  const now = Date.parse(fixture.now);
  const feeds = {
    [REQUESTS.scoreboard]: "scoreboard",
    [REQUESTS.schedule]: "schedule",
    [REQUESTS.bracket(fixture.season)]: "bracket",
    [REQUESTS.standings(fixture.season)]: "standings",
  };
  /** @type {Set<string>} */
  const downFeeds = new Set();
  /** @param {string} url */
  const fetchImpl = async (url) => {
    if (url in espn) return new Response(JSON.stringify(espn[url]));
    const feed = feeds[url];
    if (!feed) return new Response("", { status: 404 });
    if (downFeeds.has(feed)) return new Response("<!DOCTYPE html><html></html>");
    return new Response(JSON.stringify(fixture.responses[feed]));
  };
  const { ctx, stored } = createDurableObjectContext();
  const { loadSnapshot } = createSnapshotLoader({ fetchImpl, now: () => now });
  const store = new SeasonStore(
    ctx,
    {},
    { now: () => now, createLoadSnapshot: () => loadSnapshot },
  );
  return { store, stored, downFeeds, now };
}

test("the real league store verifies reminders from the kept schedule when the schedule fails and the scoreboard lists today's games", async () => {
  const { store, stored, downFeeds, now } = createLeagueStore();
  await store.updateSeason();
  downFeeds.add("schedule");
  await store.verifyReminderGames();
  const facts = stored.get("push:reminder-games");
  assert.equal(facts.verifiedAt, now);
  assert.ok(facts.games.some((game) => game.id === "1042600132"));
});

test("the real league store verifies reminders from the kept schedule when the scoreboard and schedule fail and ESPN answers for today's games", async () => {
  const { store, stored, downFeeds, now } = createLeagueStore({ espn: readAfternoonEspn() });
  await store.updateSeason();
  downFeeds.add("scoreboard").add("schedule");
  await store.verifyReminderGames();
  const facts = stored.get("push:reminder-games");
  assert.equal(facts.verifiedAt, now);
  assert.ok(facts.games.some((game) => game.id === "1042600132"));
});

function createOffseasonStore(time = "2026-10-30T12:00:00Z") {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
  );
  fixture.responses.scoreboard.scoreboard.games = [];
  for (const day of fixture.responses.schedule.leagueSchedule.gameDates)
    for (const game of day.games) {
      game.gameStatus = 3;
      game.gameStatusText = "Final";
    }
  const clock = { now: Date.parse(time) };
  const feeds = new Map(
    Object.entries(REQUESTS).map(([name, request]) => [
      typeof request === "function" ? request(fixture.season) : request,
      name,
    ]),
  );
  const reads = new Map();
  const downFeeds = new Set();
  const fetchImpl = async (url) => {
    const request = new URL(url);
    const name =
      feeds.get(url) ??
      (new URL(url).searchParams.get("dates")?.length === 8 ? "backup" : "networks");
    reads.set(name, (reads.get(name) ?? 0) + 1);
    const isUpcoming =
      request.searchParams.get("Season") === "2027" ||
      request.searchParams.get("SeasonYear") === "2027";
    if (downFeeds.has(name) || (isUpcoming && downFeeds.has("upcoming"))) {
      if (name === "standings") throw new Error("No answer in 8000 ms");
      return new Response("<title>WNBA.com - Official Site of the WNBA</title>");
    }
    return Response.json(fixture.responses[name] ?? { events: [] });
  };
  const { ctx, stored } = createDurableObjectContext();
  const storage = {
    get: (key) => ctx.storage.get(nameStoredFeedKey(key)),
    put: (key, value) => ctx.storage.put(nameStoredFeedKey(key), value),
    delete: (key) => ctx.storage.delete(nameStoredFeedKey(key)),
  };
  const restartStore = () =>
    new SeasonStore(
      ctx,
      {},
      {
        now: () => clock.now,
        fetchImpl,
        createLoadSnapshot: (fetchWith) =>
          createSnapshotLoader({ fetchImpl: fetchWith, storage, now: () => clock.now })
            .loadSnapshot,
      },
    );
  return { clock, reads, downFeeds, stored, storage, restartStore };
}

const damageFeedAnswer = {
  schedule: (answer) => {
    answer.leagueSchedule.gameDates[0].games[0].homeTeam.score = -1;
  },
  bracket: (answer) => {
    answer.bracket.playoffBracketSeries[0].highSeedSeriesWins = -1;
  },
  standings: (answer) => {
    const table = answer.resultSets[0];
    table.rowSet[0][table.headers.indexOf("WINS")] = -1;
  },
};

for (const name of ["schedule", "bracket", "standings"]) {
  for (const isDue of [false, true]) {
    for (const hasShape of [false, true]) {
      test(`the store rejects a ${isDue ? "due" : "young"} saved ${name} with ${hasShape ? "invalid facts" : "no feed data"} and recovers across restarts`, async () => {
        const { clock, reads, downFeeds, stored, storage, restartStore } = createOffseasonStore();
        await restartStore().updateSeasonWhenDue(clock.now);
        const saved = structuredClone(stored.get("seasons/2026"));
        const request = REQUESTS[name];
        const key = await nameFeedKey(
          name,
          typeof request === "function" ? request(2026) : request,
        );
        const record = await storage.get(key);
        if (hasShape) damageFeedAnswer[name](record.answer.data);
        else record.answer.data = "<title>Unavailable</title>";
        if (isDue) record.answer.at -= 24 * 60 * 60_000;
        await storage.put(key, record);
        clock.now += 60 * 60_000;
        downFeeds.add(name);
        let store = restartStore();
        const failedAt = clock.now;
        assert.equal(await store.updateSeasonWhenDue(clock.now), failedAt + FAILED_FEED_WAIT_MS);
        assert.ok(stored.get("live/feeds").failing[name]);
        assert.deepEqual(stored.get("seasons/2026").games, saved.games);
        assert.deepEqual(stored.get("seasons/2026").standings, saved.standings);
        assert.equal((await storage.get(key)).answer, undefined);
        assert.equal(reads.get(name), isDue ? 2 : 1);
        assert.equal(store.requestCount, isDue ? 4 : 3);
        const failedReads = new Map(reads);
        downFeeds.clear();
        store = restartStore();
        clock.now += FAILED_FEED_WAIT_MS - 1;
        await store.updateSeasonWhenDue(clock.now);
        assert.deepEqual(reads, failedReads);
        clock.now += 1;
        await store.updateSeasonWhenDue(clock.now);
        assert.deepEqual(stored.get("live/feeds").failing, {});
        assert.equal(reads.get(name), failedReads.get(name) + 1);
        assert.equal(store.requestCount, 2);
        assert.ok((await storage.get(key)).answer);
        assert.deepEqual(stored.get("seasons/2026").games, saved.games);
        assert.deepEqual(stored.get("seasons/2026").series, saved.series);
        assert.deepEqual(stored.get("seasons/2026").standings, saved.standings);
        store = restartStore();
        const recoveredReads = new Map(reads);
        clock.now += FAILED_FEED_WAIT_MS;
        await store.updateSeasonWhenDue(clock.now);
        assert.deepEqual(reads, recoveredReads);
      });
    }
  }
}

test("offseason slow-feed failures retry on the store's schedule and recover across loader restarts", async (t) => {
  for (const failedFeeds of [["schedule"], ["standings"], ["bracket"], ["schedule", "standings"]]) {
    await t.test(failedFeeds.join(" and "), async () => {
      const { clock, reads, downFeeds, stored, restartStore } = createOffseasonStore();
      let store = restartStore();
      const dayMs = 24 * 60 * 60 * 1000;
      const hourMs = 60 * 60 * 1000;
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + hourMs);
      const saved = structuredClone(stored.get("seasons/2026"));
      clock.now += dayMs;
      failedFeeds.forEach((name) => downFeeds.add(name));
      const failedAt = clock.now;
      assert.equal(await store.updateSeasonWhenDue(clock.now), failedAt + FAILED_FEED_WAIT_MS);
      assert.deepEqual(Object.keys(stored.get("live/feeds").failing).sort(), failedFeeds.sort());
      assert.deepEqual(stored.get("seasons/2026").standings, saved.standings);
      assert.deepEqual(stored.get("seasons/2026").games, saved.games);
      const failedReads = new Map(reads);
      store = restartStore();
      clock.now += FAILED_FEED_WAIT_MS - 1;
      await store.updateSeasonWhenDue(clock.now);
      assert.deepEqual(reads, failedReads);
      clock.now += 1;
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + FAILED_FEED_WAIT_MS);
      for (const name of failedFeeds) {
        assert.equal(reads.get(name), failedReads.get(name) + 1);
        assert.equal(
          stored.get("live/feeds").failing[name].since,
          new Date(failedAt).toISOString(),
        );
      }
      downFeeds.clear();
      store = restartStore();
      clock.now += FAILED_FEED_WAIT_MS;
      assert.equal(await store.updateSeasonWhenDue(clock.now), failedAt + hourMs);
      assert.deepEqual(stored.get("live/feeds").failing, {});
      for (const name of failedFeeds) assert.equal(reads.get(name), failedReads.get(name) + 2);
      for (const name of ["schedule", "standings", "bracket"].filter(
        (name) => !failedFeeds.includes(name),
      ))
        assert.equal(reads.get(name), failedReads.get(name));
    });
  }
});

test("offseason backup probes wake the store hourly and retry failures across restarts", async () => {
  const { clock, reads, downFeeds, stored, restartStore } = createOffseasonStore();
  const hourMs = 60 * 60 * 1000;
  let store = restartStore();
  const firstProbeAt = await store.updateSeasonWhenDue(clock.now);
  assert.equal(firstProbeAt, clock.now + hourMs);
  assert.equal(reads.has("backup"), false);
  const networkReads = reads.get("networks");
  assert.equal(reads.get("scoreboard"), 1);
  store = restartStore();
  clock.now = firstProbeAt - 1;
  await store.updateSeasonWhenDue(clock.now);
  assert.equal(reads.has("backup"), false);
  clock.now = firstProbeAt;
  assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + hourMs);
  assert.equal(reads.get("backup"), 2);
  assert.equal(reads.get("networks"), networkReads);
  assert.equal(reads.get("scoreboard"), 2);
  assert.deepEqual(stored.get("live/feeds")?.failing ?? {}, {});
  clock.now += hourMs;
  downFeeds.add("backup");
  const failedAt = clock.now;
  assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + FAILED_FEED_WAIT_MS);
  assert.equal(reads.get("backup"), 4);
  assert.deepEqual(Object.keys(stored.get("live/feeds").failing), ["backup"]);
  store = restartStore();
  clock.now += FAILED_FEED_WAIT_MS - 1;
  await store.updateSeasonWhenDue(clock.now);
  assert.equal(reads.get("backup"), 4);
  clock.now += 1;
  assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + FAILED_FEED_WAIT_MS);
  assert.equal(reads.get("backup"), 6);
  assert.equal(stored.get("live/feeds").failing.backup.since, new Date(failedAt).toISOString());
  downFeeds.clear();
  store = restartStore();
  clock.now += FAILED_FEED_WAIT_MS;
  assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + hourMs);
  assert.equal(reads.get("backup"), 8);
  assert.deepEqual(stored.get("live/feeds").failing, {});
  for (const name of ["schedule", "standings", "bracket"]) assert.equal(reads.get(name), 1);
  assert.equal(reads.get("networks"), networkReads);
  assert.equal(reads.get("scoreboard"), 5);
});

test("a future WNBA season's failed feeds do not make January retry all season reads", async () => {
  const { clock, reads, downFeeds, stored, restartStore } =
    createOffseasonStore("2027-01-10T12:00:00Z");
  downFeeds.add("upcoming");
  const hourMs = 60 * 60_000;
  const firstAt = clock.now;
  assert.equal(await restartStore().updateSeasonWhenDue(clock.now), firstAt + hourMs);
  assert.equal(stored.get("live/current").season, 2026);
  assert.deepEqual(stored.get("live/feeds")?.failing ?? {}, {});
  const firstReads = new Map(reads);
  for (let minute = 5; minute < 60; minute += 5) {
    clock.now = firstAt + minute * 60_000;
    assert.equal(await restartStore().updateSeasonWhenDue(clock.now), firstAt + hourMs);
    assert.deepEqual(reads, firstReads);
  }
  clock.now = firstAt + hourMs;
  assert.equal(await restartStore().updateSeasonWhenDue(clock.now), clock.now + hourMs);
  assert.equal(reads.get("scoreboard"), 4);
  assert.equal(reads.get("backup"), 2);
  for (const name of ["schedule", "standings", "bracket"])
    assert.equal(reads.get(name), firstReads.get(name));
});

test("feed deadlines preserve faster live polling and do not turn unrelated failures into retries", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-09-30-afternoon.json", import.meta.url), "utf8"),
  );
  const now = Date.parse(fixture.now);
  const snapshot = buildSnapshot(fixture.responses, { season: fixture.season, now });
  for (const { games, failures, nextReadAt, delay } of [
    { games: [], failures: {}, delay: 24 * 60 * 60 * 1000 },
    {
      games: [],
      failures: { scoreboard: "idle", networks: "down" },
      delay: 24 * 60 * 60 * 1000,
    },
    {
      games: [],
      failures: { backup: "down" },
      nextReadAt: now + FAILED_FEED_WAIT_MS,
      delay: FAILED_FEED_WAIT_MS,
    },
    {
      games: [{ ...snapshot.games[0], state: "live", period: 3, clock: "6:00" }],
      failures: { standings: "down" },
      nextReadAt: now + FAILED_FEED_WAIT_MS,
      delay: 15 * 1000,
    },
    {
      games: [{ ...snapshot.games[0], state: "live", period: 4, clock: "4:00" }],
      failures: { schedule: "down" },
      nextReadAt: now + FAILED_FEED_WAIT_MS,
      delay: 5 * 1000,
    },
  ]) {
    const { ctx } = createDurableObjectContext();
    const store = new SeasonStore(
      ctx,
      {},
      {
        now: () => now,
        createLoadSnapshot: () => async () => ({
          ...snapshot,
          games,
          nearestGames: [],
          failures,
          nextReadAt,
        }),
      },
    );
    assert.equal(await store.updateSeason(), delay);
  }
});
