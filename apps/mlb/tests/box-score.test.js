import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createBoxScoreServer } from "../worker/src/box-score.js";
import {
  describeBoxScore,
  nameFeedRequest,
  nameGameDetailsKey,
} from "../worker/src/adapters/box-score.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";

// MLB's live feed for each of the Division Series' games on the evening of Oct 7, trimmed to what
// the box score reads: two finals, two being played, and three still to start, two of them with
// their lineups posted.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-games.json`, "utf8"),
);
const MLB_API = "https://statsapi.mlb.com";
const DODGERS_AT_BRAVES = "849819";
const GUARDIANS_AT_WHITE_SOX = "849833";
const RAYS_AT_YANKEES = "849838";
const TOMORROWS_GUARDIANS_AT_WHITE_SOX = "849832";

// MLB's live feed for NLCS Game 1 as it stood with one out in the top of the 3rd, and for ALDS
// Game 4 once it was final, trimmed to what the box score reads, plays and all.
const PLAYS = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-11-plays.json`, "utf8"),
);
const DODGERS_AT_BREWERS = "849809";
const GUARDIANS_AT_WHITE_SOX_FINAL = "849832";

/** @param {string} id */
const describeGame = (id) => describeBoxScore(id, GAMES.feeds[id]);

/** @param {string} id */
const readPlaysFeed = (id) => structuredClone(PLAYS.feeds[id]);

/** @param {{ isDown?: boolean }} [options] */
function createMlbFetch({ isDown = false } = {}) {
  /** @type {string[]} */
  const requests = [];
  /** @param {string} url */
  const fetchImpl = async (url) => {
    const path = url.slice(MLB_API.length);
    requests.push(path);
    const id = /\/game\/(\d+)\//.exec(path)?.[1] ?? "";
    if (isDown || path !== nameFeedRequest(id) || !GAMES.feeds[id])
      return new Response("", { status: 503 });
    return new Response(JSON.stringify(GAMES.feeds[id]));
  };
  return { requests, fetchImpl };
}

/**
 * What the Worker answers for a game's box score, with the requests it made of MLB.
 * @param {string} id
 * @param {{ kept?: Record<string, any>, isDown?: boolean }} [options]
 */
async function askForBoxScore(id, { kept, isDown } = {}) {
  const mlb = createMlbFetch({ isDown });
  const server = createBoxScoreServer({ fetchImpl: mlb.fetchImpl });
  const readDoc = kept && (async (/** @type {string} */ key) => kept[key] ?? null);
  const url = new URL(`https://mlb.test/box-score?id=${encodeURIComponent(id)}`);
  const response = await server.serveBoxScore(url, readDoc);
  return { status: response.status, body: await response.json(), requests: mlb.requests };
}

