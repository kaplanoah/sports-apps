import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPitcherServer,
  listAppearancesRequest,
  listQualifiedIds,
  listQualifiedRequest,
  namePitcherKey,
  nameStartersKey,
} from "../worker/src/pitchers.js";
import { SIDE_VERSION, createPitcherJob, nameReadsKey } from "../worker/src/pitcher-updater.js";
import { createRotationServer, nameRotationKey } from "../worker/src/rotations.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

// MLB's tables, the last two weeks of games, and the pitchers the matchup sheet reads, as MLB
// answered early on the morning of a Division Series day, with this season's qualified starters
// and the Guardians' and White Sox's recent starters standing in for every pitcher.
const FIXTURE = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-06-pitchers.json`, "utf8"),
);
const NOW = Date.parse(FIXTURE.recordedAt);
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";
const MINUTE_MS = 60 * 1000;
const MLB_API = "https://statsapi.mlb.com";
const LEAGUE_FEEDS = 4;
const QUALIFIED_IDS = listQualifiedIds(FIXTURE.answers[listQualifiedRequest(2026)]);
const RECORDED_IDS = FIXTURE.people[2026].map((/** @type {any} */ person) => person.id);
const OTHER_STARTERS = RECORDED_IDS.filter((id) => !QUALIFIED_IDS.includes(id));
const PAST_QUALIFIED_IDS = listQualifiedIds(FIXTURE.answers[listQualifiedRequest(2025)]);
const STATUS_KEY = "pitchers/status";

/** MLB's answers, by request, each a copy a test can change. */
const listAnswers = () => structuredClone(FIXTURE.answers);

/**
 * MLB's answer to a request for some pitchers, from the ones the fixture recorded.
 * @param {URL} url
 */
function answerPeople(url) {
  const hydrate = url.searchParams.get("hydrate") ?? "";
  const season = /season=(\d{4})/.exec(hydrate)?.[1] ?? "";
  const ids = (url.searchParams.get("personIds") ?? "").split(",").map(Number);
  const recorded = hydrate.includes("gameLog") ? FIXTURE.gameLogs : FIXTURE.people;
  return {
    people: (recorded[season] ?? []).filter((/** @type {any} */ person) => ids.includes(person.id)),
  };
}

/**
 * @param {Record<string, any>} answers
 * @param {Set<string>} [unanswered] the starts of the paths MLB doesn't answer
 */
function createMlbFetch(answers, unanswered = new Set()) {
  /** @type {string[]} */
  const requests = [];
  /** @param {string} url */
  const fetchImpl = async (url) => {
    const path = url.slice(MLB_API.length);
    requests.push(path);
    if ([...unanswered].some((start) => path.startsWith(start)))
      return new Response("Unavailable", { status: 503 });
    if (path in answers) return Response.json(answers[path]);
    if (path.startsWith("/api/v1/people?")) return Response.json(answerPeople(new URL(url)));
    return new Response("Not found", { status: 404 });
  };
  return { requests, fetchImpl };
}

/**
 * @param {number} finals
 * @param {any[]} [games] the slate's games still to come today
 */
const describeSeason = (finals, games = []) => ({
  year: 2026,
  slate: {
    today: {
      date: TODAY,
      games: [...Array.from({ length: finals }, () => ({ state: "final" })), ...games],
    },
  },
});

/**
 * The documents a run wrote, but for its status, which it writes each run.
 * @param {{ writes: string[] }} docs
 */
const listDataWrites = ({ writes }) => writes.filter((key) => key !== STATUS_KEY);

/**
 * A store whose current season is 2026, with 2025 kept from before, and the job that keeps its
 * pitchers, run as the store runs it.
 * @param {{ answers?: Record<string, any>, job?: ReturnType<typeof createPitcherJob> }} [options]
 */
function createRun({ answers = listAnswers(), job = createPitcherJob() } = {}) {
  const docs = createDocs({
    "live/current": { season: 2026 },
    "seasons/2026": describeSeason(0),
    "seasons/2025": { year: 2025 },
  });
  const storage = createJobStorage();
  /** @type {Set<string>} */
  const unanswered = new Set();
  const mlb = createMlbFetch(answers, unanswered);
  const clock = { now: NOW };
  const runJob = () =>
    job.run({
      docs,
      storage,
      loadSnapshot: async () => null,
      env: {},
      fetchImpl: mlb.fetchImpl,
      now: () => clock.now,
    });
  /** @param {number} minutes */
  const wait = (minutes) => {
    clock.now += minutes * MINUTE_MS;
  };
  let finals = 0;
  /**
   * A game ends in which `id` pitched.
   * @param {number} id
   */
  const endGame = (id) => {
    const regular = answers[listAppearancesRequest(2026, "R")];
    const row = regular.stats[0].splits.find((/** @type {any} */ line) => line.player.id === id);
    row.stat.gamesPlayed += 1;
    finals += 1;
    docs.stored.set("seasons/2026", describeSeason(finals));
  };
  return { docs, storage, mlb, unanswered, runJob, wait, endGame };
}

/** @param {any} docs */
const readFromStore = (docs) => (/** @type {string} */ key) => docs.read(key);

function createLeagueReadCounter() {
  const counter = {
    count: 0,
    countLeagueRead: async () => {
      counter.count += 1;
    },
  };
  return counter;
}

/**
 * A pitcher's side as the Worker answers it, from the store when `docs` is given, or from MLB,
 * and how many times it counted a read of MLB the store should have spared.
 * @param {string} query
 * @param {{ docs?: any, answers?: Record<string, any> }} [options]
 */
async function askForPitcher(query, { docs, answers = listAnswers() } = {}) {
  const { requests, fetchImpl } = createMlbFetch(answers);
  const counter = createLeagueReadCounter();
  const response = await createPitcherServer({ fetchImpl, now: () => NOW }).servePitcher(
    new URL(`https://mlb-app.example/k3y/pitcher?${query}`),
    docs ? readFromStore(docs) : undefined,
    counter.countLeagueRead,
  );
  return {
    status: response.status,
    body: await response.json(),
    requests,
    leagueReads: counter.count,
  };
}

