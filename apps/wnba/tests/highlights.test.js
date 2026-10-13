import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nameScheduleKey } from "../page/js/snapshot.js";
import {
  createHighlightsServer,
  describeHighlights,
  nameHighlightsKey,
} from "../worker/src/highlights.js";
import { createHighlightsUpdater } from "../worker/src/highlights-updater.js";
import { nameScoreboardRequest, nameSummaryRequest } from "../worker/src/lead.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

// Fever at Aces, Game 3 of the first round, which the Aces won 94-83, as ESPN had it the next week.
const RECORDED = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-highlights.json`, "utf8"),
);
const GAME = { id: "1042600123", away: "IND", home: "LVA", start: RECORDED.game.start };

function createEspnFetch() {
  /** @type {string[]} */
  const requests = [];
  const answers = {
    [nameScoreboardRequest(RECORDED.game.start)]: RECORDED.scoreboard,
    [nameSummaryRequest(RECORDED.eventId)]: RECORDED.summary,
  };
  /** @param {string} url */
  const fetchImpl = async (url) => {
    requests.push(url);
    return url in answers
      ? new Response(JSON.stringify(answers[url]))
      : new Response("Not found", { status: 404 });
  };
  return { requests, fetchImpl };
}

/**
 * @param {Record<string, string>} params
 * @param {(key: string) => Promise<any>} [readDoc]
 */
function askForHighlights(params, readDoc) {
  const espn = createEspnFetch();
  const server = createHighlightsServer({ fetchImpl: espn.fetchImpl });
  const url = new URL(`https://wnba.test/highlights?${new URLSearchParams(params)}`);
  return { espn, response: server.serveHighlights(url, readDoc) };
}

test("a game's highlights lead with ESPN's recap video and story", () => {
  const { recap, story } = describeHighlights(GAME.id, RECORDED.summary);

  assert.equal(recap?.title, "Las Vegas Aces vs. Indiana Fever - Game Highlights");
  assert.equal(recap?.length, 69);
  assert.equal(story?.title, RECORDED.summary.article.headline);
  assert.match(story?.lead ?? "", /^LAS VEGAS -- \u2014 A'ja Wilson made sure/);
  assert.equal(story?.url, `https://www.espn.com/wnba/recap?gameId=${RECORDED.eventId}`);
  assert.equal(story?.outlet, "ESPN");
});

test("a game's plays come in the order ESPN posted them, which follows the game, without the recap", () => {
  const { plays } = describeHighlights(GAME.id, RECORDED.summary);

  assert.deepEqual(
    plays.slice(0, 3).map((play) => play.title),
    [
      "Chelsea Gray knocks down the mid-range jumper",
      "Caitlin Clark shows off her range with a 3 for the Fever",
      "A'ja Wilson hits the fallaway jumper",
    ],
  );
  assert.ok(!plays.some((play) => /Game Highlights$/.test(play.title)));
  assert.equal(plays[0].expiresAt, "2026-11-30T05:00:00Z");
  assert.match(plays[0].video, /^https:\/\/.+\.mp4$/);
});

test("a story that isn't ESPN's recap of the game, like its preview, stays out", () => {
  const summary = structuredClone(RECORDED.summary);
  summary.article.type = "Preview";

  assert.equal(describeHighlights(GAME.id, summary).story, null);
});

test("the route serves the highlights the store keeps without reading ESPN", async () => {
  const kept = describeHighlights(GAME.id, RECORDED.summary);
  const { espn, response } = askForHighlights(GAME, async (key) =>
    key === nameHighlightsKey(GAME.id) ? kept : null,
  );

  assert.deepEqual(await (await response).json(), kept);
  assert.deepEqual(espn.requests, []);
});

test("the route reads ESPN for a game the store doesn't keep, and says when ESPN has no such game", async () => {
  const found = askForHighlights(GAME, async () => null);
  assert.deepEqual(
    await (await found.response).json(),
    describeHighlights(GAME.id, RECORDED.summary),
  );
  assert.equal(found.espn.requests.length, 2);

  const missing = askForHighlights({ ...GAME, away: "ATL" }, async () => null);
  assert.equal((await missing.response).status, 404);
});

test("the store's job reads each of the season's finals in ESPN's scoreboard and summary, and saves its highlights", async () => {
  const schedule = {
    games: [
      {
        id: GAME.id,
        start: GAME.start,
        state: "final",
        away: { team: "IND" },
        home: { team: "LVA" },
      },
      {
        id: "1042600124",
        start: "2026-10-05T00:00:00Z",
        state: "pre",
        away: { team: "LVA" },
        home: { team: "IND" },
      },
    ],
  };
  const docs = createDocs({ "live/current": { season: 2026 }, [nameScheduleKey(2026)]: schedule });
  const espn = createEspnFetch();

  await createHighlightsUpdater().updateStore(
    /** @type {any} */ ({
      docs,
      storage: createJobStorage(),
      env: {},
      fetchImpl: espn.fetchImpl,
      now: () => Date.parse("2026-10-08T12:00:00Z"),
    }),
  );

  assert.equal(espn.requests.length, 2);
  assert.deepEqual(
    docs.stored.get(nameHighlightsKey(GAME.id)),
    describeHighlights(GAME.id, RECORDED.summary),
  );
});
