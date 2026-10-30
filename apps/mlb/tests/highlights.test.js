import { SCHEDULE_EDITION } from "../page/js/snapshot.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHighlightsServer } from "../worker/src/highlights.js";
import {
  describeHighlights,
  listStillsToCheck,
  nameContentRequest,
  nameHighlightsKey,
  namePlaysRequest,
} from "../worker/src/adapters/highlights.js";
import { createHighlightsUpdater } from "../worker/src/highlights-updater.js";
import { STILLS_PER_READ } from "../worker/src/headline-stills.js";
import { buildSnapshot } from "../worker/src/adapters/mlb.js";
import { assertErrorAnswer } from "../../../tests/error-answer.js";
import { createDocs, createJobStorage } from "../../../tests/job-context.js";

// MLB's content and plays for two Division Series games of Oct 7, as it had them the next day.
const RECORDED = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-highlights.json`, "utf8"),
);
const EVENING = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-07-evening.json`, "utf8"),
);
const MLB_API = "https://statsapi.mlb.com";
const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const BREWERS_AT_PADRES = "849826";
const RAYS_AT_YANKEES = "849838";

/**
 * @param {string} id
 * @param {Set<string>} [withHeadlines]
 */
const describeRecorded = (id, withHeadlines) =>
  describeHighlights(id, RECORDED.content[id], RECORDED.plays[id], withHeadlines);

/**
 * MLB's own still for the game's clip with the title, and its frames' address.
 * @param {string} id
 * @param {string} title
 */
function findRecordedClip(id, title) {
  const item = RECORDED.content[id].highlights.highlights.items.find(
    (/** @type {any} */ candidate) => candidate.headline.trim() === title,
  );
  const still = item.image.cuts.find((/** @type {any} */ cut) => cut.width === 480).src;
  const frames = item.playbacks.find(
    (/** @type {any} */ playback) => playback.name === "trickplay",
  );
  return { still, frames: frames?.url ?? null };
}

/**
 * @param {any} highlights
 * @param {string} title
 */
const findPlay = (highlights, title) =>
  highlights.plays.find((/** @type {any} */ play) => play.title === title);

/**
 * MLB as recorded, and Claude, finding a headline on each still in `withHeadlines`, unless it's
 * down.
 * @param {Set<string>} [withHeadlines]
 */
function createMlbFetch(withHeadlines = new Set()) {
  const claude = { isDown: false };
  /** @type {string[]} */
  const requests = [];
  /** @type {string[]} */
  const stillsAsked = [];
  /**
   * @param {string} url
   * @param {any} [init]
   */
  const fetchImpl = async (url, init) => {
    if (url === CLAUDE_URL) {
      const still = JSON.parse(init.body).messages[0].content[0].source.url;
      stillsAsked.push(still);
      if (claude.isDown) return new Response("{}", { status: 529 });
      const text = JSON.stringify({ headline: withHeadlines.has(still) });
      return new Response(
        JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn" }),
      );
    }
    const path = url.slice(MLB_API.length);
    requests.push(path);
    const id = /\/game\/(\d+)\//.exec(path)?.[1] ?? "";
    const answer =
      path === nameContentRequest(id)
        ? RECORDED.content[id]
        : path === namePlaysRequest(id)
          ? RECORDED.plays[id]
          : null;
    return answer ? new Response(JSON.stringify(answer)) : new Response("", { status: 404 });
  };
  return { claude, requests, stillsAsked, fetchImpl: /** @type {any} */ (fetchImpl) };
}

test("a game's plays come in the order they happened, each with its inning, and a play that scored with the score after it", () => {
  const { plays } = describeRecorded(BREWERS_AT_PADRES);

  assert.deepEqual(
    plays.map((play) => [play.half, play.inning, play.title, play.length]).slice(0, 5),
    [
      ["top", 1, "Jackson Merrill's sliding catch", 30],
      ["top", 1, "Nick Pivetta strikes out Jake Bauers", 7],
      ["bottom", 1, "Dustin May strikes out Jackson Merrill", 12],
      ["top", 3, "Jackson Merrill's diving catch", 11],
      ["bottom", 3, "Fernando Tatis Jr.'s RBI groundout", 19],
    ],
  );
  assert.deepEqual(
    plays.filter((play) => play.score).map((play) => [play.title, play.score, play.scorer]),
    [
      ["Fernando Tatis Jr.'s RBI groundout", [0, 1], "home"],
      ["Manny Machado's RBI single", [0, 2], "home"],
      ["William Contreras' solo home run", [1, 2], "away"],
      ["Jackson Chourio's sacrifice fly", [2, 2], "away"],
      ["Jake Cronenworth's solo home run", [2, 3], "home"],
      ["Xander Bogaerts scores on throwing error", [2, 4], "home"],
      ["Christian Yelich's RBI single", [3, 4], "away"],
    ],
  );
  assert.equal(plays.length, 15);
});