/**
 * A club's starters as the Worker answers them, from the store when `docs` is given, or from MLB,
 * and how many times it counted a read of MLB the store should have spared.
 * @param {string} query
 * @param {{ docs?: any }} [options]
 */
async function askForRotation(query, { docs } = {}) {
  const { requests, fetchImpl } = createMlbFetch(listAnswers());
  const counter = createLeagueReadCounter();
  const response = await createRotationServer({ fetchImpl }).serveRotation(
    new URL(`https://mlb-app.example/k3y/rotation?${query}`),
    docs ? readFromStore(docs) : undefined,
    counter.countLeagueRead,
  );
  return {
    status: response.status,
    body: await response.json(),
    requests,
    leagueReads: counter.count,
  };
}

const isLeagueFeed = (/** @type {string} */ path) =>
  path.startsWith("/api/v1/stats?") || path.startsWith("/api/v1/schedule?");

test("a pitcher's side from the store is the one MLB's feeds make, and reads nothing from MLB", async () => {
  const { docs, runJob } = createRun();
  await runJob();

  for (const id of [...QUALIFIED_IDS.slice(0, 3), ...OTHER_STARTERS]) {
    const query = `id=${id}&season=2026`;
    const fromStore = await askForPitcher(query, { docs });
    const fromMlb = await askForPitcher(query);
    assert.equal(fromStore.status, 200);
    assert.deepEqual(fromStore.body, fromMlb.body);
    assert.deepEqual(fromStore.requests, []);
    assert.equal(fromStore.leagueReads, 0);
  }
  const ranked = await askForPitcher(`id=${QUALIFIED_IDS[0]}&season=2026`, { docs });
  assert.equal(ranked.body.starters.count, QUALIFIED_IDS.length);
  assert.ok(ranked.body.ranks);
  const unranked = await askForPitcher(`id=${OTHER_STARTERS[0]}&season=2026`, { docs });
  assert.equal(unranked.body.ranks, null);
});

test("a club's starters from the store are the ones MLB's feeds make, and read nothing from MLB", async () => {
  const { docs, runJob } = createRun();
  await runJob();

  for (const club of ["CLE", "CWS"])
    for (const date of [TODAY, TOMORROW]) {
      const query = `club=${club}&date=${date}`;
      const fromStore = await askForRotation(query, { docs });
      const fromMlb = await askForRotation(query);
      assert.equal(fromStore.status, 200);
      assert.ok(fromStore.body.starters.length > 0);
      assert.deepEqual(fromStore.body, fromMlb.body);
      assert.deepEqual(fromStore.requests, []);
      assert.equal(fromStore.leagueReads, 0);
    }
});

test("a club whose starters the store doesn't keep, or a day its starts don't reach back to, has the sheet read MLB, counted", async () => {
  const { docs, runJob } = createRun();
  await runJob();

  assert.equal(docs.stored.get(nameRotationKey(2026, "NYY")), undefined);
  const unkept = await askForRotation(`club=NYY&date=${TODAY}`, { docs });
  assert.ok(unkept.requests.length > 0);
  assert.equal(unkept.leagueReads, 1);
  const earlier = await askForRotation("club=CLE&date=2026-10-01", { docs });
  assert.ok(earlier.requests.length > 0);
  assert.equal(earlier.leagueReads, 1);
  const pastSeason = await askForRotation("club=CLE&date=2025-09-28", { docs });
  assert.equal(pastSeason.leagueReads, 0);
});

