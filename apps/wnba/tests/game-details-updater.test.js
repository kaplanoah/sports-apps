import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBoxScoreServer, nameBoxScoreRequest } from "../worker/src/box-score.js";
import { createWnbaGameDetailsJob } from "../worker/src/game-details-updater.js";
import { createLeadServer, nameScoreboardRequest, nameSummaryRequest } from "../worker/src/lead.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
// Valkyries at Wings, Game 2, which the Wings won 108-100 in overtime.
const LEAD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-lead.json`, "utf8"),
);
const MINUTE_MS = 60 * 1000;
const STATUS_KEY = "games/status";

/**
 * The details the job saved, apart from its status.
 * @param {{ writes: string[] }} docs
 */
const listDetailWrites = (docs) => docs.writes.filter((key) => key !== STATUS_KEY);
const VALKYRIES_AT_WINGS = {
  id: "1042600112",
  state: "final",
  start: LEAD.game.start,
  away: { team: "GSV" },
  home: { team: "DAL" },
};
const ACES_AT_FEVER = {
  id: "1042600122",
  state: "final",
  start: "2026-09-29T22:30:00Z",
  away: { team: "LVA" },
  home: { team: "IND" },
};
// Valkyries at Wings ended three hours after it started, and the job first runs a minute later.
const END = Date.parse(LEAD.game.start) + 3 * 60 * MINUTE_MS;
const NOW = END + MINUTE_MS;

/**
 * The league's and ESPN's answers, by request: both games' box scores, and Valkyries at Wings on
 * ESPN, which has no game on Aces at Fever's day.
 * @returns {Record<string, any>}
 */
const listAnswers = () => ({
  [nameBoxScoreRequest(VALKYRIES_AT_WINGS.id)]: GAMES.boxScores[VALKYRIES_AT_WINGS.id],
  [nameBoxScoreRequest(ACES_AT_FEVER.id)]: GAMES.boxScores[ACES_AT_FEVER.id],
  [nameScoreboardRequest(VALKYRIES_AT_WINGS.start)]: LEAD.scoreboard,
  [nameSummaryRequest(LEAD.eventId)]: LEAD.summary,
  [nameScoreboardRequest(ACES_AT_FEVER.start)]: { events: [] },
});

/**
 * Answers each request from `answers`, recording it, or refuses it.
 * @param {(url: string) => any} answer
 */
function createLeagueFetch(answer) {
  /** @type {string[]} */
  const requests = [];
  /** @param {string} url */
  const fetchImpl = async (url) => {
    requests.push(url);
    const body = answer(url);
    return body === undefined
      ? new Response("Not found", { status: 404 })
      : new Response(JSON.stringify(body));
  };
  return { requests, fetchImpl };
}

/**
 * A store whose current season is 2026, keeping `seasons`, with each season's playoff games and any
 * nearest games, and the job that keeps its finals' details, run as the store runs it.
 * @param {{ seasons?: Record<number, any[]>, nearest?: Record<number, any[]>, answer?: (url: string) => any }} [options]
 */
function createRun({
  seasons = { 2026: [{ ...VALKYRIES_AT_WINGS, end: new Date(END).toISOString() }, ACES_AT_FEVER] },
  nearest = {},
  answer = (url) => listAnswers()[url],
} = {}) {
  const docs = createDocs({
    "live/current": { season: 2026 },
    ...Object.fromEntries(
      Object.entries(seasons).map(([year, games]) => [
        `seasons/${year}`,
        { year: Number(year), games, ...(nearest[year] && { nearestGames: nearest[year] }) },
      ]),
    ),
  });
  const storage = createJobStorage();
  const league = createLeagueFetch(answer);
  const clock = { now: NOW };
  const job = createWnbaGameDetailsJob();
  const runJob = () =>
    job.updateStore({
      docs,
      storage,
      loadSnapshot: async () => null,
      env: {},
      fetchImpl: league.fetchImpl,
      now: () => clock.now,
    });
  /** @param {number} minutes */
  const wait = (minutes) => {
    clock.now += minutes * MINUTE_MS;
  };
  /** Takes the requests made since the last take. */
  const takeRequests = () => league.requests.splice(0);
  return { docs, storage, runJob, wait, takeRequests };
}

/** @param {string} id */
const listGameRequests = (id) => {
  const game = [VALKYRIES_AT_WINGS, ACES_AT_FEVER].find((each) => each.id === id);
  const requests = [nameBoxScoreRequest(id), nameScoreboardRequest(game?.start ?? "")];
  return id === VALKYRIES_AT_WINGS.id ? [...requests, nameSummaryRequest(LEAD.eventId)] : requests;
};

/**
 * What the Worker answers for a route, from the store when `docs` is given, or from the league,
 * with the requests it made.
 * @param {"box-score" | "lead"} route
 * @param {Record<string, string>} params
 * @param {any} [docs]
 */
async function askWorker(route, params, docs) {
  const league = createLeagueFetch((url) => listAnswers()[url]);
  const url = new URL(`https://wnba.test/${route}?${new URLSearchParams(params)}`);
  const readDoc = docs && ((/** @type {string} */ key) => docs.read(key));
  const response =
    route === "box-score"
      ? await createBoxScoreServer({ fetchImpl: league.fetchImpl }).serveBoxScore(url, readDoc)
      : await createLeadServer({ fetchImpl: league.fetchImpl }).serveLead(url, readDoc);
  return { status: response.status, body: await response.json(), requests: league.requests };
}