test("a game's clips that aren't its plays, like interviews and the condensed game, stay out", () => {
  const titles = describeRecorded(BREWERS_AT_PADRES).plays.map((play) => play.title);

  assert.ok(!titles.some((title) => /Condensed Game|talk|ABS challenge|first pitch/i.test(title)));
});

test("each play's clip has MLB's still sized for its place and MLB's video the phone plays", () => {
  const { plays } = describeRecorded(BREWERS_AT_PADRES);

  assert.match(plays[0].still ?? "", /\/w_480,h_270,/);
  assert.match(plays[0].video, /^https:\/\/mlb-cuts-diamond\.mlb\.com\/.+_1280x720_59_4000K\.mp4$/);
});

test("the recap's still is the frame from the middle of its video, in place of MLB's title card", () => {
  const { recap } = describeRecorded(BREWERS_AT_PADRES);

  assert.equal(recap?.length, 181);
  assert.match(
    recap?.still ?? "",
    /^https:\/\/mlb-cuts-diamond\.mlb\.com\/.+_320x180\/05s\.0000018\.jpg$/,
  );
});

test("the frame filename is filled without changing escaped URL paths or query values", () => {
  const content = structuredClone(RECORDED.content[BREWERS_AT_PADRES]);
  const recapItem = content.highlights.highlights.items.find((/** @type {any} */ item) =>
    /Game 3 Highlights/.test(item.headline),
  );
  recapItem.playbacks.find((/** @type {any} */ playback) => playback.name === "trickplay").url =
    "https://example.com/clips%20archive/05s.%.jpg?token=a%25b";

  const { recap } = describeHighlights(
    BREWERS_AT_PADRES,
    content,
    RECORDED.plays[BREWERS_AT_PADRES],
  );

  assert.equal(recap?.still, "https://example.com/clips%20archive/05s.0000018.jpg?token=a%25b");
});

test("a recap without frames from its video shows MLB.com's photo of the game", () => {
  const content = structuredClone(RECORDED.content[BREWERS_AT_PADRES]);
  const recapItem = content.highlights.highlights.items.find((/** @type {any} */ item) =>
    /Game 3 Highlights/.test(item.headline),
  );
  recapItem.playbacks = recapItem.playbacks.filter(
    (/** @type {any} */ playback) => playback.name !== "trickplay",
  );

  const { recap } = describeHighlights(
    BREWERS_AT_PADRES,
    content,
    RECORDED.plays[BREWERS_AT_PADRES],
  );

  assert.equal(
    recap?.still,
    content.editorial.recap.mlb.image.cuts.find((/** @type {any} */ cut) => cut.width === 960).src,
  );
});

test("a play whose still has a headline on it shows the frame from the middle of its video", () => {
  const contreras = findRecordedClip(BREWERS_AT_PADRES, "William Contreras' solo home run");
  const highlights = describeRecorded(BREWERS_AT_PADRES, new Set([contreras.still]));

  assert.equal(
    findPlay(highlights, "William Contreras' solo home run").still,
    contreras.frames?.replace("%", "0000003"),
  );
  assert.match(findPlay(highlights, "Jackson Merrill's sliding catch").still, /\/w_480,h_270,/);
});

test("a play whose still has a headline and whose clip has no frames shows MLB.com's photo of the game", () => {
  const fried = findRecordedClip(RAYS_AT_YANKEES, "Max Fried strikes out Junior Caminero");
  const highlights = describeRecorded(RAYS_AT_YANKEES, new Set([fried.still]));

  assert.equal(fried.frames, null);
  assert.equal(
    findPlay(highlights, "Max Fried strikes out Junior Caminero").still,
    RECORDED.content[RAYS_AT_YANKEES].editorial.recap.mlb.image.cuts.find(
      (/** @type {any} */ cut) => cut.width === 480,
    ).src,
  );
});

