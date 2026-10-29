import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../page/js/snapshot.js";
import { createMemoryStorage } from "../../../shared/worker/feed-keeper.js";
import { createSnapshotLoader } from "../worker/src/snapshot.js";

const EVENING = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/2026-09-24-evening.json"), "utf8"),
);
const NOW = Date.parse(EVENING.now);
const SEASON_GAMES = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures/2026-10-09-season.json"), "utf8"),
).responses.seasonGames;
const RESPONSES = { ...EVENING.responses, seasonGames: SEASON_GAMES };

/** @param {string} url */
function nameRequest(url) {
  if (url.includes("/seasons/")) return "season";
  if (url.includes("/standings")) return "standings";
  if (url.includes("/postseason")) return "postseason";
  if (url.includes("/feed/live")) return "liveGame";
  return url.includes("gameType=") ? "seasonGames" : "schedule";
}

const LIVE_GAME_IDS = RESPONSES.schedule.dates
  .flatMap((/** @type {any} */ day) => day.games)
  .filter((/** @type {any} */ game) => MLBSnapshot.readGameState(game.status) === "live")
  .map((/** @type {any} */ game) => String(game.gamePk));

// MLB's live feed for a game, saying what its schedule's copy says.
/** @param {string} url */
function answerLiveGame(url) {
  const id = /\/game\/(\d+)\//.exec(url)?.[1];
  const game = RESPONSES.schedule.dates
    .flatMap((/** @type {any} */ day) => day.games)
    .find((/** @type {any} */ each) => String(each.gamePk) === id);
  const teams = { away: { runs: game.teams.away.score }, home: { runs: game.teams.home.score } };
  return {
    gameData: { status: game.status },
    liveData: { linescore: { ...game.linescore, teams } },
  };
}

/** @param {{ status?: number, answers?: Record<string, any> }} [options] */
function createFakeMlb({ status = 200, answers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const kind = nameRequest(url);
    const answer = kind === "liveGame" ? answerLiveGame(url) : (answers[kind] ?? RESPONSES[kind]);
    return new Response(JSON.stringify(answer), { status });
  };
  /** @param {string} kind */
  const countCalls = (kind) => calls.filter((call) => nameRequest(call.url) === kind).length;
  return { fetchImpl, calls, countCalls };
}

/** @param {Parameters<typeof createFakeMlb>[0]} [options] */
function createTestLoader(options = {}) {
  const mlb = createFakeMlb(options);
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    mlb,
    loader,
    loadSnapshot: () => loader.loadSnapshot(2026),
    advanceClock: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("the snapshot is built from MLB, with a timeout and a short edge cache", async () => {
  const { mlb, loadSnapshot } = createTestLoader();
  const snapshot = await loadSnapshot();
  const expected = MLBSnapshot.buildSnapshot(RESPONSES, { season: 2026, now: NOW });
  assert.deepEqual(snapshot, { ...expected, failures: {} });
  assert.equal(mlb.calls.length, 5 + LIVE_GAME_IDS.length);
  assert.equal(mlb.calls[0].init.cf.cacheTtl, 15);
  assert.ok(mlb.calls[0].init.signal);
});

test("each game being played is read from MLB's live feed, reused only moments, and one that doesn't answer keeps the schedule's copy", async () => {
  const { mlb, loadSnapshot } = createTestLoader();
  await loadSnapshot();
  const liveCalls = mlb.calls.filter((call) => nameRequest(call.url) === "liveGame");

  assert.equal(liveCalls.length, LIVE_GAME_IDS.length);
  assert.ok(LIVE_GAME_IDS.length > 0);
  assert.ok(liveCalls.every((call) => call.init.cf.cacheTtl === 5));

  const down = createFakeMlb();
  const fetchImpl = (/** @type {string} */ url, /** @type {any} */ init) =>
    nameRequest(url) === "liveGame"
      ? Promise.resolve(new Response("", { status: 503 }))
      : down.fetchImpl(url, init);
  const loader = createSnapshotLoader({ fetchImpl, now: () => NOW });
  const { failures, ...snapshot } = await loader.loadSnapshot(2026);
  const expected = MLBSnapshot.buildSnapshot(RESPONSES, { season: 2026, now: NOW });
  assert.deepEqual(snapshot, expected);
  assert.deepEqual(Object.keys(failures), ["liveGame"]);
  assert.match(
    failures.liveGame,
    /^MLB Stats API answered 503 for \/api\/v1\.1\/game\/\d+\/feed\/live$/,
  );
});

test("each feed that fails is named with why, by its path alone, and a feed that answers isn't", async () => {
  const mlb = createFakeMlb();
  const fetchImpl = (/** @type {string} */ url, /** @type {any} */ init) =>
    nameRequest(url) === "standings"
      ? Promise.resolve(new Response("", { status: 502 }))
      : mlb.fetchImpl(url, init);
  const loader = createSnapshotLoader({ fetchImpl, now: () => NOW });

  const snapshot = await loader.loadSnapshot(2026);

  assert.deepEqual(snapshot.failures, {
    standings: "MLB Stats API answered 502 for /api/v1/standings",
  });
});

const HOUR_MS = 60 * 60 * 1000;

// A fake MLB whose feeds named in `down` answer 502, counting their calls too.
function createFlakyMlb() {
  const mlb = createFakeMlb();
  /** @type {Set<string>} */
  const down = new Set();
  const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
    if (!down.has(nameRequest(url))) return mlb.fetchImpl(url, init);
    mlb.calls.push({ url, init });
    return new Response("", { status: 502 });
  };
  return { ...mlb, down, fetchImpl };
}

