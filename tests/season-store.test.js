import test, { mock } from "node:test";
import assert from "node:assert/strict";
import {
  addToJobCount,
  createSeasonStore,
  isStoreAnswering,
  readStoreDoc,
} from "../shared/worker/season-store.js";
import { createDurableObjectContext, fireNextAlarm } from "./durable-object-context.js";

const ORIGIN = "https://app.example";

// A league with nothing to update.
const QUIET_LEAGUE = {
  createLoadSnapshot: () => async () => ({}),
  loadCurrentSnapshot: async () => ({ season: 2026 }),
  readUpdates: async () => null,
  saveSnapshot: /** @type {(docs: any, snapshot: any) => Promise<void>} */ (async () => {}),
  describeSnapshotStatus: () => ({ error: "" }),
  choosePollDelay: () => 60_000,
  listNotifications: () => [],
};

const NOW = Date.parse("2026-09-30T20:00:00Z");

test("the visit route counts independently of season updates and normal store reads", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  const response = await store.fetch(new Request(`${ORIGIN}/visits`, { method: "POST" }));
  assert.equal(response.status, 204);
  assert.equal(await context.ctx.storage.getAlarm(), null);
  await store.fetch(new Request(`${ORIGIN}/store/live/current`));
  const counts = await (await store.fetch(new Request(`${ORIGIN}/visits`))).json();
  assert.deepEqual(counts.days, { "2026-09-30": { "app.example": 1 } });
});

const patchSeason = (store, body) =>
  store.fetch(
    new Request(`${ORIGIN}/store/seasons/2026`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

test("a store waits as long as its league says before the next update", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.equal(await context.ctx.storage.getAlarm(), NOW + 60_000);
});

test("the Worker reads a document the store keeps, and null for one it doesn't", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  await store.docs.write("rosters/2026-NYL", { team: "NYL", players: [] });
  const env = {
    STORE: {
      idFromName: (/** @type {string} */ name) => name,
      get: () => ({ fetch: (/** @type {string} */ url) => store.fetch(new Request(url)) }),
    },
  };

  assert.deepEqual(await readStoreDoc(env, "rosters/2026-NYL"), { players: [], team: "NYL" });
  assert.equal(await readStoreDoc(env, "rosters/2026-ATL"), null);
  await assert.rejects(readStoreDoc(env, "rosters/2026/NYL"), /The store answered 404/);
});

test("the Worker can ask whether its store answers, before the store has saved anything", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  const env = {
    STORE: {
      idFromName: (/** @type {string} */ name) => name,
      get: () => ({ fetch: (/** @type {string} */ url) => store.fetch(new Request(url)) }),
    },
  };
  const broken = {
    STORE: { idFromName: () => "store", get: () => ({ fetch: async () => Response.error() }) },
  };

  assert.equal(await isStoreAnswering(env), true);
  assert.equal(await isStoreAnswering(broken), false);
});

test("a store takes no changes from the page", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});

  const refused = await patchSeason(store, { seenAt: "2026-09-30T20:00:00Z" });

  assert.equal(refused.status, 405);
  assert.equal((await refused.json()).error.message, "GET only.");
  assert.equal(refused.headers.get("allow"), "GET");
  assert.equal(await context.ctx.storage.get("seasons/2026"), undefined);
});

test("a store saves the status of each update, with blanks for what it doesn't say", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    describeSnapshotStatus: () => ({ error: "feeds_missing", detail: "standings" }),
    statusFields: { standIn: "" },
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.deepEqual(await context.ctx.storage.get("live/status"), {
    at: "2026-09-30T20:00:00.000Z",
    detail: "standings",
    error: "feeds_missing",
    standIn: "",
    write: "",
  });
});

test("a store leaves the saved status alone while it says the same", async () => {
  const context = createDurableObjectContext();
  let now = NOW;
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => now });

  await store.alarm();
  now += 60_000;
  await store.alarm();

  assert.equal((await context.ctx.storage.get("live/status")).at, "2026-09-30T20:00:00.000Z");
});