test("each play's still goes to Claude but Getty's and the AP's photos, which never carry a headline", () => {
  const stills = listStillsToCheck(
    RECORDED.content[BREWERS_AT_PADRES],
    RECORDED.plays[BREWERS_AT_PADRES],
  );

  assert.equal(stills.length, 7);
  assert.ok(
    stills.includes(findRecordedClip(BREWERS_AT_PADRES, "William Contreras' solo home run").still),
  );
  assert.ok(
    !stills.includes(findRecordedClip(BREWERS_AT_PADRES, "Manny Machado's RBI single").still),
  );
});

test("a game's recap video and MLB.com's story lead its highlights", () => {
  const { recap, story } = describeRecorded(BREWERS_AT_PADRES);

  assert.equal(recap?.title, "Brewers vs. Padres Game 3 Highlights");
  assert.equal(recap?.length, 181);
  assert.match(recap?.blurb ?? "", /^Jake Cronenworth hits a solo home run/);
  assert.deepEqual(story, {
    title: "Led by King's all-in relief effort, Padres fight and force Game 4",
    lead: "SAN DIEGO -- Didn\u2019t matter how. The Padres only needed to find a way. They trailed two games to none and faced elimination on Tuesday night in this instant classic of a National League Division Series against Milwaukee.",
    url: "https://www.mlb.com/news/padres-win-nlds-game-3-2026",
    outlet: "MLB.com",
  });
});

test("before MLB posts the recap video or story, a game's highlights have its plays alone", () => {
  const content = structuredClone(RECORDED.content[RAYS_AT_YANKEES]);
  content.editorial.recap.mlb = {};
  content.highlights.highlights.items = content.highlights.highlights.items.filter(
    (/** @type {any} */ item) => !/Game 3 Highlights/.test(item.headline),
  );

  const highlights = describeHighlights(RAYS_AT_YANKEES, content, RECORDED.plays[RAYS_AT_YANKEES]);

  assert.equal(highlights.recap, null);
  assert.equal(highlights.story, null);
  assert.equal(highlights.plays.length, 14);
});

test("the route serves the highlights the store keeps without reading MLB", async () => {
  const mlb = createMlbFetch();
  const server = createHighlightsServer({ fetchImpl: mlb.fetchImpl });
  const kept = describeRecorded(BREWERS_AT_PADRES);

  const response = await server.serveHighlights(
    new URL(`https://app.test/highlights?id=${BREWERS_AT_PADRES}`),
    async (key) => (key === nameHighlightsKey(BREWERS_AT_PADRES) ? kept : null),
  );

  assert.deepEqual(await response.json(), kept);
  assert.deepEqual(mlb.requests, []);
});

test("the route reads MLB for a game the store doesn't keep, in two requests", async () => {
  const mlb = createMlbFetch();
  const server = createHighlightsServer({ fetchImpl: mlb.fetchImpl });

  const response = await server.serveHighlights(
    new URL(`https://app.test/highlights?id=${BREWERS_AT_PADRES}`),
    async () => null,
  );

  assert.deepEqual(await response.json(), describeRecorded(BREWERS_AT_PADRES));
  assert.equal(mlb.requests.length, 2);
});