test("a final's box score and lead from the store are the ones the league and ESPN answer, and read nothing", async () => {
  const { docs, runJob, wait } = createRun();
  await runJob();
  wait(10);
  await runJob();

  for (const game of [VALKYRIES_AT_WINGS, ACES_AT_FEVER]) {
    const fromStore = await askWorker("box-score", { id: game.id }, docs);
    const fromLeague = await askWorker("box-score", { id: game.id });
    assert.equal(fromStore.status, 200);
    assert.deepEqual(fromStore.body, fromLeague.body);
    assert.deepEqual(fromStore.requests, []);
  }
  const lead = {
    id: VALKYRIES_AT_WINGS.id,
    away: "GSV",
    home: "DAL",
    start: VALKYRIES_AT_WINGS.start,
  };
  const fromStore = await askWorker("lead", lead, docs);
  const fromEspn = await askWorker("lead", lead);
  assert.equal(fromStore.status, 200);
  assert.deepEqual(fromStore.body, fromEspn.body);
  assert.deepEqual(fromStore.requests, []);
});

test("a game that just ended is read at once, again once the league and ESPN have caught up, and never after", async () => {
  const { docs, runJob, wait, takeRequests } = createRun({
    seasons: { 2026: [{ ...VALKYRIES_AT_WINGS, end: new Date(END).toISOString() }] },
  });

  await runJob();
  assert.deepEqual(takeRequests(), listGameRequests(VALKYRIES_AT_WINGS.id));
  wait(5);
  await runJob();
  assert.deepEqual(takeRequests(), []);
  wait(5);
  await runJob();
  assert.deepEqual(takeRequests(), listGameRequests(VALKYRIES_AT_WINGS.id));
  assert.deepEqual(
    listDetailWrites(docs),
    [`games/${VALKYRIES_AT_WINGS.id}`],
    "nothing changed to save",
  );
  for (const minutes of [10, 60, 24 * 60]) {
    wait(minutes);
    await runJob();
    assert.deepEqual(takeRequests(), []);
  }
});

test("a game the store never saw live is kept from its first read", async () => {
  const { runJob, wait, takeRequests } = createRun({ seasons: { 2026: [ACES_AT_FEVER] } });

  await runJob();
  assert.deepEqual(takeRequests(), listGameRequests(ACES_AT_FEVER.id));
  wait(10);
  await runJob();
  assert.deepEqual(takeRequests(), []);
});

