import test from "node:test";
import assert from "node:assert/strict";
import { createPitcherServer } from "../worker/src/pitchers.js";
import {
  composePitcher,
  describePitcher,
  describeStarters,
  listGameLogRequest,
  listPeopleRequest,
  listQualifiedRequest,
  readSpeeds,
} from "../worker/src/adapters/pitchers.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";

const NOW = Date.parse("2026-09-30T16:00:00Z");

const describeLine = (id, gamesStarted, inningsPitched, era, k9, bb9) => ({
  player: { id },
  stat: {
    gamesStarted,
    inningsPitched,
    era,
    strikeoutsPer9Inn: String(k9),
    walksPer9Inn: String(bb9),
  },
});
const describeArsenal = (pitches) => ({
  type: { displayName: "pitchArsenal" },
  splits: pitches.map(([code, percentage, averageSpeed]) => ({
    stat: { percentage, averageSpeed, type: { code, description: code } },
  })),
});

// Four qualified starters; pitcher 5, with two starts, isn't one.
const QUALIFIED = {
  stats: [
    {
      splits: [
        describeLine(1, 30, "184.2", "1.95", 11.1, 2.3),
        describeLine(2, 26, "160.1", "3.03", 10.4, 2.4),
        describeLine(3, 22, "158.0", "3.03", 6.8, 2.8),
        describeLine(4, 15, "162.0", "4.50", 8.0, 3.5),
      ],
    },
  ],
};
const SEASON_LINES = [...QUALIFIED.stats[0].splits, describeLine(5, 2, "10.0", "0.90", 12.0, 1.0)];
const ARSENALS = {
  1: [
    ["FF", 0.44, 98.0],
    ["SI", 0.19, 97.8],
  ],
  2: [
    ["FF", 0.45, 96.1],
    ["CU", 0.09, 82.9],
  ],
  3: [
    ["SI", 0.3, 93.2],
    ["FF", 0.2, 94.3],
  ],
  4: [["FC", 0.6, 89.0]],
  5: [["FF", 0.7, 95.0]],
};

const describePerson = (
  id,
  pitches = ARSENALS[id],
  line = SEASON_LINES.find((row) => row.player.id === id)?.stat,
) => ({
  id,
  useName: "Pitcher",
  useLastName: `Number ${id} Jr.`,
  birthDate: "2001-10-01",
  pitchHand: { code: "R" },
  stats: [
    { type: { displayName: "season" }, splits: line ? [{ stat: line }] : [] },
    describeArsenal(pitches ?? []),
  ],
});
const describeStart = (date, gamesStarted, opponent, runs = 1) => ({
  date,
  isHome: false,
  opponent: { id: opponent },
  stat: { gamesStarted, inningsPitched: "6.0", runs, strikeOuts: 5, numberOfPitches: 92 },
});
const GAME_LOG = {
  id: 1,
  stats: [
    {
      splits: [
        describeStart("2026-09-13", 1, 121),
        describeStart("2026-09-19", 1, 109),
        describeStart("2026-09-21", 0, 139),
        describeStart("2026-09-24", 1, 139, 2),
        describeStart("2026-09-29", 1, 111, 0),
      ],
    },
  ],
};
const PEOPLE = [1, 2, 3, 4].map((id) => describePerson(id));
const STARTERS = describeStarters(QUALIFIED, readSpeeds(PEOPLE));

/** @param {any} person */
const composeSide = (person, gameLog = GAME_LOG) =>
  composePitcher(describePitcher(person, gameLog), STARTERS, NOW);

