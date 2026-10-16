import test from "node:test";
import assert from "node:assert/strict";
import { listGameLogRequest } from "../worker/src/pitchers.js";
import {
  createRotationServer,
  describeClubStarts,
  describeRotation,
  describeRotationPitcher,
  listScheduleRequest,
} from "../worker/src/rotations.js";

const PHILLIES = 143;
const BRAVES = 144;
const RAYS = 139;

const FINAL = { abstractGameState: "Final", codedGameState: "F", detailedState: "Final" };
const IN_PROGRESS = {
  abstractGameState: "Live",
  codedGameState: "I",
  detailedState: "In Progress",
};
const POSTPONED = { abstractGameState: "Final", codedGameState: "D", detailedState: "Postponed" };

const describeGame = (
  officialDate,
  [awayId, awayStarter],
  [homeId, homeStarter],
  status = FINAL,
) => ({
  officialDate,
  status,
  teams: {
    away: { team: { id: awayId }, probablePitcher: awayStarter && { id: awayStarter } },
    home: { team: { id: homeId }, probablePitcher: homeStarter && { id: homeStarter } },
  },
});

// The Phillies' games in the two weeks before Wild Card Game 3.
const SCHEDULE = {
  dates: [
    describeGame("2026-09-20", [PHILLIES, 4], [BRAVES, 95]),
    describeGame("2026-09-25", [RAYS, 90], [PHILLIES, 1]),
    describeGame("2026-09-26", [RAYS, 91], [PHILLIES, 2]),
    describeGame("2026-09-27", [RAYS, 92], [PHILLIES, 3]),
    describeGame("2026-09-29", [PHILLIES, 4], [BRAVES, 93]),
    describeGame("2026-09-30", [PHILLIES, 1], [BRAVES, 94]),
  ].map((game) => ({ games: [game] })),
};

const describeAppearance = (date, gamesStarted, opponent, inningsPitched, numberOfPitches) => ({
  date,
  isHome: false,
  opponent: { id: opponent },
  stat: { gamesStarted, inningsPitched, numberOfPitches },
});
const describePerson = (id, useLastName, code, appearances) => ({
  id,
  useLastName,
  pitchHand: { code },
  stats: [{ splits: appearances }],
});
const GAME_LOGS = {
  people: [
    describePerson(1, "Sánchez", "L", [
      describeAppearance("2026-09-25", 1, RAYS, "7.0", 100),
      describeAppearance("2026-09-30", 1, BRAVES, "6.2", 116),
    ]),
    describePerson(2, "Nola", "R", [describeAppearance("2026-09-26", 1, RAYS, "5.0", 88)]),
    describePerson(3, "Wheeler", "R", [describeAppearance("2026-09-27", 1, RAYS, "6.0", 94)]),
    describePerson(4, "Luzardo", "L", [
      describeAppearance("2026-09-07", 1, BRAVES, "9.0", 109),
      describeAppearance("2026-09-20", 1, BRAVES, "6.0", 91),
      describeAppearance("2026-09-27", 0, RAYS, "1.0", 4),
      describeAppearance("2026-09-29", 1, BRAVES, "5.0", 77),
    ]),
  ],
};

/** @param {string} from */
const describePhilliesStarts = (from) =>
  describeClubStarts({
    club: "PHI",
    from,
    through: "2026-10-11",
    schedule: SCHEDULE,
    pitchers: new Map(
      GAME_LOGS.people.map((person) => [person.id, describeRotationPitcher(person)]),
    ),
  });

test("a club's last starters come most recent first, each with his last start and the rest he'd have", () => {
  const rotation = describeRotation(describePhilliesStarts("2026-09-17"), "2026-10-01");
  assert.deepEqual(
    rotation.starters.map((starter) => [starter.name, starter.start.date, starter.rest]),
    [
      ["Sánchez", "2026-09-30", 0],
      ["Luzardo", "2026-09-29", 1],
      ["Wheeler", "2026-09-27", 3],
      ["Nola", "2026-09-26", 4],
    ],
  );
  assert.deepEqual(rotation.starters[0], {
    id: 1,
    name: "Sánchez",
    hand: "L",
    start: { date: "2026-09-30", ip: "6.2", pitches: 116 },
    rest: 0,
  });
});

test("a relief outing isn't a start, and a start on the game's own day doesn't count yet", () => {
  const rotation = describeRotation(describePhilliesStarts("2026-09-15"), "2026-09-29");
  const luzardo = rotation.starters.find((starter) => starter.name === "Luzardo");
  assert.deepEqual([luzardo.start.date, luzardo.rest], ["2026-09-20", 8]);
});

test("only the last two weeks' games count", () => {
  const rotation = describeRotation(describePhilliesStarts("2026-09-15"), "2026-10-12");
  assert.deepEqual(
    rotation.starters.map((starter) => starter.name),
    ["Sánchez", "Luzardo"],
  );
});

function createFakeMlb({ status = 200, schedule = SCHEDULE } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = url.includes("/api/v1/schedule?") ? schedule : GAME_LOGS;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

function createTestServer(options) {
  const mlb = createFakeMlb(options);
  const server = createRotationServer({ fetchImpl: mlb.fetchImpl });
  return {
    mlb,
    requestRotation: (query) =>
      server.serveRotation(new URL(`https://mlb-app.example/k3y/rotation${query}`)),
  };
}

test("the route reads the club's last two weeks, then the game logs of the pitchers who started them", async () => {
  const { mlb, requestRotation } = createTestServer();
  const response = await requestRotation("?club=PHI&date=2026-10-01");
  assert.equal(response.status, 200);
  const rotation = await response.json();
  assert.deepEqual(
    [rotation.club, rotation.date, rotation.starters.length],
    ["PHI", "2026-10-01", 4],
  );
  assert.deepEqual(
    mlb.calls.map((call) => call.url.replace("https://statsapi.mlb.com", "")),
    [
      listScheduleRequest(PHILLIES, "2026-09-17", "2026-09-30"),
      listGameLogRequest(2026, [1, 2, 3, 4]),
    ],
  );
  assert.match(mlb.calls[1].url, /personIds=1,2,3,4&/);
  assert.ok(mlb.calls.every((call) => call.init.cf.cacheTtl === 600));
});

test("only finished games name a starter, not one under way or postponed, and a club with none has an empty rotation", async () => {
  const schedule = {
    dates: [
      { games: [describeGame("2026-09-29", [PHILLIES, 4], [BRAVES, 93], POSTPONED)] },
      { games: [describeGame("2026-09-30", [PHILLIES, 1], [BRAVES, 94], IN_PROGRESS)] },
    ],
  };
  const { mlb, requestRotation } = createTestServer({ schedule });
  const rotation = await (await requestRotation("?club=PHI&date=2026-10-01")).json();
  assert.deepEqual(rotation.starters, []);
  assert.equal(mlb.calls.length, 1);
});

test("a club or day that isn't one is refused before anything is fetched", async () => {
  const { mlb, requestRotation } = createTestServer();
  for (const query of [
    "",
    "?date=2026-10-01",
    "?club=XYZ&date=2026-10-01",
    "?club=PHI",
    "?club=PHI&date=2026-02-30",
    "?club=PHI&date=10/01/2026",
    "?club=PHI&date=1800-10-01",
  ]) {
    assert.equal((await requestRotation(query)).status, 400, query);
  }
  assert.equal(mlb.calls.length, 0);
});

test("MLB failing is reported", async () => {
  const { requestRotation } = createTestServer({ status: 503 });
  const response = await requestRotation("?club=PHI&date=2026-10-01");
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /MLB Stats API answered 503/);
});