test("a status saved before its league had a field reads that field as blank", async () => {
  const context = createDurableObjectContext();
  const saved = { at: "2026-09-30T19:00:00.000Z", detail: "", error: "", write: "" };
  await context.ctx.storage.put("live/status", saved);
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, statusFields: { standIn: "" } });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();

  assert.deepEqual(await context.ctx.storage.get("live/status"), saved);
});

test("a store that can't read its league says why and waits longer after each failure", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    loadCurrentSnapshot: async () => {
      throw new Error("The league answered 503");
    },
  });
  const clock = { now: NOW };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now });
  context.ctx.acceptWebSocket({ send: () => {} });

  const waits = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await store.alarm();
    const alarmAt = await context.ctx.storage.getAlarm();
    waits.push(alarmAt - clock.now);
    clock.now = alarmAt;
  }

  assert.deepEqual(waits, [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 10 * 60e3]);
  assert.deepEqual(await context.ctx.storage.get("live/status"), {
    at: "2026-09-30T20:00:00.000Z",
    detail: "The league answered 503",
    error: "upstream_error",
    write: "",
  });
});

const MINUTE_MS = 60 * 1000;

/**
 * A store with the clock at `clock.now`, and pages that open through `openPage`.
 * @param {Partial<typeof QUIET_LEAGUE>} league
 */
function createWatchedStore(league) {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, ...league });
  const clock = { now: NOW };
  /** @type {any[][]} what each page's socket heard, in the order the pages opened */
  const heard = [];
  const openSocket = (ctx) => {
    const messages = [];
    heard.push(messages);
    const socket = { send: (message) => messages.push(JSON.parse(message)) };
    ctx.acceptWebSocket(socket);
    return { socket, response: new Response(null) };
  };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now, openSocket });
  const openPage = () =>
    store.fetch(new Request(`${ORIGIN}/watch`, { headers: { upgrade: "websocket" } }));
  return { context, clock, store, openPage, heard };
}

test("with no page open, a store updates at most every fifty seconds", async () => {
  const { context, clock, store, openPage } = createWatchedStore({ choosePollDelay: () => 15_000 });

  await store.alarm();
  assert.equal(context.alarm.at, NOW + 50_000);

  await openPage();
  await fireNextAlarm(store, context, clock);
  assert.equal(context.alarm.at, clock.now + 15_000);
});

test("a page that opens brings the next update to when an open page would have had it", async () => {
  const { context, clock, store, openPage } = createWatchedStore({
    choosePollDelay: () => 15_000,
  });
  await store.alarm();

  clock.now = NOW + 5_000;
  await openPage();
  assert.equal(context.alarm.at, NOW + 15_000);
});

test("a page that opens has the season updated once it's fifteen minutes old", async () => {
  for (const [openedAfter, updatedAfter] of [
    [5 * MINUTE_MS, 15 * MINUTE_MS],
    [20 * MINUTE_MS, 20 * MINUTE_MS],
  ]) {
    const { context, clock, store, openPage } = createWatchedStore({
      choosePollDelay: () => 24 * 60 * MINUTE_MS,
    });
    await store.alarm();

    clock.now = NOW + openedAfter;
    await openPage();
    assert.equal(context.alarm.at, NOW + updatedAfter);
  }
});

test("a page that opens as its update comes due hears it's coming, and hears when it's done, though nothing changed", async () => {
  const { context, clock, store, openPage, heard } = createWatchedStore({
    choosePollDelay: () => 15_000,
  });
  await store.alarm();

  clock.now = NOW + 20_000;
  await openPage();
  assert.deepEqual(heard[0], [{ updating: true }]);

  await fireNextAlarm(store, context, clock);
  assert.deepEqual(heard[0], [{ updating: true }, { updating: false }]);
});