test("a starter ranks among the season's qualified starters, ties sharing a rank", () => {
  assert.deepEqual(
    STARTERS.starters.map((starter) => starter.id),
    [1, 2, 3, 4],
  );
  const pitcher = composeSide(describePerson(2));
  assert.deepEqual(pitcher.ranks, {
    era: { rank: 2, of: 4 },
    k9: { rank: 2, of: 4 },
    bb9: { rank: 2, of: 4 },
    speed: { rank: 2, of: 3 },
  });
  assert.deepEqual(pitcher.line, {
    starts: 26,
    ip: "160.1",
    era: "3.03",
    k9: 10.4,
    bb9: 2.4,
    speed: 96.1,
  });
  assert.equal(pitcher.starters.count, 4);
});

test("a starter's side brings every qualified starter's number in each measure, from the lowest, for the sheet's curves", () => {
  assert.deepEqual(composeSide(describePerson(5)).starters.values, {
    era: [1.95, 3.03, 3.03, 4.5],
    k9: [6.8, 8, 10.4, 11.1],
    bb9: [2.3, 2.4, 2.8, 3.5],
    speed: [93.2, 96.1, 98],
  });
});

test("a pitcher's speed is his most-thrown fastball, a four-seamer or a sinker, to the tenth", () => {
  const speeds = readSpeeds([
    describePerson(3),
    describePerson(4),
    describePerson(6, [["FF", 0.5, 95.04]]),
  ]);
  assert.deepEqual(
    [...speeds],
    [
      [3, 93.2],
      [4, null],
      [6, 95],
    ],
  );
});

test("a pitcher outside the qualified starters has his numbers and innings but no ranks", () => {
  const pitcher = composeSide(describePerson(5));
  assert.equal(pitcher.ranks, null);
  assert.deepEqual(pitcher.line, { starts: 2, ip: "10.0", era: "0.90", k9: 12, bb9: 1, speed: 95 });
});

test("a pitcher yet to pitch this season has no line, and no ranks", () => {
  const pitcher = composeSide(describePerson(6, [], null), { id: 6, stats: [{ splits: [] }] });
  assert.equal(pitcher.line, null);
  assert.equal(pitcher.ranks, null);
  assert.deepEqual(pitcher.pitches, []);
  assert.deepEqual(pitcher.starts, []);
});

test("his age is his years on the league's day", () => {
  assert.equal(composeSide(describePerson(1)).age, 24);
  const birthday = { ...describePerson(1), birthDate: "2001-09-30" };
  assert.equal(composePitcher(describePitcher(birthday, GAME_LOG), STARTERS, NOW).age, 25);
  const lateNight = Date.parse("2026-10-01T03:00:00Z");
  assert.equal(
    composePitcher(describePitcher(describePerson(1), GAME_LOG), STARTERS, lateNight).age,
    24,
  );
});

test("his last three starts come newest first, postseason included, relief outings left out", () => {
  assert.deepEqual(composeSide(describePerson(1)).starts, [
    { date: "2026-09-29", opp: "BOS", home: false, ip: "6.0", runs: 0, k: 5, pitches: 92 },
    { date: "2026-09-24", opp: "TB", home: false, ip: "6.0", runs: 2, k: 5, pitches: 92 },
    { date: "2026-09-19", opp: "ARI", home: false, ip: "6.0", runs: 1, k: 5, pitches: 92 },
  ]);
});

test("each pitch keeps MLB's code and name, with its share and speed rounded", () => {
  const pitcher = composeSide(
    describePerson(1, [
      ["FF", 0.44491944, 98.01831171840368],
      ["CU", 0.09766524, 86.2556325117845],
    ]),
  );
  assert.deepEqual(pitcher.pitches, [
    { code: "FF", name: "FF", share: 0.445, mph: 98 },
    { code: "CU", name: "CU", share: 0.098, mph: 86.3 },
  ]);
});