test("a run that finds nothing new reads nothing from the league and saves nothing", async () => {
  const { docs, runJob, wait, takeRequests } = createRun();
  await runJob();
  wait(10);
  await runJob();
  takeRequests();
  const writes = listDetailWrites(docs).length;

  wait(10);
  await runJob();

  assert.deepEqual(takeRequests(), []);
  assert.equal(listDetailWrites(docs).length, writes);
});

test("a game still to start or being played is left to the pages watching it", async () => {
  const { docs, runJob, takeRequests } = createRun({
    seasons: {
      2026: [
        { ...VALKYRIES_AT_WINGS, state: "live" },
        { ...ACES_AT_FEVER, state: "pre" },
      ],
    },
  });

  await runJob();

  assert.deepEqual(takeRequests(), []);
  assert.deepEqual(listDetailWrites(docs), []);
});

/**
 * A season's finals, one a day from September 10, newest last.
 * @param {number} year
 * @param {number} count
 */
const listFinals = (year, count) =>
  Array.from({ length: count }, (_, index) => ({
    ...ACES_AT_FEVER,
    id: `10${year % 100}${String(index).padStart(6, "0")}`,
    start: `${year}-09-${String(index + 10).padStart(2, "0")}T23:00:00Z`,
  }));

test("finals fill a few a run, newest first, the current season's and then each season's the store keeps from before", async () => {
  const { runJob, wait, takeRequests } = createRun({
    seasons: { 2026: listFinals(2026, 6), 2025: listFinals(2025, 3) },
    answer: (url) =>
      url.includes("/boxscore/") ? GAMES.boxScores[ACES_AT_FEVER.id] : { events: [] },
  });
  const readBoxScores = () =>
    takeRequests()
      .filter((url) => url.includes("/boxscore/"))
      .map((url) => url.match(/boxscore_(\d+)/)?.[1]);

  const runs = [];
  for (let run = 0; run < 4; run += 1) {
    await runJob();
    runs.push(readBoxScores());
    wait(2);
  }

  assert.deepEqual(runs, [
    ["1026000005", "1026000004", "1026000003", "1026000002"],
    ["1026000001", "1026000000", "1025000002", "1025000001"],
    ["1025000000"],
    [],
  ]);
});

test("each team's last game is kept too, from the regular season as from the playoffs, and a game in both is read once", async () => {
  const seattlesLast = {
    ...ACES_AT_FEVER,
    id: "1022600325",
    start: "2026-09-24T02:00:00Z",
    away: { team: "DAL" },
    home: { team: "SEA" },
  };
  const { docs, runJob, takeRequests } = createRun({
    seasons: { 2026: [ACES_AT_FEVER] },
    nearest: { 2026: [seattlesLast, ACES_AT_FEVER] },
    answer: (url) =>
      url.includes("/boxscore/") ? GAMES.boxScores[ACES_AT_FEVER.id] : { events: [] },
  });

  await runJob();

  const boxScores = takeRequests().filter((url) => url.includes("/boxscore/"));
  assert.deepEqual(boxScores, [
    nameBoxScoreRequest(ACES_AT_FEVER.id),
    nameBoxScoreRequest(seattlesLast.id),
  ]);
  assert.ok(docs.stored.has(`games/${seattlesLast.id}`));
});