test("a page that opens as its update comes due hears what the update saves before it hears the update is done", async () => {
  const { context, clock, store, openPage, heard } = createWatchedStore({
    choosePollDelay: () => 15_000,
    saveSnapshot: async (docs) => {
      await docs.write("seasons/2026", { inning: clock.now });
    },
  });
  await store.alarm();

  clock.now = NOW + 20_000;
  await openPage();
  await fireNextAlarm(store, context, clock);

  assert.deepEqual(
    heard[0].map((message) => message.path ?? message.updating),
    [true, "seasons/2026", false],
  );
});

test("a page that opens before its update comes due hears none is coming", async () => {
  const { clock, store, openPage, heard } = createWatchedStore({ choosePollDelay: () => 15_000 });
  await store.alarm();

  clock.now = NOW + 5_000;
  await openPage();
  assert.deepEqual(heard[0], [{ updating: false }]);
});

test("a page that opens after a deploy hears the season's update is coming", async () => {
  const { context, clock, store, openPage, heard } = createWatchedStore({
    choosePollDelay: () => 15_000,
  });
  await store.alarm();
  await context.ctx.storage.put("poll:schedule", {
    ...(await context.ctx.storage.get("poll:schedule")),
    release: "abc1234",
  });

  clock.now = NOW + 5_000;
  await openPage();
  assert.deepEqual(heard[0], [{ updating: true }]);
});

test("a page that opens while the league isn't answering still waits out the retry", async () => {
  const { context, clock, store, openPage } = createWatchedStore({
    loadCurrentSnapshot: async () => {
      throw new Error("The league answered 503");
    },
  });
  await store.alarm();
  assert.equal(context.alarm.at, NOW + 50_000);

  clock.now = NOW + 10_000;
  await openPage();
  assert.equal(context.alarm.at, NOW + 30_000);
});

test("a store answers a page's close, so the socket stops counting as an open page", () => {
  const { store } = createWatchedStore({});
  let closes = 0;
  store.webSocketClose({
    close: () => {
      closes += 1;
    },
  });
  assert.equal(closes, 1);
});

/**
 * A page's socket, as the store sees it, keeping what the page said it watches and the path of each
 * document pushed to it.
 */
function createPageSocket() {
  const sent = [];
  let attachment = null;
  return {
    sent,
    send: (message) => {
      const { path } = JSON.parse(message);
      if (path) sent.push(path);
    },
    serializeAttachment: (value) => {
      attachment = structuredClone(value);
    },
    deserializeAttachment: () => attachment,
  };
}

test("a page that says what it watches hears only of changes to those documents", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});
  const watching = createPageSocket();
  const unsaid = createPageSocket();
  context.ctx.acceptWebSocket(watching);
  context.ctx.acceptWebSocket(unsaid);

  store.webSocketMessage(
    watching,
    JSON.stringify({ watching: ["seasons/2026", "readings-2026/"] }),
  );
  store.webSocketMessage(watching, JSON.stringify({ watching: ["not a path!"] }));
  store.webSocketMessage(watching, "not JSON");
  for (const path of ["seasons/2026", "readings-2026/2026-09-30-01", "standings/2026"])
    await store.docs.write(path, { year: 2026 });

  assert.deepEqual(watching.sent, ["seasons/2026", "readings-2026/2026-09-30-01"]);
  assert.deepEqual(unsaid.sent, ["seasons/2026", "readings-2026/2026-09-30-01", "standings/2026"]);
});

test("a bare collection name cannot replace a page's document watches", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["seasons/2026"] }));

  store.webSocketMessage(page, JSON.stringify({ watching: ["seasons"] }));

  assert.deepEqual(page.deserializeAttachment(), { watching: ["seasons/2026"] });
  await store.docs.write("seasons/2026", { year: 2026 });
  await store.docs.write("seasons/2027", { year: 2027 });
  assert.deepEqual(page.sent, ["seasons/2026"]);
});

