import { readFileSync } from "node:fs";
import { buildSnapshot } from "../worker/src/adapters/mlb.js";
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";
import { BACKGROUND_JOBS } from "../page/js/background-jobs.js";
import { SeasonStore } from "../worker/src/store.js";
import { createSnapshotLoader } from "../worker/src/snapshot.js";
import { createMemoryStorage, FAILED_FEED_WAIT_MS } from "../../../shared/worker/feed-keeper.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";

const APP_KEY = "k3y";
const ORIGIN = "https://mlb-app.example";

function createFakeStore() {
  const { ctx, stored, sockets } = createDurableObjectContext();
  const openSocket = (context) => {
    const socket = {
      sent: [],
      send(message) {
        this.sent.push(JSON.parse(message));
      },
    };
    context.acceptWebSocket(socket);
    return { socket, response: new Response("socket opened") };
  };
  const store = new SeasonStore(ctx, {}, { openSocket });
  const seenPaths = [];
  const env = {
    APP_KEY,
    STORE: {
      idFromName: (name) => name,
      get: () => ({
        fetch: (request) => {
          seenPaths.push(new URL(request.url).pathname);
          return store.fetch(request);
        },
      }),
    },
  };
  return {
    env,
    stored,
    sockets,
    seenPaths,
    write: (key, doc) => store.docs.write(key, doc),
    remove: (key) => store.docs.remove(key),
  };
}

/**
 * @param {object} env
 * @param {string} path
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
function requestStore(env, path, { method = "GET", body, headers = {} } = {}) {
  const init = {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
  };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return worker.fetch(new Request(`${ORIGIN}/${APP_KEY}${path}`, init), env);
}

const readData = async (env, path) => (await (await requestStore(env, path)).json()).data;

test("a document reads back with sorted keys, and a missing one reads as null", async () => {
  const { env, write } = createFakeStore();
  assert.equal(await readData(env, "/store/seasons/2026"), null);

  await write("seasons/2026", {
    year: 2026,
    teams: { NYY: { seed: 4 }, LAD: { seed: 2 } },
    log: [],
  });
  const data = await readData(env, "/store/seasons/2026");
  assert.deepEqual(data, {
    log: [],
    teams: { LAD: { seed: 2 }, NYY: { seed: 4 } },
    year: 2026,
  });
  assert.deepEqual(Object.keys(data), ["log", "teams", "year"]);
  assert.deepEqual(Object.keys(data.teams), ["LAD", "NYY"]);
});

test("a collection lists its documents by id, up to the limit", async () => {
  const { env, write } = createFakeStore();
  for (const year of [2024, 2025, 2026]) await write(`seasons/${year}`, { year });
  await write("standings/2026", { divisions: {} });

  const all = await (await requestStore(env, "/store/seasons")).json();
  assert.deepEqual(
    all.docs.map((doc) => doc.id),
    ["2024", "2025", "2026"],
  );
  assert.deepEqual(all.docs[0].data, { year: 2024 });
  const limited = await (await requestStore(env, "/store/seasons?limit=2")).json();
  assert.equal(limited.docs.length, 2);
});

test("each open watcher hears whether an update is coming, then every write, with the document as saved", async () => {
  const { env, sockets, write } = createFakeStore();
  const opened = await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });
  assert.equal(await opened.text(), "socket opened");
  await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });

  await write("seasons/2026", { year: 2026 });
  await write("seasons/2026", { year: 2026, log: [] });
  for (const socket of sockets)
    assert.deepEqual(socket.sent, [
      { updating: false },
      { path: "seasons/2026", data: { year: 2026 } },
      { path: "seasons/2026", data: { log: [], year: 2026 } },
    ]);

  const plain = await requestStore(env, "/watch");
  assert.equal(plain.status, 426);
});

test("a removed document reads as null, and its watchers hear so", async () => {
  const { env, stored, sockets, write, remove } = createFakeStore();
  await requestStore(env, "/watch", { headers: { upgrade: "websocket" } });
  await write("readings-2026/2026-09-27", { day: 1 });

  await remove("readings-2026/2026-09-27");
  assert.equal(await readData(env, "/store/readings-2026/2026-09-27"), null);
  assert.equal(stored.size, 0);
  assert.deepEqual(sockets[0].sent.at(-1), { path: "readings-2026/2026-09-27", data: null });
});

test("the store answers only under the key, and never sees it", async () => {
  const { env, seenPaths } = createFakeStore();
  await requestStore(env, "/store/seasons/2026?limit=1");
  assert.deepEqual(seenPaths, ["/store/seasons/2026"]);

  const wrongKey = await worker.fetch(new Request(`${ORIGIN}/nope/store/seasons/2026`), env);
  assert.equal(wrongKey.status, 404);
  const noKey = await worker.fetch(new Request(`${ORIGIN}/store/seasons/2026`), env);
  assert.equal(noKey.status, 404);
  const keyless = await worker.fetch(new Request(`${ORIGIN}/k3y/store/seasons/2026`), {
    ...env,
    APP_KEY: undefined,
  });
  assert.equal(keyless.status, 404);
  assert.equal(seenPaths.length, 1, "nothing else reached the store");
});

test("bad names and methods are refused without writing", async () => {
  const { env, stored } = createFakeStore();
  /** @type {[Response | Promise<Response>, number][]} */
  const refusals = [
    [requestStore(env, "/store/seasons/20 26"), 404],
    [requestStore(env, "/store/seasons/2026/extra"), 404],
    [requestStore(env, "/store/seasons/"), 404],
    [requestStore(env, "/store/seasons/2026", { method: "POST" }), 405],
    [requestStore(env, "/store/seasons", { method: "PATCH", body: {} }), 405],
  ];
  for (const [pending, status] of refusals) assert.equal((await pending).status, status);
  assert.equal(stored.size, 0);
});