const STANDINGS_FAILURE = { standings: "MLB Stats API answered 502 for /api/v1/standings" };

test("a slow feed that answered and then fails is named with why, while its kept answer stands in", async () => {
  const mlb = createFlakyMlb();
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: mlb.fetchImpl, now: () => now });
  const answered = await loader.loadSnapshot(2026);

  mlb.down.add("standings");
  now += 24 * HOUR_MS;
  const failed = await loader.loadSnapshot(2026);
  now += 60 * 1000;
  const waiting = await loader.loadSnapshot(2026);

  assert.equal(mlb.countCalls("standings"), 2);
  assert.deepEqual([failed.failures, waiting.failures], [STANDINGS_FAILURE, STANDINGS_FAILURE]);
  assert.deepEqual(failed.missing, answered.missing);
});

test("a verifying read between updates still names each feed that's failing", async () => {
  const mlb = createFlakyMlb();
  mlb.down.add("standings");
  let now = NOW;
  const loader = createSnapshotLoader({ fetchImpl: mlb.fetchImpl, now: () => now });
  await loader.loadSnapshot(2026);

  now += 60 * 1000;
  const verified = await loader.loadSnapshot(2026, { verify: true });

  assert.deepEqual(verified.failures, STANDINGS_FAILURE);
});

test("reads moments apart share one trip to MLB", async () => {
  const { mlb, loadSnapshot, advanceClock } = createTestLoader();
  await Promise.all([1, 2, 3].map(() => loadSnapshot()));
  const firstTrip = 5 + LIVE_GAME_IDS.length;
  assert.equal(mlb.calls.length, firstTrip);
  advanceClock(11000);
  await loadSnapshot();
  assert.equal(mlb.calls.length, firstTrip + 1 + LIVE_GAME_IDS.length);
});

const SLOW_REQUESTS = ["season", "standings", "postseason", "seasonGames"];

test("only the schedule is read every time, the postseason hourly, and the rest daily", async () => {
  const { mlb, loadSnapshot, advanceClock } = createTestLoader();
  await loadSnapshot();

  advanceClock(HOUR_MS);
  await loadSnapshot();
  assert.deepEqual(["schedule", ...SLOW_REQUESTS].map(mlb.countCalls), [2, 1, 1, 2, 1]);

  advanceClock(23 * HOUR_MS);
  await loadSnapshot();
  assert.deepEqual(["schedule", ...SLOW_REQUESTS].map(mlb.countCalls), [3, 2, 2, 3, 2]);
});

/** @param {any} schedule */
function finishLiveGame(schedule) {
  const finished = structuredClone(schedule);
  const live = finished.dates
    .flatMap((day) => day.games)
    .find((game) => game.status.abstractGameState === "Live");
  Object.assign(live.status, { abstractGameState: "Final", codedGameState: "F" });
  return finished;
}

test("a game that ends has the slow requests read again at once, and once more ten minutes on", async () => {
  const answers = {};
  const { mlb, loadSnapshot, advanceClock } = createTestLoader({ answers });
  await loadSnapshot();

  answers.schedule = finishLiveGame(EVENING.responses.schedule);
  advanceClock(30 * 1000);
  await loadSnapshot();
  await loadSnapshot();
  advanceClock(30 * 1000);
  await loadSnapshot();
  assert.deepEqual(SLOW_REQUESTS.map(mlb.countCalls), [1, 2, 2, 1]);

  advanceClock(10 * 60 * 1000);
  await loadSnapshot();
  assert.deepEqual(SLOW_REQUESTS.map(mlb.countCalls), [1, 3, 3, 1]);
});