test("a final's box score has each inning's runs, each club's runs, hits, and errors, and every batter and pitcher", () => {
  const boxScore = describeGame(DODGERS_AT_BRAVES);

  assert.equal(boxScore.state, "final");
  assert.deepEqual(
    boxScore.innings.map((/** @type {any} */ inning) => [inning.away, inning.home]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
      [3, 0],
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(boxScore.totals, {
    away: { runs: 3, hits: 8, errors: 0 },
    home: { runs: 1, hits: 5, errors: 2 },
  });
  assert.deepEqual(boxScore.away.batters[0], {
    id: 605141,
    name: "Betts",
    position: "SS",
    isSub: false,
    atBats: 5,
    runs: 0,
    hits: 2,
    rbi: 0,
    walks: 0,
    strikeOuts: 1,
  });
  assert.deepEqual(
    boxScore.away.pitchers.map((/** @type {any} */ pitcher) => [
      pitcher.name,
      pitcher.decision,
      pitcher.inningsPitched,
      pitcher.pitches,
    ]),
    [
      ["Yamamoto", "W", "7.0", 98],
      ["Scott", null, "1.0", 19],
      ["Díaz", "S", "1.0", 19],
    ],
  );
  assert.equal(boxScore.home.pitchers[0].decision, "L");
});

test("the box score asks MLB for each pitcher's pitches, which count up as a game is played", () => {
  const fields = new URL(nameFeedRequest(DODGERS_AT_BREWERS), MLB_API).searchParams.get("fields");
  assert.ok(fields?.split(",").includes("numberOfPitches"));
  const boxScore = describeBoxScore(DODGERS_AT_BREWERS, readPlaysFeed(DODGERS_AT_BREWERS));
  assert.deepEqual(
    [boxScore.away, boxScore.home].map((side) => side.pitchers[0].pitches),
    [29, 60],
  );
});

test("a sub bats after the batter he replaced", () => {
  const batters = describeGame(DODGERS_AT_BRAVES).away.batters.map(
    (/** @type {any} */ batter) => `${batter.name}${batter.isSub ? " (sub)" : ""}`,
  );
  assert.deepEqual(batters.slice(2, 5), ["Hernández, T", "Muncy (sub)", "Smith, W"]);
});

test("a game being played has no runs yet for the half inning still to come", () => {
  const boxScore = describeGame(GUARDIANS_AT_WHITE_SOX);
  assert.equal(boxScore.state, "live");
  assert.deepEqual(boxScore.innings.at(-1), { away: 2, home: null });
});

/**
 * One play of a half inning, a batter who got on unless it says otherwise.
 * @param {string} batter
 * @param {string} event
 * @param {Record<string, any>} [play]
 */
const createPlay = (batter, event, play) => ({
  batter,
  event,
  reached: true,
  filledBases: false,
  scorers: [],
  score: null,
  ...play,
});

test("a game being played has each half inning that scored so far, with who got on and who scored, and who's on base, how each got there, and who's up", () => {
  const boxScore = describeBoxScore(DODGERS_AT_BREWERS, readPlaysFeed(DODGERS_AT_BREWERS));

  assert.deepEqual(boxScore.scoringHalves, [
    {
      side: "away",
      inning: 2,
      plays: [
        createPlay("Ohtani", "Walk"),
        createPlay("Hern\u00e1ndez", "Single"),
        createPlay("Pages", "Single", {
          scorers: [{ name: "Ohtani", event: "Single", pinchRunnerFor: null }],
          score: { away: 1, home: 0 },
        }),
        createPlay("Tucker", "Walk", { filledBases: true }),
      ],
    },
  ]);
  assert.deepEqual(boxScore.bases, {
    half: "top",
    inning: 3,
    outs: 1,
    runners: [{ base: "1B", name: "Betts", reached: "Single", pinchRunnerFor: null }],
    batter: "Smith",
    pitcher: "Misiorowski",
  });
});

test("a final has every half inning that scored in the order they came, a homer's batter not among those he drove in, and no one on base", () => {
  const boxScore = describeBoxScore(
    GUARDIANS_AT_WHITE_SOX_FINAL,
    readPlaysFeed(GUARDIANS_AT_WHITE_SOX_FINAL),
  );
  const [bottomOfThird, topOfFifth] = boxScore.scoringHalves;

  assert.deepEqual(
    boxScore.scoringHalves.map((/** @type {any} */ half) => [half.side, half.inning]),
    [
      ["home", 3],
      ["away", 5],
      ["home", 5],
      ["away", 6],
      ["home", 9],
    ],
  );
  assert.deepEqual(bottomOfThird.plays, [
    createPlay("Montgomery", "Single"),
    createPlay("Meidroth", "Double"),
    createPlay("Vargas", "Walk", { filledBases: true }),
    createPlay("Murakami", "Walk", {
      scorers: [{ name: "Montgomery", event: "Walk", pinchRunnerFor: null }],
      score: { away: 0, home: 1 },
    }),
    createPlay("Antonacci", "Sac Fly", {
      reached: false,
      scorers: [{ name: "Meidroth", event: "Sac Fly", pinchRunnerFor: null }],
      score: { away: 0, home: 2 },
    }),
  ]);
  assert.deepEqual(topOfFifth.plays, [
    createPlay("Bailey", "Home Run", { reached: false, score: { away: 1, home: 2 } }),
    createPlay("Kwan", "Single"),
    createPlay("Ram\u00edrez", "Home Run", {
      reached: false,
      scorers: [{ name: "Kwan", event: "Home Run", pinchRunnerFor: null }],
      score: { away: 3, home: 2 },
    }),
  ]);
  assert.equal(boxScore.bases, null);
});

test("a run scored on something during a play other than its result, like a wild pitch, says so", () => {
  const feed = readPlaysFeed(GUARDIANS_AT_WHITE_SOX_FINAL);
  const walk = feed.liveData.plays.allPlays.find(
    (/** @type {any} */ play) => play.about.isScoringPlay && play.result.event === "Walk",
  );
  const scorer = walk.runners.find((/** @type {any} */ runner) => runner.movement.end === "score");
  scorer.details.event = "Wild Pitch";

  const [bottomOfThird] = describeBoxScore(GUARDIANS_AT_WHITE_SOX_FINAL, feed).scoringHalves;

  assert.deepEqual(bottomOfThird.plays[3].scorers, [
    { name: "Montgomery", event: "Wild Pitch", pinchRunnerFor: null },
  ]);
});

test("a pinch runner leaves no one behind on the base he took over, so the bases load only when they fill", () => {
  const feed = readPlaysFeed(GUARDIANS_AT_WHITE_SOX_FINAL);
  const montgomery = 695657;
  const pinchRunner = 999999;
  const [single, ...rest] = feed.liveData.plays.allPlays.filter(
    (/** @type {any} */ play) => play.about.inning === 3 && play.about.halfInning === "bottom",
  );
  assert.equal(single.matchup.batter.id, montgomery);
  for (const runner of rest.flatMap((/** @type {any} */ play) => play.runners))
    if (runner.details.runner.id === montgomery) runner.details.runner.id = pinchRunner;

  const [bottomOfThird] = describeBoxScore(GUARDIANS_AT_WHITE_SOX_FINAL, feed).scoringHalves;

  assert.deepEqual(
    bottomOfThird.plays.map((/** @type {any} */ play) => [play.batter, play.filledBases]),
    [
      ["Montgomery", false],
      ["Meidroth", false],
      ["Vargas", true],
      ["Murakami", false],
      ["Antonacci", false],
    ],
  );
});

test("a runner whose way on the half inning's plays don't say, like a pinch runner, is on his base without it", () => {
  const feed = readPlaysFeed(DODGERS_AT_BREWERS);
  const { linescore } = feed.liveData;
  linescore.offense.first.id = linescore.offense.batter.id;

  const { runners } = describeBoxScore(DODGERS_AT_BREWERS, feed).bases;

  assert.deepEqual(runners, [{ base: "1B", name: "Smith", reached: null, pinchRunnerFor: null }]);
});

test("between halves of an inning no one is on base, the third out still counts, and the next half's leadoff man is due up", () => {
  const feed = readPlaysFeed(DODGERS_AT_BREWERS);
  const { linescore } = feed.liveData;
  linescore.inningState = "Middle";
  linescore.outs = 3;
  delete linescore.offense.first;

  assert.deepEqual(describeBoxScore(DODGERS_AT_BREWERS, feed).bases, {
    half: "middle",
    inning: 3,
    outs: 3,
    runners: [],
    batter: "Smith",
    pitcher: "Misiorowski",
  });
});

test("a feed without plays says nothing of how the runs scored", () => {
  assert.equal(describeGame(GUARDIANS_AT_WHITE_SOX).scoringHalves, null);
});

test("before first pitch, a club's posted lineup has each batter's season so far, and there are no innings or pitchers", () => {
  const boxScore = describeGame(RAYS_AT_YANKEES);

  assert.equal(boxScore.state, "pre");
  assert.deepEqual(boxScore.innings, []);
  assert.equal(boxScore.away.batters.length, 9);
  assert.deepEqual(boxScore.away.batters[0], {
    id: 650490,
    name: "Díaz, Y",
    position: "DH",
    average: ".293",
    homeRuns: 22,
    rbi: 85,
  });
  assert.deepEqual([boxScore.away.pitchers, boxScore.home.pitchers], [[], []]);
});

test("a game in warmup, which MLB's feed reads as live with its leadoff man up, is still before first pitch", () => {
  const feed = structuredClone(GAMES.feeds[RAYS_AT_YANKEES]);
  feed.gameData.status = {
    abstractGameState: "Live",
    codedGameState: "P",
    detailedState: "Warmup",
  };
  Object.assign(feed.liveData.linescore, {
    currentInning: 1,
    inningState: "Top",
    outs: 0,
    offense: { batter: { id: 650490 } },
    defense: { pitcher: { id: 543037 } },
  });

  const boxScore = describeBoxScore(RAYS_AT_YANKEES, feed);

  assert.equal(boxScore.state, "pre");
  assert.deepEqual(boxScore.innings, []);
  assert.equal(boxScore.away.batters.length, 9);
  assert.equal(boxScore.scoringHalves, null);
  assert.equal(boxScore.bases, null);
});

test("a game whose clubs haven't posted their lineups has no batters", () => {
  const boxScore = describeGame(TOMORROWS_GUARDIANS_AT_WHITE_SOX);
  assert.deepEqual([boxScore.away.batters, boxScore.home.batters], [[], []]);
});

test("a final the store keeps is served as it is, without reading MLB", async () => {
  const kept = { [nameGameDetailsKey(DODGERS_AT_BRAVES)]: describeGame(DODGERS_AT_BRAVES) };

  const answer = await askForBoxScore(DODGERS_AT_BRAVES, { kept });

  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, describeGame(DODGERS_AT_BRAVES));
  assert.deepEqual(answer.requests, []);
});

test("a game the store has no final for is read from MLB", async () => {
  const kept = {
    [nameGameDetailsKey(GUARDIANS_AT_WHITE_SOX)]: {
      ...describeGame(GUARDIANS_AT_WHITE_SOX),
      innings: [],
    },
  };

  const answer = await askForBoxScore(GUARDIANS_AT_WHITE_SOX, { kept });

  assert.deepEqual(answer.body, describeGame(GUARDIANS_AT_WHITE_SOX));
  assert.deepEqual(answer.requests, [nameFeedRequest(GUARDIANS_AT_WHITE_SOX)]);
});

test("a request that names no game is refused, and MLB not answering says so", async () => {
  await assertErrorAnswer(await askForBoxScore("not-a-game"), 400, "invalid_argument");
  const answer = await askForBoxScore(RAYS_AT_YANKEES, { isDown: true });
  assert.match(await assertErrorAnswer(answer, 502, "upstream_error"), /^Couldn't read MLB: /);
});

test("box scores request the feed's game and season and retain its explicit season", () => {
  const feed = structuredClone(GAMES.feeds[DODGERS_AT_BRAVES]);
  feed.gameData.game = { season: "2026" };
  assert.equal(describeBoxScore(DODGERS_AT_BRAVES, feed).season, 2026);
  const fields = new URL(nameFeedRequest(DODGERS_AT_BRAVES), "https://example.test").searchParams
    .get("fields")
    .split(",");
  assert.ok(fields.includes("game"));
  assert.ok(fields.includes("season"));
});