test("a read that fails keeps what was saved, and is tried again every ten minutes for two hours", async () => {
  let isLeagueDown = false;
  const { docs, runJob, wait, takeRequests } = createRun({
    seasons: { 2026: [{ ...VALKYRIES_AT_WINGS, end: new Date(END).toISOString() }] },
    answer: (url) => (isLeagueDown ? undefined : listAnswers()[url]),
  });
  await runJob();
  const saved = await docs.read(`games/${VALKYRIES_AT_WINGS.id}`);
  assert.equal(saved.boxScore.state, "final");
  assert.equal(saved.lead.isOver, true);
  takeRequests();

  isLeagueDown = true;
  /** @type {number[]} */
  const readAt = [];
  for (let minutes = 0; minutes <= 3 * 60; minutes += 5) {
    wait(5);
    await runJob();
    if (takeRequests().length) readAt.push(minutes + 5);
  }

  assert.deepEqual(readAt, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  assert.deepEqual(await docs.read(`games/${VALKYRIES_AT_WINGS.id}`), saved);
});

test("a box score the league answers is kept while ESPN doesn't answer", async () => {
  const { docs, runJob } = createRun({
    seasons: { 2026: [ACES_AT_FEVER] },
    answer: (url) => (url.includes("espn") ? undefined : listAnswers()[url]),
  });

  await runJob();

  const saved = await docs.read(`games/${ACES_AT_FEVER.id}`);
  assert.equal(saved.boxScore.home.score, 99);
  assert.equal(saved.lead, null);
});

test("only a season's finals keep their reads, so a team's game no longer among its nearest leaves them", async () => {
  const seattlesLast = { ...ACES_AT_FEVER, id: "1022600325", start: "2026-09-24T02:00:00Z" };
  const { docs, storage, runJob, wait } = createRun({
    seasons: { 2026: [ACES_AT_FEVER] },
    nearest: { 2026: [seattlesLast] },
  });
  await runJob();
  assert.deepEqual(
    Object.keys(storage.stored.get("final-reads:2026")).sort(),
    [ACES_AT_FEVER.id, seattlesLast.id].sort(),
  );

  const season = await docs.read("seasons/2026");
  await docs.write("seasons/2026", { ...season, nearestGames: [] });
  wait(10);
  await runJob();

  assert.deepEqual(Object.keys(storage.stored.get("final-reads:2026")), [ACES_AT_FEVER.id]);
});

test("the reads the WNBA's own job kept are taken as the shared job's, so no final is read again, and then forgotten", async () => {
  const { storage, runJob, takeRequests } = createRun();
  const doneRead = { firstReadAt: 0, readAt: 0, isDone: true };
  await storage.put("reads:2026", {
    [VALKYRIES_AT_WINGS.id]: doneRead,
    [ACES_AT_FEVER.id]: doneRead,
  });

  await runJob();

  assert.deepEqual(takeRequests(), []);
  assert.equal(storage.stored.has("reads:2026"), false);
  assert.deepEqual(
    Object.keys(storage.stored.get("final-reads:2026")).sort(),
    [ACES_AT_FEVER.id, VALKYRIES_AT_WINGS.id].sort(),
  );
});

test("a past season whose every final is read isn't looked through again", async () => {
  const { docs, runJob, wait, takeRequests } = createRun({
    seasons: { 2026: [], 2025: listFinals(2025, 1) },
    answer: (url) =>
      url.includes("/boxscore/") ? GAMES.boxScores[ACES_AT_FEVER.id] : { events: [] },
  });
  await runJob();
  assert.ok(takeRequests().length > 0);

  const season = await docs.read("seasons/2025");
  await docs.write("seasons/2025", { ...season, games: listFinals(2025, 2) });
  wait(10);
  await runJob();

  assert.deepEqual(takeRequests(), []);
});

test("each run saves its status: when it ran, how many requests it made, and a read that failed", async () => {
  let isLeagueDown = true;
  const { docs, runJob, wait } = createRun({
    seasons: { 2026: [ACES_AT_FEVER] },
    answer: (url) => (isLeagueDown ? undefined : listAnswers()[url]),
  });

  await runJob();
  const failed = await docs.read(STATUS_KEY);
  assert.equal(failed.ranAt, new Date(NOW).toISOString());
  assert.equal(failed.requests, 2);
  assert.match(failed.lastFailure.message, /^Reading game 1042600122's details failed: /);

  isLeagueDown = false;
  wait(10);
  await runJob();
  const read = await docs.read(STATUS_KEY);
  assert.equal(read.ranAt, new Date(NOW + 10 * MINUTE_MS).toISOString());
  assert.equal(read.requests, 2);
  assert.deepEqual(read.lastFailure, failed.lastFailure);
});
