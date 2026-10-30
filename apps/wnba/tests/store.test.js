import { readFileSync } from "node:fs";
import { buildSnapshot, REQUESTS } from "../page/js/snapshot.js";
import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_JOBS } from "../page/js/background-jobs.js";
import { createSnapshotLoader } from "../worker/src/snapshot.js";
import { SeasonStore } from "../worker/src/store.js";
import { createDurableObjectContext } from "../../../tests/durable-object-context.js";
import { readAfternoonEspn } from "./espn-fixtures.js";

test("every background job saves how its run went where the Diagnostics report reads it", async () => {
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

  const saved = [...stored.keys()].filter((key) => key.endsWith("/status"));
  assert.deepEqual(saved.sort(), BACKGROUND_JOBS.map((name) => `${name}/status`).sort());
});

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

test("the real league store verifies reminders from the kept schedule when the schedule fails and the scoreboard lists today's games", async () => {
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
  let isScheduleDown = false;
  /** @param {string} url */
  const fetchImpl = async (url) => {
    const feed = feeds[url];
    if (!feed) return new Response("", { status: 404 });
    if (feed === "schedule" && isScheduleDown) return new Response("<!DOCTYPE html><html></html>");
    return new Response(JSON.stringify(fixture.responses[feed]));
  };
  const { ctx, stored } = createDurableObjectContext();
  const { loadSnapshot } = createSnapshotLoader({ fetchImpl, now: () => now });
  const store = new SeasonStore(
    ctx,
    {},
    { now: () => now, createLoadSnapshot: () => loadSnapshot },
  );
  await store.updateSeason();
  isScheduleDown = true;
  await store.verifyReminderGames();
  const facts = stored.get("push:reminder-games");
  assert.equal(facts.verifiedAt, now);
  assert.ok(facts.games.some((game) => game.id === "1042600132"));
});

test("the real league store verifies reminders from the kept schedule when the scoreboard and schedule fail and ESPN answers for today's games", async () => {
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
  const espn = readAfternoonEspn();
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
  await store.updateSeason();
  downFeeds.add("scoreboard").add("schedule");
  await store.verifyReminderGames();
  const facts = stored.get("push:reminder-games");
  assert.equal(facts.verifiedAt, now);
  assert.ok(facts.games.some((game) => game.id === "1042600132"));
});