test("a run that finds nothing new reads nothing from MLB and saves nothing", async () => {
  const { docs, mlb, runJob, wait } = createRun();
  await runJob();
  const firstRequests = mlb.requests.length;
  const firstWrites = listDataWrites(docs).length;

  wait(5);
  await runJob();
  wait(5);
  await runJob();

  assert.equal(mlb.requests.length, firstRequests);
  assert.equal(listDataWrites(docs).length, firstWrites);
});

test("a game's end has the next run read the league's feeds and the pitchers who pitched in it, and once more as their numbers settle", async () => {
  const { mlb, runJob, wait, endGame } = createRun();
  await runJob();
  const pitcher = QUALIFIED_IDS[5];

  endGame(pitcher);
  const beforeFinal = mlb.requests.length;
  wait(5);
  await runJob();
  const afterFinal = mlb.requests.slice(beforeFinal);
  wait(10);
  await runJob();
  const settled = mlb.requests.slice(beforeFinal + afterFinal.length);
  wait(5);
  await runJob();

  for (const reads of [afterFinal, settled]) {
    assert.equal(reads.filter(isLeagueFeed).length, LEAGUE_FEEDS);
    const pitcherReads = reads.filter((path) => !isLeagueFeed(path));
    assert.equal(pitcherReads.length, 2);
    assert.ok(pitcherReads.every((path) => path.includes(`personIds=${pitcher}&`)));
  }
  assert.equal(mlb.requests.length, beforeFinal + afterFinal.length + settled.length);
});

test("sides saved before they gained a field are each read once more, and then not again", async () => {
  const { storage, mlb, runJob, wait } = createRun();
  await runJob();
  wait(5);
  await runJob();
  const reads = await storage.get(nameReadsKey(2026));
  await storage.delete(nameReadsKey(2026));
  await storage.put(nameReadsKey(2026, SIDE_VERSION - 1), reads);
  const listPitcherReads = (/** @type {string[]} */ requests) =>
    requests.filter((path) => path.startsWith("/api/v1/people?") && /season=2026/.test(path));
  const before = mlb.requests.length;

  wait(5);
  await runJob();
  const reread = listPitcherReads(mlb.requests.slice(before));
  wait(5);
  await runJob();
  wait(5);
  await runJob();

  assert.equal(reread.length, 2 * Math.ceil(RECORDED_IDS.length / 30));
  assert.deepEqual(listPitcherReads(mlb.requests.slice(before)), reread);
});

test("a final MLB answers the same for saves no document", async () => {
  const { docs, runJob, wait, endGame } = createRun();
  await runJob();
  const writes = listDataWrites(docs).length;

  endGame(QUALIFIED_IDS[0]);
  wait(5);
  await runJob();

  assert.equal(listDataWrites(docs).length, writes);
});

test("a past season's qualified starters are filled once, after the current season, and never read again", async () => {
  const { docs, mlb, runJob, wait } = createRun();
  await runJob();
  const pastReads = mlb.requests.filter((path) => /season=2025/.test(path));

  wait(5);
  await runJob();
  wait(24 * 60);
  await runJob();

  assert.equal(pastReads.length, 1 + Math.ceil(PAST_QUALIFIED_IDS.length / 30));
  assert.equal(mlb.requests.filter((path) => /season=2025/.test(path)).length, pastReads.length);
  assert.ok(docs.stored.get(nameStartersKey(2025)));
  const query = `id=${PAST_QUALIFIED_IDS[0]}&season=2025`;
  const fromStore = await askForPitcher(query, { docs });
  assert.deepEqual(fromStore.body, (await askForPitcher(query)).body);
  assert.equal(fromStore.requests.length, 2);
  assert.ok(
    fromStore.requests.every((path) => path.includes(`personIds=${PAST_QUALIFIED_IDS[0]}&`)),
  );
  assert.equal(fromStore.leagueReads, 0);
});

test("a pitcher the store doesn't keep has the sheet read MLB for him alone", async () => {
  const { docs, runJob } = createRun();
  await runJob();
  const id = QUALIFIED_IDS[0];
  docs.stored.delete(namePitcherKey(2026, id));

  const unkept = await askForPitcher(`id=${id}&season=2026`, { docs });
  assert.equal(unkept.status, 200);
  assert.equal(unkept.requests.length, 2);
  assert.equal(unkept.leagueReads, 1);
  assert.deepEqual(unkept.body, (await askForPitcher(`id=${id}&season=2026`)).body);
});