test("a trailing slash watches a collection but cannot name an empty document id", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {});
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["seasons/"] }));
  assert.deepEqual(page.deserializeAttachment(), { watching: ["seasons/"] });

  for (const year of [2026, 2027]) await store.docs.write(`seasons/${year}`, { year });
  await store.docs.write("standings/2026", { year: 2026 });
  assert.deepEqual(page.sent, ["seasons/2026", "seasons/2027"]);
  assert.equal((await store.fetch(new Request(`${ORIGIN}/store/seasons`))).status, 200);
  for (const method of ["GET", "PATCH"])
    assert.equal(
      (await store.fetch(new Request(`${ORIGIN}/store/seasons/`, { method }))).status,
      404,
    );
});

test("each update reads the details of the games pages have open, and saves them when they change", async () => {
  const context = createDurableObjectContext();
  const loads = [];
  const details = { 1: { score: 10 }, 2: { score: 20 } };
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, detailsCollection: "games" });
  const clock = { now: NOW };
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      now: () => clock.now,
      loadDetails: async (id, snapshot, stored) => {
        loads.push({ id, season: snapshot.season, stored });
        return details[id];
      },
    },
  );
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["games/1", "seasons/2026"] }));

  await store.alarm();
  assert.deepEqual(loads, [{ id: "1", season: 2026, stored: null }]);
  assert.deepEqual(await context.ctx.storage.get("games/1"), { score: 10 });
  assert.deepEqual(page.sent, ["games/1"]);

  await fireNextAlarm(store, context, clock);
  assert.deepEqual(loads[1].stored, { score: 10 });
  assert.deepEqual(page.sent, ["games/1"]);
});

test("a game's details that fail to load leave the saved ones and don't hold up the update", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({ ...QUIET_LEAGUE, detailsCollection: "games" });
  const store = new SeasonStore(
    context.ctx,
    {},
    {
      now: () => NOW,
      loadDetails: async () => {
        throw new Error("The league answered 503");
      },
    },
  );
  context.stored.set("games/1", { score: 10 });
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);
  store.webSocketMessage(page, JSON.stringify({ watching: ["games/1"] }));
  const logged = mock.method(console, "error", () => {});

  await store.alarm();

  logged.mock.restore();
  assert.deepEqual(await context.ctx.storage.get("games/1"), { score: 10 });
  assert.equal(await context.ctx.storage.getAlarm(), NOW + 60_000);
});

test("a store saves which season is current, and saves it again only when it changes", async () => {
  const context = createDurableObjectContext();
  let season = 2026;
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    loadCurrentSnapshot: async () => ({ season }),
  });
  const clock = { now: NOW };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now });
  const page = createPageSocket();
  context.ctx.acceptWebSocket(page);

  await store.alarm();
  await fireNextAlarm(store, context, clock);
  season = 2027;
  await fireNextAlarm(store, context, clock);

  assert.deepEqual(await context.ctx.storage.get("live/current"), { season: 2027 });
  assert.deepEqual(
    page.sent.filter((path) => path === "live/current"),
    ["live/current", "live/current"],
  );
});

test("a league reads through the fetch it's handed, and keeps what it reads in the store's storage, under keys its paths can't name", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    createLoadSnapshot: (storage, fetchImpl) => async () => {
      const answer = await (await fetchImpl("https://league.example/standings")).json();
      await storage.put("standings", answer);
      await storage.put("old-standings", answer);
      await storage.delete("old-standings");
      return storage.get("standings");
    },
  });
  /** @param {string} who */
  const createFetch = (who) => {
    const reads = [];
    /** @type {typeof fetch} */
    const fetchImpl = async (url) => {
      reads.push(String(url));
      return Response.json({ readBy: who });
    };
    return { reads, fetchImpl };
  };
  const storeFetch = createFetch("store");
  const store = new SeasonStore(context.ctx, {}, { fetchImpl: storeFetch.fetchImpl });

  assert.deepEqual(await store.loadSnapshot(2026), { readBy: "store" });
  assert.deepEqual(storeFetch.reads, ["https://league.example/standings"]);
  assert.deepEqual(await context.ctx.storage.get("feed:standings"), { readBy: "store" });
  assert.equal(context.stored.has("feed:old-standings"), false);

  const runFetch = createFetch("run");
  assert.deepEqual(await store.createLoadSnapshot(runFetch.fetchImpl)(2026), { readBy: "run" });
  assert.deepEqual(runFetch.reads, ["https://league.example/standings"]);
  assert.equal(storeFetch.reads.length, 1);
});