test("the page can't change any document, since each device keeps its own ranking", async () => {
  const { env, stored, write } = createFakeStore();
  const season = { year: 2026, log: [{ kind: "lock" }] };
  await write("seasons/2026", season);
  await write("standings/2026", { divisions: {} });
  const patch = (path, body) => requestStore(env, path, { method: "PATCH", body });
  /** @type {[Response | Promise<Response>, number][]} */
  const refusals = [
    [requestStore(env, "/store/seasons/2026", { method: "PUT", body: {} }), 405],
    [requestStore(env, "/store/seasons/2026", { method: "DELETE" }), 405],
    [patch("/store/standings/2026", { divisions: null }), 405],
    [patch("/store/seasons/2026", { ranking: ["NYY"] }), 405],
    [patch("/store/seasons/2026", { seenAt: "2026-10-01T00:00:00Z" }), 405],
    [patch("/store/seasons/2030", { ranking: ["NYY"] }), 405],
  ];
  for (const [pending, status] of refusals) assert.equal((await pending).status, status);
  assert.deepEqual(stored.get("seasons/2026"), season);
  assert.deepEqual(stored.get("standings/2026"), { divisions: {} });
  assert.equal(stored.has("seasons/2030"), false);
});

test("every background job saves how its run went where the Diagnostics report reads it", async () => {
  const { ctx, stored } = createDurableObjectContext();
  const now = Date.parse("2026-09-24T22:00:00Z");
  const store = new SeasonStore(
    ctx,
    {},
    {
      fetchImpl: async () => new Response("", { status: 503 }),
      createLoadSnapshot: () => async () => {
        throw new Error("MLB didn't answer");
      },
      now: () => now,
    },
  );

  await store.startDueJobs(now);
  await Promise.all(store.jobRuns.values());

  const saved = [...stored.keys()].filter((key) => key.endsWith("/status"));
  assert.deepEqual(saved.sort(), BACKGROUND_JOBS.map((name) => `${name}/status`).sort());
});

test("the real league store saves confirmed playoff reminder facts from its snapshot", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-10-07-evening.json", import.meta.url), "utf8"),
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
    facts.games.find((game) => game.id === "849832"),
    {
      id: "849832",
      season: 2026,
      start: 1791493200000,
      away: "Guardians",
      home: "White Sox",
      networks: [],
    },
  );
});