function createFakeMlb({ status = 200, qualified = QUALIFIED, people = PEOPLE } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { searchParams } = new URL(url);
    let body;
    if (url.includes("/api/v1/stats?")) body = qualified;
    else if (searchParams.get("hydrate").includes("gameLog")) body = { people: [GAME_LOG] };
    else {
      const ids = searchParams.get("personIds").split(",").map(Number);
      const known = [...people, describePerson(5)];
      body = { people: known.filter((person) => ids.includes(person.id)) };
    }
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

function createTestServer(options) {
  const mlb = createFakeMlb(options);
  let now = NOW;
  const server = createPitcherServer({ fetchImpl: mlb.fetchImpl, now: () => now });
  return {
    mlb,
    requestPitcher: (query) =>
      server.servePitcher(new URL(`https://mlb-app.example/k3y/pitcher${query}`), async () => null),
    advanceClock: (milliseconds) => {
      now += milliseconds;
    },
  };
}

const readPath = (call) => call.url.replace("https://statsapi.mlb.com", "");

test("without a store, the route reads MLB for the pitcher, his game log, and the qualified starters, caching each at the edge", async () => {
  const { mlb, requestPitcher } = createTestServer();
  const response = await requestPitcher("?id=5&season=2026");
  assert.equal(response.status, 200);
  const pitcher = await response.json();
  assert.deepEqual([pitcher.firstName, pitcher.lastName], ["Pitcher", "Number 5 Jr."]);
  const cacheFor = (path) => mlb.calls.find((call) => readPath(call) === path)?.init.cf.cacheTtl;
  assert.equal(cacheFor(listPeopleRequest(2026, [5])), 600);
  assert.equal(cacheFor(listGameLogRequest(2026, [5])), 600);
  assert.equal(cacheFor(listQualifiedRequest(2026)), 6 * 60 * 60);
  assert.match(listQualifiedRequest(2026), /playerPool=qualified/);
  assert.equal(cacheFor(listPeopleRequest(2026, [1, 2, 3, 4])), 6 * 60 * 60);
  assert.equal(mlb.calls.length, 4);
});

test("sheets opened the same day rank against one read of the qualified starters", async () => {
  const { mlb, requestPitcher, advanceClock } = createTestServer();
  const countLeagueCalls = () =>
    mlb.calls.filter((call) => call.url.includes("/api/v1/stats?")).length;
  await requestPitcher("?id=1&season=2026");
  await requestPitcher("?id=2&season=2026");
  assert.equal(countLeagueCalls(), 1);
  advanceClock(6 * 60 * 60 * 1000);
  await requestPitcher("?id=1&season=2026");
  assert.equal(countLeagueCalls(), 2);
});

test("an id or season that isn't one is refused before anything is fetched", async () => {
  const { mlb, requestPitcher } = createTestServer();
  for (const query of ["", "?id=abc", "?id=-4", "?id=1.5", "?id=1&season=1800"]) {
    await assertErrorAnswer(await requestPitcher(query), 400, "invalid_argument");
  }
  assert.equal(mlb.calls.length, 0);
});

test("a pitcher MLB doesn't know is not found", async () => {
  const { requestPitcher } = createTestServer();
  await assertErrorAnswer(await requestPitcher("?id=9&season=2026"), 404, "not_found");
});

test("MLB failing is reported", async () => {
  const { requestPitcher } = createTestServer({ status: 503 });
  const response = await requestPitcher("?id=1&season=2026");
  assert.match(
    await assertErrorAnswer(response, 502, "upstream_error"),
    /MLB Stats API answered 503/,
  );
});

test("the speeds of the qualified starters come in batches of 30", async () => {
  const lines = Array.from({ length: 65 }, (_, index) => describeLine(index + 1, 30, "3.00", 8, 3));
  const { mlb, requestPitcher } = createTestServer({
    qualified: { stats: [{ splits: lines }] },
    people: [],
  });
  await requestPitcher("?id=5&season=2026");
  const batches = mlb.calls
    .map((call) => new URL(call.url).searchParams)
    .filter((params) => params.get("hydrate")?.includes("pitchArsenal"))
    .map((params) => params.get("personIds").split(",").length);
  assert.deepEqual(
    batches.sort((first, second) => second - first),
    [30, 30, 5, 1],
  );
});