/**
 * A league whose news job runs every fifteen minutes, and holds each run open until `finishRun`.
 * @param {object[]} contexts each run's context, as the job gets it
 */
function createJobLeague(contexts) {
  /** @type {(value?: unknown) => void} */
  let finishRun = () => {};
  const job = {
    chooseDelay: () => 15 * MINUTE_MS,
    updateStore: (context) => {
      contexts.push(context);
      return new Promise((resolve) => {
        finishRun = resolve;
      });
    },
  };
  return { league: { ...QUIET_LEAGUE, backgroundJobs: { news: job } }, finish: () => finishRun() };
}

test("a background job runs beside the season's update, and the alarm wakes for whichever is due first", async () => {
  const context = createDurableObjectContext();
  const contexts = [];
  let seasonUpdates = 0;
  const { league, finish } = createJobLeague(contexts);
  const SeasonStore = createSeasonStore({
    ...league,
    loadCurrentSnapshot: async () => {
      seasonUpdates += 1;
      return { season: 2026 };
    },
    choosePollDelay: () => 60 * MINUTE_MS,
  });
  const clock = { now: NOW };
  const env = { ANTHROPIC_API_KEY: "test-key" };
  const store = new SeasonStore(context.ctx, env, { now: () => clock.now });

  await store.alarm();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].env, env);
  assert.equal(contexts[0].createLoadSnapshot, store.createLoadSnapshot);
  assert.equal(seasonUpdates, 1);
  assert.equal(await context.ctx.storage.getAlarm(), NOW + 15 * MINUTE_MS);

  finish();
  await store.jobRuns.get("news");
  await fireNextAlarm(store, context, clock);
  assert.equal(contexts.length, 2);
  assert.equal(seasonUpdates, 1);
  assert.equal(await context.ctx.storage.getAlarm(), NOW + 30 * MINUTE_MS);
});

test("a job still running when it's due again isn't started twice, and doesn't hold up the season", async () => {
  const context = createDurableObjectContext();
  const contexts = [];
  let seasonUpdates = 0;
  const { league } = createJobLeague(contexts);
  const SeasonStore = createSeasonStore({
    ...league,
    loadCurrentSnapshot: async () => {
      seasonUpdates += 1;
      return { season: 2026 };
    },
    choosePollDelay: () => 15 * MINUTE_MS,
  });
  const clock = { now: NOW };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now });

  await store.alarm();
  await fireNextAlarm(store, context, clock);

  assert.equal(contexts.length, 1);
  assert.equal(seasonUpdates, 2);
});

test("a job's run lost with the store, as when a deploy restarts it, runs again at the store's next alarm rather than at its next turn", async () => {
  const context = createDurableObjectContext();
  const contexts = [];
  const { league, finish } = createJobLeague(contexts);
  const SeasonStore = createSeasonStore({ ...league, choosePollDelay: () => MINUTE_MS });
  const clock = { now: NOW };
  await new SeasonStore(context.ctx, {}, { now: () => clock.now }).alarm();

  const restarted = new SeasonStore(context.ctx, {}, { now: () => clock.now });
  await fireNextAlarm(restarted, context, clock);
  assert.equal(contexts.length, 2);

  finish();
  await restarted.jobRuns.get("news");
  await fireNextAlarm(restarted, context, clock);
  assert.equal(contexts.length, 2);
});