test("the real league store keeps what its last update saved when a reminder verification's postseason read fails", async () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./fixtures/2026-10-07-evening.json", import.meta.url), "utf8"),
  );
  const now = Date.parse(fixture.now);
  const snapshot = buildSnapshot(fixture.responses, { season: fixture.season, now });
  const { ctx, stored } = createDurableObjectContext();
  const store = new SeasonStore(
    ctx,
    {},
    {
      now: () => now,
      createLoadSnapshot: () => async (season, settings) => {
        if (settings?.verify) throw new Error("MLB answered 503");
        return snapshot;
      },
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

function nameMlbFeed(url) {
  const { pathname, searchParams } = new URL(url);
  if (pathname.includes("/seasons/")) return "season";
  if (pathname.includes("/standings")) return "standings";
  if (pathname.includes("/postseason")) return "postseason";
  if (pathname.includes("/people")) return "pitchers";
  return searchParams.has("gameType") ? "seasonGames" : "schedule";
}

test("MLB slow-feed failures schedule retries and retain saved data through restarts", async (t) => {
  for (const failedFeed of ["season", "seasonGames", "standings", "postseason"]) {
    await t.test(failedFeed, async () => {
      const fixture = JSON.parse(
        readFileSync(new URL("./fixtures/2026-09-24-evening.json", import.meta.url), "utf8"),
      );
      fixture.responses.schedule = { dates: [] };
      fixture.responses.postseason = { dates: [] };
      fixture.responses.seasonGames = JSON.parse(
        readFileSync(new URL("./fixtures/2026-10-09-season.json", import.meta.url), "utf8"),
      ).responses.seasonGames;
      const clock = { now: Date.parse("2026-10-30T12:00:00Z") };
      const downFeeds = new Set();
      const reads = new Map();
      const fetchImpl = async (url) => {
        const name = nameMlbFeed(url);
        reads.set(name, (reads.get(name) ?? 0) + 1);
        if (downFeeds.has(name)) return new Response("", { status: 503 });
        return Response.json(fixture.responses[name]);
      };
      const { ctx, stored } = createDurableObjectContext();
      const storage = createMemoryStorage();
      const restartStore = () =>
        new SeasonStore(
          ctx,
          {},
          {
            now: () => clock.now,
            createLoadSnapshot: () =>
              createSnapshotLoader({ fetchImpl, storage, now: () => clock.now }).loadSnapshot,
          },
        );
      const dayMs = 24 * 60 * 60 * 1000;
      let store = restartStore();
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + dayMs);
      const saved = structuredClone(stored.get("seasons/2026"));
      clock.now += dayMs;
      downFeeds.add(failedFeed);
      const failedAt = clock.now;
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + FAILED_FEED_WAIT_MS);
      assert.deepEqual(Object.keys(stored.get("live/feeds").failing), [failedFeed]);
      assert.deepEqual(stored.get("seasons/2026").standings, saved.standings);
      const failedReads = new Map(reads);
      store = restartStore();
      clock.now += FAILED_FEED_WAIT_MS - 1;
      await store.updateSeasonWhenDue(clock.now);
      assert.deepEqual(reads, failedReads);
      clock.now += 1;
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + FAILED_FEED_WAIT_MS);
      assert.equal(reads.get(failedFeed), failedReads.get(failedFeed) + 1);
      assert.equal(
        stored.get("live/feeds").failing[failedFeed].since,
        new Date(failedAt).toISOString(),
      );
      downFeeds.clear();
      store = restartStore();
      clock.now += FAILED_FEED_WAIT_MS;
      assert.equal(await store.updateSeasonWhenDue(clock.now), clock.now + dayMs);
      assert.deepEqual(stored.get("live/feeds").failing, {});
      assert.equal(reads.get(failedFeed), failedReads.get(failedFeed) + 2);
      for (const name of ["season", "seasonGames", "standings", "postseason"].filter(
        (name) => name !== failedFeed,
      ))
        assert.equal(reads.get(name), failedReads.get(name));
    });
  }
});