test("a pitcher named to start a game the page lists is kept before his first start, so his sheet reads nothing from MLB", async () => {
  const answers = listAnswers();
  const id = OTHER_STARTERS[0];
  for (const gameType of /** @type {const} */ (["R", "P"])) {
    const table = answers[listAppearancesRequest(2026, gameType)].stats[0];
    table.splits = table.splits.filter((/** @type {any} */ row) => row.player.id !== id);
  }
  const { docs, runJob } = createRun({ answers });
  const game = { state: "scheduled", starters: [{ id, name: "Named" }, null] };
  docs.stored.set("seasons/2026", describeSeason(0, [game]));
  await runJob();

  const named = await askForPitcher(`id=${id}&season=2026`, { docs, answers });
  assert.equal(named.status, 200);
  assert.deepEqual(named.requests, []);
  assert.equal(named.leagueReads, 0);
});

test("a store that can't be read has the sheet read MLB", async () => {
  const broken = { read: async () => Promise.reject(new Error("The store answered 500")) };
  const query = `id=${QUALIFIED_IDS[0]}&season=2026`;
  const unreadable = await askForPitcher(query, { docs: broken });
  assert.equal(unreadable.status, 200);
  assert.deepEqual(unreadable.body, (await askForPitcher(query)).body);
  const rotation = await askForRotation(`club=CLE&date=${TODAY}`, { docs: broken });
  assert.equal(rotation.status, 200);
  assert.ok(rotation.requests.length > 0);
});

test("a feed that stops answering leaves what the store saved from it", async () => {
  const answers = listAnswers();
  const { docs, runJob, wait, endGame } = createRun({ answers });
  await runJob();
  const starters = docs.stored.get(nameStartersKey(2026));
  const writes = listDataWrites(docs).length;

  delete answers[listQualifiedRequest(2026)];
  endGame(QUALIFIED_IDS[0]);
  wait(5);
  await runJob();

  assert.equal(listDataWrites(docs).length, writes);
  assert.deepEqual(docs.stored.get(nameStartersKey(2026)), starters);
});

test("the qualified starters are saved at once, each one's speed as his side is, and a batch MLB doesn't answer is read on a later run", async () => {
  const { docs, unanswered, runJob, wait } = createRun();
  unanswered.add("/api/v1/people?");
  await runJob();
  const unread = docs.stored.get(nameStartersKey(2026)).starters;
  assert.equal(unread.length, QUALIFIED_IDS.length);
  assert.ok(unread.every((/** @type {any} */ starter) => starter.speed === null));
  assert.equal(docs.stored.get(namePitcherKey(2026, QUALIFIED_IDS[0])), undefined);
  assert.match(docs.stored.get(STATUS_KEY).lastFailure.message, /Reading 2026's pitchers failed/);

  unanswered.clear();
  wait(5);
  await runJob();
  const { starters } = docs.stored.get(nameStartersKey(2026));
  assert.equal(starters.length, QUALIFIED_IDS.length);
  assert.ok(starters.every((/** @type {any} */ starter) => starter.speed > 80));
});

test("each run saves its status, with its requests and how often a sheet still read MLB", async () => {
  const { docs, storage, mlb, runJob, wait } = createRun();
  await runJob();
  const first = docs.stored.get(STATUS_KEY);
  assert.equal(first.ranAt, new Date(NOW).toISOString());
  assert.equal(first.requests, mlb.requests.length);
  assert.equal(first.lastFailure, null);
  assert.equal(first.leagueReads, 0);

  await storage.put("count:leagueReads", 3);
  wait(5);
  await runJob();
  const second = docs.stored.get(STATUS_KEY);
  assert.equal(second.requests, 0);
  assert.equal(second.leagueReads, 3);
});

test("every starter's first read spreads over runs, the qualified starters first", async () => {
  const answers = listAnswers();
  const regular = answers[listAppearancesRequest(2026, "R")];
  const unrecorded = Array.from({ length: 100 }, (_, index) => ({
    player: { id: 900000 + index },
    stat: { gamesPlayed: 1, gamesStarted: 1 },
  }));
  regular.stats[0].splits.unshift(...unrecorded);
  const { docs, mlb, runJob, wait } = createRun({ answers });
  const listPitcherReads = () =>
    mlb.requests.filter((path) => path.startsWith("/api/v1/people?") && /season=2026/.test(path));

  await runJob();
  const firstReads = listPitcherReads();
  assert.equal(firstReads.length, 2 * 4);
  assert.ok(docs.stored.get(nameStartersKey(2026)));

  wait(5);
  await runJob();
  const allReads = listPitcherReads();
  assert.equal(allReads.length, 2 * Math.ceil((RECORDED_IDS.length + 100) / 30));
});

test("one job keeps each store it serves whole, however many there are", async () => {
  const job = createPitcherJob();
  const first = createRun({ job });
  const second = createRun({ job });

  await first.runJob();
  await second.runJob();

  assert.ok(second.docs.stored.get(nameStartersKey(2026)));
  assert.deepEqual([...second.docs.stored.keys()].sort(), [...first.docs.stored.keys()].sort());
});