test("a run lost again as it ran for one lost before waits for the job's next turn", async () => {
  const context = createDurableObjectContext();
  const contexts = [];
  const { league } = createJobLeague(contexts);
  const SeasonStore = createSeasonStore({ ...league, choosePollDelay: () => MINUTE_MS });
  const clock = { now: NOW };
  const restart = () => new SeasonStore(context.ctx, {}, { now: () => clock.now });
  await restart().alarm();
  await fireNextAlarm(restart(), context, clock);
  assert.equal(contexts.length, 2);

  const third = restart();
  await fireNextAlarm(third, context, clock);
  await fireNextAlarm(third, context, clock);
  assert.equal(contexts.length, 2);

  clock.now = NOW + 16 * MINUTE_MS;
  await third.alarm();
  assert.equal(contexts.length, 3);
});

test("an alarm whose storage fails is set again for a retry", async (t) => {
  const context = createDurableObjectContext();
  const logged = t.mock.method(console, "error", () => {});
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  const { get } = context.ctx.storage;
  context.ctx.storage.get = async () => {
    throw new Error("Storage is down");
  };

  await store.alarm();

  context.ctx.storage.get = get;
  assert.equal(await context.ctx.storage.getAlarm(), NOW + 30_000);
  assert.match(String(logged.mock.calls[0].arguments[0]), /alarm failed: .*Storage is down/);
});

test("a job that fails is logged, and runs again when it's next due", async (t) => {
  const context = createDurableObjectContext();
  const logged = t.mock.method(console, "error", () => {});
  let runs = 0;
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    backgroundJobs: {
      news: {
        chooseDelay: () => 15 * MINUTE_MS,
        updateStore: async () => {
          runs += 1;
          throw new Error("Claude answered 529");
        },
      },
    },
  });
  const clock = { now: NOW };
  const store = new SeasonStore(context.ctx, {}, { now: () => clock.now });

  await store.alarm();
  await store.jobRuns.get("news");
  clock.now = NOW + 15 * MINUTE_MS;
  await store.alarm();
  await store.jobRuns.get("news");

  assert.equal(runs, 2);
  assert.match(
    String(logged.mock.calls[0].arguments[0]),
    /The news job failed: .*Claude answered 529/,
  );
});

test("a job keeps what it saves under keys the store's paths can't name, and writes documents pages read", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    backgroundJobs: {
      news: {
        chooseDelay: () => 15 * MINUTE_MS,
        updateStore: async ({ storage, docs }) => {
          await storage.put("story:a", { title: "A" });
          await storage.put("story:b", { title: "B" });
          await storage.put("other", 1);
          const stories = await storage.list("story:");
          await docs.write("news/feed", { count: stories.size, keys: [...stories.keys()] });
        },
      },
    },
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.alarm();
  await store.jobRuns.get("news");

  assert.deepEqual(await context.ctx.storage.get("job:news:story:a"), { title: "A" });
  assert.deepEqual(await context.ctx.storage.get("news/feed"), {
    count: 2,
    keys: ["story:a", "story:b"],
  });
});

test("changes to one document, as from the season's update and a job, run one at a time, each from what the one before left", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore(QUIET_LEAGUE);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  await store.docs.write("seasons/2026", { year: 2026 });

  await Promise.all([
    store.docs.update("seasons/2026", (doc) => ({ ...doc, games: [] })),
    assert.rejects(
      store.docs.update("seasons/2026", () => {
        throw new Error("A change that fails");
      }),
    ),
    store.docs.update("seasons/2026", () => null),
    store.docs.update("seasons/2026", (doc) => ({ ...doc, leaders: [] })),
  ]);

  assert.deepEqual(await context.ctx.storage.get("seasons/2026"), {
    games: [],
    leaders: [],
    year: 2026,
  });
});

test("a page that opens starts a job a deploy added, rather than waiting for the alarm already set", async () => {
  const context = createDurableObjectContext();
  const contexts = [];
  const { league } = createJobLeague(contexts);
  const SeasonStore = createSeasonStore(league);
  await context.ctx.storage.setAlarm(NOW + 3 * 60 * MINUTE_MS);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.fetch(new Request(`${ORIGIN}/store/seasons/2026`));

  assert.equal(await context.ctx.storage.getAlarm(), NOW);
});