test("the route turns away an id that isn't MLB's, and says when MLB doesn't answer", async () => {
  const mlb = createMlbFetch();
  const server = createHighlightsServer({ fetchImpl: mlb.fetchImpl });

  const response = await server.serveHighlights(
    new URL("https://app.test/highlights?id=x"),
    async () => null,
  );
  await assertErrorAnswer(response, 400, "invalid_argument");
  assert.deepEqual(mlb.requests, []);

  const unknown = await server.serveHighlights(
    new URL("https://app.test/highlights?id=1"),
    async () => null,
  );
  assert.match(await assertErrorAnswer(unknown, 502, "upstream_error"), /^Couldn't read MLB: /);
});

/**
 * The store's job over the evening's slate, with its own storage and documents.
 * @param {ReturnType<typeof createMlbFetch>} mlb
 * @param {Record<string, string>} env
 */
function createJobRun(mlb, env) {
  const clock = { now: Date.parse(EVENING.now) };
  const slate = buildSnapshot(EVENING.responses, { season: EVENING.season, now: clock.now }).slate;
  const docs = createDocs({
    "live/current": { season: EVENING.season },
    [`seasons/${EVENING.season}`]: { year: EVENING.season, slate },
  });
  const storage = createJobStorage();
  const context = /** @type {any} */ ({
    docs,
    storage,
    env,
    fetchImpl: mlb.fetchImpl,
    now: () => clock.now,
  });
  const job = createHighlightsUpdater();
  return {
    stored: docs.stored,
    storage: storage.stored,
    runJob: () => job.updateStore(context),
    forgetReads: () => {
      for (const key of storage.stored.keys()) {
        if (key.startsWith("highlight-reads:")) storage.stored.delete(key);
      }
    },
    wait: (/** @type {number} */ minutes) => {
      clock.now += minutes * 60 * 1000;
    },
  };
}

test("the store's job keeps the current season's stills whichever finals it lists, and forgets the season before's", async () => {
  const { storage, runJob } = createJobRun(createMlbFetch(), {});
  const answers = { "https://img.mlbstatic.com/still.jpg": true };
  storage.set("headline-stills:999999", answers);
  storage.set("headline-stills:2026:999998", answers);
  storage.set("headline-stills:2025:776001", answers);

  await runJob();

  assert.deepEqual(storage.get("headline-stills:2026:999999"), answers);
  assert.deepEqual(storage.get("headline-stills:2026:999998"), answers);
  assert.equal(storage.has("headline-stills:999999"), false);
  assert.equal(storage.has("headline-stills:2025:776001"), false);
});

test("the store's job reads each of the slate's finals in two requests, and saves its highlights", async () => {
  const mlb = createMlbFetch();
  const { stored, runJob } = createJobRun(mlb, {});

  await runJob();

  const games = new Set(mlb.requests.map((path) => /\/game\/(\d+)\//.exec(path)?.[1]));
  assert.equal(mlb.requests.length, 2 * games.size);
  assert.ok(games.has(BREWERS_AT_PADRES));
  assert.deepEqual(
    stored.get(nameHighlightsKey(BREWERS_AT_PADRES)),
    describeRecorded(BREWERS_AT_PADRES),
  );
});

/**
 * Runs the job every two minutes until a run asks Claude nothing more, as the store does for a game
 * with more stills than a run may ask about.
 * @param {{ runJob: () => Promise<void>, wait: (minutes: number) => void }} run
 * @param {{ stillsAsked: string[] }} mlb
 */
async function runUntilChecked(run, mlb) {
  for (let runs = 0; runs < 40; runs += 1) {
    const asked = mlb.stillsAsked.length;
    await run.runJob();
    if (mlb.stillsAsked.length === asked) return;
    run.wait(2);
  }
  throw new Error("The job kept asking about stills");
}

test("the store's job asks Claude about a few stills a run, saving the game's highlights at once and the moment for a still with a headline as it's checked", async () => {
  const contreras = findRecordedClip(BREWERS_AT_PADRES, "William Contreras' solo home run");
  const mlb = createMlbFetch(new Set([contreras.still]));
  const run = createJobRun(mlb, { ANTHROPIC_API_KEY: "key" });
  const { stored, runJob, forgetReads } = run;

  await runJob();

  const games = [...new Set(mlb.requests.map((path) => /\/game\/(\d+)\//.exec(path)?.[1] ?? ""))];
  const listStills = (id) =>
    RECORDED.content[id] ? listStillsToCheck(RECORDED.content[id], RECORDED.plays[id]) : [];
  const askedFirst = games
    .filter((id) => RECORDED.content[id])
    .map((id) => Math.min(listStills(id).length, STILLS_PER_READ));
  assert.equal(
    mlb.stillsAsked.length,
    askedFirst.reduce((sum, count) => sum + count, 0),
  );
  assert.ok(askedFirst.some((count) => count === STILLS_PER_READ));
  assert.ok(stored.get(nameHighlightsKey(BREWERS_AT_PADRES)));

  await runUntilChecked(run, mlb);

  const stills = games.flatMap(listStills);
  assert.deepEqual(mlb.stillsAsked.toSorted(), stills.toSorted());
  assert.equal(
    findPlay(stored.get(nameHighlightsKey(BREWERS_AT_PADRES)), "William Contreras' solo home run")
      .still,
    contreras.frames?.replace("%", "0000003"),
  );

  const firstReads = mlb.requests.length;
  forgetReads();
  await runJob();
  assert.equal(mlb.requests.length, firstReads + 2 * games.length);
  assert.equal(mlb.stillsAsked.length, stills.length);
});

test("a game whose stills Claude didn't answer for saves its highlights with MLB's own stills, and has the moment once Claude answers ten minutes later", async () => {
  const title = "William Contreras' solo home run";
  const contreras = findRecordedClip(BREWERS_AT_PADRES, title);
  const mlb = createMlbFetch(new Set([contreras.still]));
  const run = createJobRun(mlb, { ANTHROPIC_API_KEY: "key" });
  const { stored, wait } = run;
  mlb.claude.isDown = true;

  await run.runJob();
  assert.match(
    stored.get("highlights/status").lastFailure.message,
    /Asking Claude about \d+ of game 849826's stills failed: Claude answered 529/,
  );
  await runUntilChecked(run, mlb);
  assert.deepEqual(
    stored.get(nameHighlightsKey(BREWERS_AT_PADRES)),
    describeRecorded(BREWERS_AT_PADRES),
  );

  mlb.claude.isDown = false;
  wait(10);
  await runUntilChecked(run, mlb);
  assert.equal(
    findPlay(stored.get(nameHighlightsKey(BREWERS_AT_PADRES)), title).still,
    contreras.frames?.replace("%", "0000003"),
  );
});

test("historical highlights back off failed games, fill later games and stop scanning completed seasons", async () => {
  const { createRequestBudget, HISTORY_REQUESTS_PER_RUN } =
    await import("../../../shared/worker/request-budget.js");
  const docs = createDocs({
    "live/current": { season: 2026 },
    "seasons/2025": { year: 2025, slate: null },
    "seasons/2024": { year: 2024, slate: null },
    "schedule-revisions/2025": { edition: SCHEDULE_EDITION, revision: 1, isWhole: true },
    "schedule-revisions/2024": { edition: SCHEDULE_EDITION, revision: 1, isWhole: true },
    "schedules-2025/10": {
      games: ["1", "2", "3"].map((id) => ({
        id,
        state: "final",
        start: `2025-10-0${4 - Number(id)}T20:00:00Z`,
      })),
    },
    "schedules-2024/10": { games: [{ id: "4", state: "final", start: "2024-10-01T20:00:00Z" }] },
  });
  const storage = createJobStorage();
  let now = Date.parse("2026-10-30T12:00:00Z");
  let fails = true;
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const id = /game\/(\d+)/.exec(url)?.[1];
    if (id === "1" && fails) return new Response(null, { status: 503 });
    return Response.json(
      url.includes("/content")
        ? RECORDED.content[BREWERS_AT_PADRES]
        : RECORDED.plays[BREWERS_AT_PADRES],
    );
  };
  const job = createHighlightsUpdater();
  const runHistory = async (limit = HISTORY_REQUESTS_PER_RUN) => {
    const budget = createRequestBudget(fetchImpl, limit);
    await job.updateHistory({
      docs,
      storage,
      env: {},
      now: () => now,
      fetchImpl: budget.fetchImpl,
      remainingRequests: budget.remaining,
      createLoadSnapshot: () => async () => null,
    });
  };
  await runHistory(1);
  assert.equal(requests.length, 0);
  await runHistory();
  assert.equal(requests.length, HISTORY_REQUESTS_PER_RUN);
  assert.ok(await docs.read("highlights/2"));
  await runHistory();
  assert.ok(await docs.read("highlights/3"));
  assert.ok(await docs.read("highlights/4"));
  const readDoc = docs.read;
  const readKeys = [];
  docs.read = async (key) => {
    readKeys.push(key);
    return readDoc(key);
  };
  const writes = docs.writes.length;
  docs.lists.length = 0;
  await runHistory();
  assert.deepEqual(docs.writes.slice(writes), []);
  assert.ok(!docs.lists.includes("schedules-2024"));
  assert.ok(!readKeys.some((key) => key.startsWith("schedules-2024/") || key === "highlights/4"));
  const failedRequests = () => requests.filter((url) => /game\/1\//.test(url)).length;
  assert.equal(failedRequests(), 2);
  now += 10 * 60 * 1000;
  await runHistory();
  assert.equal(failedRequests(), 4);
  now += 10 * 60 * 1000;
  await runHistory();
  assert.equal(failedRequests(), 4);
  now += 10 * 60 * 1000;
  await runHistory();
  assert.equal(failedRequests(), 6);
  fails = false;
  now += 40 * 60 * 1000;
  await runHistory();
  assert.ok(await docs.read("highlights/1"));
  assert.equal((await storage.get("history-highlight-reads:2025"))["1"].tries, undefined);
  assert.equal(typeof (await storage.get("highlights-filled:2025")).version, "number");
  readKeys.length = 0;
  docs.lists.length = 0;
  const before = requests.length;
  await runHistory();
  assert.equal(requests.length, before);
  assert.ok(!docs.lists.some((collection) => collection.startsWith("schedules-")));
  assert.ok(!readKeys.some((key) => key.startsWith("schedules-") || key.startsWith("highlights/")));
});

test("an unsupported frame template falls back to MLB's photo", () => {
  const content = structuredClone(RECORDED.content[BREWERS_AT_PADRES]);
  const recapItem = content.highlights.highlights.items.find((item) =>
    /Game 3 Highlights/.test(item.headline),
  );
  recapItem.playbacks.find((playback) => playback.name === "trickplay").url =
    "https://example.com/05s.%.webp";
  const { recap } = describeHighlights(
    BREWERS_AT_PADRES,
    content,
    RECORDED.plays[BREWERS_AT_PADRES],
  );
  assert.equal(
    recap.still,
    content.editorial.recap.mlb.image.cuts.find((cut) => cut.width === 960).src,
  );
});

test("actual live and historical highlight writers preserve usable media after malformed updates and recover", async () => {
  for (const historical of [false, true]) {
    const game = { id: BREWERS_AT_PADRES, state: "final", start: "2026-10-07T20:00:00Z" };
    const season = historical ? 2025 : 2026;
    const docs = createDocs({
      "live/current": { season: 2026 },
      [`seasons/${season}`]: { year: season, slate: { today: { games: [game] } } },
      [`schedule-revisions/${season}`]: { edition: SCHEDULE_EDITION, revision: 1, isWhole: true },
      [`schedules-${season}/10`]: { games: [game] },
    });
    let phase = "malformed";
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      const answer = structuredClone(
        url.includes("/content") ? RECORDED.content[game.id] : RECORDED.plays[game.id],
      );
      if (!url.includes("/content")) {
        const play = answer.liveData.plays.allPlays.find((play) => play.about.isScoringPlay);
        if (phase === "malformed") play.result.awayScore = -1;
        if (phase === "recovery") play.result.awayScore += 1;
      }
      return Response.json(answer);
    };
    const update = async () => {
      const before = requests.length;
      const job = createHighlightsUpdater();
      const storage = createJobStorage();
      if (historical)
        await storage.put(`history-highlight-reads:${season}`, {
          [game.id]: { readAt: null, triedAt: 0, version: 0 },
        });
      const context = {
        docs,
        storage,
        env: {},
        fetchImpl,
        now: () => Date.parse("2026-10-30T12:00:00Z"),
        createLoadSnapshot: () => async () => null,
      };
      await (historical ? job.updateHistory(context) : job.updateStore(context));
      assert.equal(requests.length - before, 2);
      assert.equal(
        docs.stored.get(historical ? "highlights-history/status" : "highlights/status").requests,
        2,
      );
    };
    const key = nameHighlightsKey(game.id);
    await update();
    assert.equal(docs.stored.has(key), false);
    phase = "valid";
    await update();
    const valid = structuredClone(docs.stored.get(key));
    assert.ok(valid.plays.length);
    phase = "malformed";
    await update();
    assert.deepEqual(docs.stored.get(key), valid);
    phase = "recovery";
    await update();
    assert.notDeepEqual(docs.stored.get(key), valid);
  }
});
