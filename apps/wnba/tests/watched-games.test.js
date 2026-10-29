import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { namePlayerIndexKey } from "#shared/page-search.js";
import { describeBoxScore, nameBoxScoreRequest } from "../worker/src/box-score.js";
import { nameScoreboardRequest, nameSummaryRequest } from "../worker/src/lead.js";
import { createWatchedGameLoader } from "../worker/src/watched-games.js";
import { readPlayerIndex } from "./player-fixtures.js";

const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
// Valkyries at Wings, Game 2, which went to overtime.
const LEAD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-lead.json`, "utf8"),
);
// The same game's summary on ESPN, with its box score.
const ESPN = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-29-espn-box-scores.json`, "utf8"),
);
const ID = "1042600112";
const liveBoxScore = structuredClone(GAMES.boxScores[ID]);
Object.assign(liveBoxScore.game, { gameStatus: 2, period: 3 });

/** @param {string} state */
const createGame = (state) => ({
  id: ID,
  state,
  away: { team: "GSV" },
  home: { team: "DAL" },
  start: LEAD.game.start,
});

/** @param {string} state */
const createSnapshot = (state) => ({ games: [createGame(state)], nearestGames: [] });

/** @param {{ refuse?: boolean, answers?: Record<string, any> }} [options] */
function createLoader({
  refuse = false,
  answers = {
    [nameBoxScoreRequest(ID)]: liveBoxScore,
    [nameScoreboardRequest(LEAD.game.start)]: LEAD.scoreboard,
    [nameSummaryRequest(LEAD.eventId)]: LEAD.summary,
  },
} = {}) {
  const reads = [];
  const fetchImpl = async (url) => {
    reads.push(url);
    if (refuse || !(url in answers)) return new Response("", { status: 503 });
    return new Response(JSON.stringify(answers[url]));
  };
  return { reads, loadWatchedGame: createWatchedGameLoader({ fetchImpl }) };
}

test("a live game's details are its box score and its lead", async () => {
  const { loadWatchedGame } = createLoader();
  const details = await loadWatchedGame(ID, createSnapshot("live"), null);
  assert.deepEqual(details.boxScore, describeBoxScore(liveBoxScore));
  assert.equal(details.lead.periods, 5);
});

test("a team's nearest game is watched like a playoff game", async () => {
  const { loadWatchedGame } = createLoader();
  const snapshot = { games: [], nearestGames: [createGame("live")] };
  const details = await loadWatchedGame(ID, snapshot, null);
  assert.deepEqual(details.boxScore, describeBoxScore(liveBoxScore));
});

test("a game that hasn't started, or whose final box score is saved, needs no reads", async () => {
  const { reads, loadWatchedGame } = createLoader();
  assert.equal(await loadWatchedGame(ID, createSnapshot("pre"), null), null);
  const saved = { boxScore: { state: "final" }, lead: null };
  assert.equal(await loadWatchedGame(ID, createSnapshot("final"), saved), null);
  assert.equal(await loadWatchedGame("1042600999", createSnapshot("live"), null), null);
  assert.deepEqual(reads, []);
});

test("while the league refuses a live game's box score, it comes from ESPN's, read with the lead from one summary", async () => {
  const { eventId, scoreboard, summary } = ESPN.games[ID];
  const { reads, loadWatchedGame } = createLoader({
    answers: {
      [nameScoreboardRequest(LEAD.game.start)]: scoreboard,
      [nameSummaryRequest(eventId)]: summary,
    },
  });
  const readDoc = async (/** @type {string} */ key) =>
    key === namePlayerIndexKey(2026) ? readPlayerIndex() : null;

  const details = await loadWatchedGame(ID, createSnapshot("live"), null, readDoc);

  const fromLeague = describeBoxScore(GAMES.boxScores[ID]);
  /** @param {any} box */
  const listIds = (box) => [...box.away.players, ...box.home.players].map(({ id }) => id).sort();
  assert.deepEqual(
    [details.boxScore.away.score, listIds(details.boxScore)],
    [fromLeague.away.score, listIds(fromLeague)],
  );
  assert.equal(details.lead.periods, 5);
  assert.equal(reads.filter((url) => url === nameSummaryRequest(eventId)).length, 1);
});

test("a read that fails keeps the details saved", async () => {
  const { loadWatchedGame } = createLoader({ refuse: true });
  const saved = { boxScore: { state: "live", away: {}, home: {} }, lead: { periods: 4 } };
  assert.deepEqual(await loadWatchedGame(ID, createSnapshot("live"), saved), saved);
});