test("a page that opens leaves the alarm alone once every job has run", async () => {
  const context = createDurableObjectContext();
  const { league } = createJobLeague([]);
  const SeasonStore = createSeasonStore(league);
  await context.ctx.storage.setAlarm(NOW + 3 * 60 * MINUTE_MS);
  await context.ctx.storage.put("job-due:news", NOW + 10 * MINUTE_MS);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });

  await store.fetch(new Request(`${ORIGIN}/store/seasons/2026`));

  assert.equal(await context.ctx.storage.getAlarm(), NOW + 3 * 60 * MINUTE_MS);
});

/**
 * A store on the release named, whose last update was five minutes ago under `savedRelease`, with
 * the next due in three hours.
 * @param {{ release: string, savedRelease: string | undefined }} releases
 */
async function openStoreAfterUpdate({ release, savedRelease }) {
  const context = createDurableObjectContext();
  const updates = { count: 0 };
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    release,
    loadCurrentSnapshot: async () => {
      updates.count += 1;
      return { season: 2026 };
    },
  });
  const dueAt = NOW + 3 * 60 * MINUTE_MS;
  await context.ctx.storage.put("poll:schedule", {
    at: NOW - 5 * MINUTE_MS,
    delay: 3 * 60 * MINUTE_MS,
    dueAt,
    ...(savedRelease === undefined ? {} : { release: savedRelease }),
  });
  await context.ctx.storage.setAlarm(dueAt);
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  await store.fetch(new Request(`${ORIGIN}/store/seasons/2026`));
  return { context, store, updates, dueAt };
}

test("a page that opens after a deploy has the season updated at once, rather than on the last release's schedule", async () => {
  for (const savedRelease of ["earlier-commit", undefined]) {
    const { context, store, updates } = await openStoreAfterUpdate({
      release: "new-commit",
      savedRelease,
    });
    assert.equal(await context.ctx.storage.getAlarm(), NOW, String(savedRelease));

    await store.alarm();
    assert.equal(updates.count, 1, String(savedRelease));
    assert.equal((await context.ctx.storage.get("poll:schedule")).release, "new-commit");
  }
});

test("a page that opens on the release that last updated the season keeps its schedule", async () => {
  const { context, store, updates, dueAt } = await openStoreAfterUpdate({
    release: "new-commit",
    savedRelease: "new-commit",
  });
  assert.equal(await context.ctx.storage.getAlarm(), dueAt);

  await store.alarm();
  assert.equal(updates.count, 0);
});

test("the Worker adds to a count a job keeps, which the job reads and the page can't change", async () => {
  const context = createDurableObjectContext();
  const SeasonStore = createSeasonStore({
    ...QUIET_LEAGUE,
    backgroundJobs: { players: { chooseDelay: () => 5 * MINUTE_MS, updateStore: async () => {} } },
  });
  const store = new SeasonStore(context.ctx, {}, { now: () => NOW });
  const env = {
    STORE: {
      idFromName: (/** @type {string} */ name) => name,
      get: () => ({
        fetch: (/** @type {string} */ url, /** @type {RequestInit} */ init) =>
          store.fetch(new Request(url, init)),
      }),
    },
  };

  await addToJobCount(env, "players", "leagueReads");
  await addToJobCount(env, "players", "leagueReads");

  assert.equal(await store.createJobStorage("players").get("count:leagueReads"), 2);
  await assert.rejects(addToJobCount(env, "news", "leagueReads"), /The store answered 404/);
  const read = await store.fetch(new Request(`${ORIGIN}/count/players/leagueReads`));
  assert.equal(read.status, 405);
  assert.equal(read.headers.get("allow"), "POST");
  assert.equal(await store.createJobStorage("players").get("count:leagueReads"), 2);
});
