import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../worker/src/adapters/mlb.js";
import { describeBoxScore, nameFeedRequest } from "../worker/src/adapters/box-score.js";
import { createWatchedGameLoader } from "../worker/src/watched-games.js";

// The season as MLB had it on the evening of Oct 7, and its Division Series games' live feeds.
const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-evening.json`, "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-games.json`, "utf8"),
);
const MLB_API = "https://statsapi.mlb.com";
const SNAPSHOT = buildSnapshot(EVENING.responses, {
  season: EVENING.season,
  now: Date.parse(EVENING.now),
});
const DODGERS_AT_BRAVES = "849819";
const GUARDIANS_AT_WHITE_SOX = "849833";
const RAYS_AT_YANKEES = "849838";
const TOMORROWS_GUARDIANS_AT_WHITE_SOX = "849832";

/** @param {{ isDown?: boolean }} [options] */
function createLoader({ isDown = false } = {}) {
  /** @type {string[]} */
  const requests = [];
  /** @param {string} url */
  const fetchImpl = async (url) => {
    const path = url.slice(MLB_API.length);
    requests.push(path);
    const id = /\/game\/(\d+)\//.exec(path)?.[1] ?? "";
    if (isDown || path !== nameFeedRequest(id)) return new Response("", { status: 503 });
    return new Response(JSON.stringify(GAMES.feeds[id]));
  };
  return { requests, loadWatchedGame: createWatchedGameLoader({ fetchImpl }) };
}

/** @param {string} id */
const describeGame = (id) => describeBoxScore(id, GAMES.feeds[id]);

test("a game being played is read with each update", async () => {
  const { loadWatchedGame } = createLoader();
  const boxScore = await loadWatchedGame(GUARDIANS_AT_WHITE_SOX, SNAPSHOT, null);
  assert.deepEqual(boxScore, describeGame(GUARDIANS_AT_WHITE_SOX));
});

test("today's game still to start is read for its lineups", async () => {
  const { loadWatchedGame } = createLoader();
  const boxScore = await loadWatchedGame(RAYS_AT_YANKEES, SNAPSHOT, null);
  assert.equal(boxScore.away.batters.length, 9);
});

test("a final is read until its final box score is saved", async () => {
  const { requests, loadWatchedGame } = createLoader();
  const boxScore = await loadWatchedGame(DODGERS_AT_BRAVES, SNAPSHOT, null);
  assert.equal(boxScore.state, "final");
  assert.equal(await loadWatchedGame(DODGERS_AT_BRAVES, SNAPSHOT, boxScore), null);
  assert.equal(requests.length, 1);
});

test("a game on a later day, or one the slate doesn't list, needs no reads", async () => {
  const { requests, loadWatchedGame } = createLoader();
  assert.equal(await loadWatchedGame(TOMORROWS_GUARDIANS_AT_WHITE_SOX, SNAPSHOT, null), null);
  assert.equal(await loadWatchedGame("999999", SNAPSHOT, null), null);
  assert.equal(await loadWatchedGame(GUARDIANS_AT_WHITE_SOX, { slate: null }, null), null);
  assert.deepEqual(requests, []);
});

test("a read that fails keeps the box score saved", async () => {
  const { loadWatchedGame } = createLoader({ isDown: true });
  const saved = describeGame(GUARDIANS_AT_WHITE_SOX);
  assert.equal(await loadWatchedGame(GUARDIANS_AT_WHITE_SOX, SNAPSHOT, saved), null);
});