test("a past season read whole is kept", async () => {
  const { mlb, loader, advanceClock } = createTestLoader();
  await loader.loadSnapshot(2025);
  const reads = mlb.calls.length;

  advanceClock(24 * HOUR_MS);
  await loader.loadSnapshot(2025);
  assert.equal(mlb.calls.length, reads);
});

test("a past season read while a request failed is read again, and kept once it's whole", async () => {
  const answers = { standings: { records: "not standings" } };
  const { mlb, loader, advanceClock } = createTestLoader({ answers });
  const partial = await loader.loadSnapshot(2025);
  assert.ok(partial.missing.length > 0);

  delete answers.standings;
  advanceClock(25 * HOUR_MS);
  const whole = await loader.loadSnapshot(2025);
  assert.deepEqual(whole.missing, []);
  const reads = mlb.calls.length;

  advanceClock(24 * HOUR_MS);
  await loader.loadSnapshot(2025);
  assert.equal(mlb.calls.length, reads);
});

test("MLB failing is reported", async () => {
  const { loadSnapshot } = createTestLoader({ status: 503 });
  await assert.rejects(loadSnapshot(), /MLB Stats API answered 503/);
});

const RELEASE = {
  version: "2.13.0",
  commit: "abc1234",
  builtAt: "2026-09-28T00:10:41.000Z",
  label: null,
};

// A build bundles the whole Worker and its page, so the tests of the bundle share one.
/** @type {Promise<any> | undefined} */
let bundle;
const loadBundle = () =>
  (bundle ??= import("../../../worker/build.mjs")
    .then(({ buildWorker }) => buildWorker("mlb", { release: RELEASE }))
    .then((script) => import(`data:text/javascript,${encodeURIComponent(script)}`)));

test("the deployable bundle builds and exports the Worker and its store", async () => {
  const { default: worker, SeasonStore } = await loadBundle();
  assert.equal(typeof worker.fetch, "function");
  assert.equal(typeof SeasonStore, "function");
});

test("the bundle serves the release it was built from", async () => {
  const { default: worker } = await loadBundle();
  const response = await worker.fetch(new Request("https://mlb-app.example/k3y/version.json"), {
    APP_KEY: "k3y",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), RELEASE);
});

test("a bundle built without a release has no version file", async () => {
  const { listBundledFiles } = await import("../../../worker/build.mjs");
  assert.equal(listBundledFiles("mlb", null)["version.json"], undefined);
});

test("the release names the version, the commit, and when it was built", async () => {
  const { readRelease } = await import("../../../worker/build.mjs");
  const git = (args) => (args[0] === "log" && args[1] === "-1" ? "b102733\n" : "");
  assert.deepEqual(readRelease("mlb", git, new Date("2026-09-28T00:10:41Z")), {
    version: "2.32.2",
    commit: "b102733",
    builtAt: "2026-09-28T00:10:41.000Z",
    label: null,
  });
});

test("without git, the build has no release", async () => {
  const { readRelease } = await import("../../../worker/build.mjs");
  const release = readRelease("mlb", () => {
    throw new Error("not a git repository");
  });
  assert.equal(release, null);
});

test("a loader that starts over on the same storage keeps what the last one read", async () => {
  const mlb = createFakeMlb();
  const storage = createMemoryStorage();
  let now = NOW;
  const createLoaderOnStorage = () =>
    createSnapshotLoader({ fetchImpl: mlb.fetchImpl, now: () => now, storage });
  await createLoaderOnStorage().loadSnapshot(2026);

  now += 30 * 1000;
  await createLoaderOnStorage().loadSnapshot(2026);
  assert.deepEqual(["schedule", ...SLOW_REQUESTS].map(mlb.countCalls), [2, 1, 1, 1, 1]);
});

test("reminder verification refreshes game facts without rereading every league feed", async () => {
  const mlb = createFakeMlb();
  const loader = createSnapshotLoader({ fetchImpl: mlb.fetchImpl, now: () => NOW });
  await loader.loadSnapshot(2026);
  await loader.loadSnapshot(2026, { verify: true });
  assert.equal(mlb.countCalls("schedule"), 2);
  assert.equal(mlb.countCalls("postseason"), 2);
  assert.equal(mlb.countCalls("standings"), 1);
  assert.equal(mlb.countCalls("seasonGames"), 1);
});
