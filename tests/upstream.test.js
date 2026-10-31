import test from "node:test";
import assert from "node:assert/strict";
import {
  createReusedLoader,
  fetchFeedJson,
  fetchUpstream,
  UPSTREAM_TIMEOUT_MS,
} from "../shared/worker/upstream.js";

const HEADERS = { accept: "application/json" };

test("a slow outstanding read stays shared after the reuse window expires", async () => {
  let now = 0;
  let finish;
  let reads = 0;
  const load = createReusedLoader(
    () => {
      reads += 1;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    5000,
    () => now,
  );
  const first = load("game");
  now = 6000;
  const second = load("game");
  assert.equal(reads, 1);
  finish("answer");
  assert.deepEqual(await Promise.all([first, second]), ["answer", "answer"]);
});

function recordFetches() {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response("{}");
  };
  return { requests, fetchImpl };
}

test("a feed's answer is kept at the edge as long as the caller says", async () => {
  const { requests, fetchImpl } = recordFetches();

  await fetchUpstream(fetchImpl, "https://feed.example/a", { headers: HEADERS, cacheSeconds: 15 });

  const [{ url, init }] = requests;
  assert.equal(url, "https://feed.example/a");
  assert.deepEqual(init.headers, HEADERS);
  assert.deepEqual(init.cf, { cacheTtl: 15, cacheEverything: true });
  assert.ok(init.signal instanceof AbortSignal);
});

test("a feed read with no edge cache time sends no cache options", async () => {
  const { requests, fetchImpl } = recordFetches();

  await fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: null,
  });

  assert.equal(Object.hasOwn(requests[0].init, "cf"), false);
});

test("a feed that doesn't answer is given up on after the upstream timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });

  const reading = fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: 5,
  });
  context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);

  await assert.rejects(reading, { name: "TimeoutError" });
});

test("a feed's whole answer is read before its timer stops", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { requests } = recordFetches();
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response('{"games":[]}', { status: 203, headers: { "x-feed": "1" } });
  };

  const response = await fetchUpstream(fetchImpl, "https://feed.example/a", {
    headers: HEADERS,
    cacheSeconds: 5,
  });
  context.mock.timers.tick(UPSTREAM_TIMEOUT_MS);

  assert.equal(requests[0].init.signal.aborted, false);
  assert.deepEqual(
    [response.status, response.headers.get("x-feed"), await response.json()],
    [203, "1", { games: [] }],
  );
});

const FEED_URL = "https://feed.example/scoreboard.json?day=1";
const SOURCE = { feed: "The league", path: "/scoreboard.json", headers: HEADERS, cacheSeconds: 5 };
const hasGames = (answer) => Array.isArray(answer?.scoreboard?.games);

/**
 * Reads a feed that answers with `body` and `status`.
 * @param {string} body
 * @param {{ status?: number, hasData?: (answer: any) => boolean }} [options]
 */
const readFeed = (body, { status = 200, hasData } = {}) =>
  fetchFeedJson(async () => new Response(body, { status }), FEED_URL, { ...SOURCE, hasData });

/**
 * Why reading a feed whose answer is `body` fails, when its data is `scoreboard.games`.
 * @param {string} body
 */
async function readFailure(body) {
  const error = await readFeed(body, { hasData: hasGames }).then(
    () => assert.fail("the feed answered with data"),
    (/** @type {Error} */ failure) => failure,
  );
  return error.message.replace("The league answered /scoreboard.json with ", "");
}

test("a feed's answer is its JSON once its data is in it, or any JSON when the caller names no data", async () => {
  const answer = { scoreboard: { games: [] } };
  assert.deepEqual(await readFeed(JSON.stringify(answer), { hasData: hasGames }), answer);
  assert.equal(await readFeed("null"), null);
  await assert.rejects(readFeed("<html></html>"), {
    message: "The league answered /scoreboard.json with a web page rather than data",
  });
});

test("a feed that answers with a status that isn't ok says the status, and keeps it on the error", async () => {
  await assert.rejects(readFeed("{}", { status: 503 }), {
    message: "The league answered 503 for /scoreboard.json",
    status: 503,
  });
});

test("a feed is read with the caller's headers and edge cache time", async () => {
  const { requests, fetchImpl } = recordFetches();

  await fetchFeedJson(fetchImpl, FEED_URL, SOURCE);

  assert.equal(requests[0].url, FEED_URL);
  assert.deepEqual(requests[0].init.headers, HEADERS);
  assert.deepEqual(requests[0].init.cf, { cacheTtl: 5, cacheEverything: true });
});

test("a feed that refuses with a web page says so, with the page's title on one line", async () => {
  const refusal =
    "<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>Reference</BODY></HTML>";
  assert.equal(await readFailure(refusal), 'a web page titled "Access Denied" rather than data');
  const challenge = '<title lang="en">\n  Just a\n\tmoment...  </title>';
  assert.equal(
    await readFailure(challenge),
    'a web page titled "Just a moment..." rather than data',
  );
  assert.equal(await readFailure("<!DOCTYPE html><html></html>"), "a web page rather than data");
});

test("a feed that answers with nothing, or with text that isn't JSON, says which", async () => {
  assert.equal(await readFailure(""), "nothing rather than data");
  assert.equal(await readFailure("Service busy"), "text that isn't JSON rather than data");
});

test("a feed that answers with JSON without its data says the JSON's shape, without its values", async () => {
  const empty = { scoreboard: { gameDate: "2026-10-27", games: null }, meta: { code: 200 } };
  assert.equal(
    await readFailure(JSON.stringify(empty)),
    "JSON shaped {scoreboard: {gameDate: string, games: null}, meta: {code: number}} rather than data",
  );
  const deep = { scoreboard: { day: { games: [] } }, gameDates: [1, 2], teams: [] };
  assert.equal(
    await readFailure(JSON.stringify(deep)),
    "JSON shaped {scoreboard: {day: {...}}, gameDates: list, teams: empty list} rather than data",
  );
  assert.equal(await readFailure("null"), "JSON shaped null rather than data");
});

test("what came back in place of a feed's data is cut short past 200 characters", async () => {
  const names = Array.from({ length: 40 }, (_, index) => `field${index}`);
  const wide = Object.fromEntries(names.map((name) => [name, 1]));
  const shape = `JSON shaped {${names.map((name) => `${name}: number`).join(", ")}}`;
  assert.equal(
    await readFailure(JSON.stringify(wide)),
    `${shape.slice(0, 200)}... rather than data`,
  );
});

function createCountingLoad() {
  const calls = [];
  const load = async (key, requestedAt) => {
    calls.push({ key, requestedAt });
    return `${key} at ${requestedAt}`;
  };
  return { calls, load };
}

test("a reused loader shares one load per key until it's older than the reuse time", async () => {
  let now = 1000;
  const { calls, load } = createCountingLoad();
  const loadReused = createReusedLoader(load, 10_000, () => now);

  const first = loadReused(2026);
  assert.equal(loadReused(2026), first);
  now += 9_999;
  assert.equal(await loadReused(2026), "2026 at 1000");
  assert.equal(await loadReused(2025), "2025 at 10999");
  now += 1;
  assert.equal(await loadReused(2026), "2026 at 11000");

  assert.deepEqual(
    calls.map(({ key }) => key),
    [2026, 2025, 2026],
  );
});

test("a reused loader forgets a load that failed, so the next call tries again", async () => {
  let attempts = 0;
  const loadReused = createReusedLoader(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The league answered 503");
      return "answered";
    },
    10_000,
    () => 1000,
  );

  await assert.rejects(loadReused(2026), /503/);
  assert.equal(await loadReused(2026), "answered");
  assert.equal(await loadReused(2026), "answered");
  assert.equal(attempts, 2);
});

test("settling a failed feed batch waits for sibling reads and preserves successful input order", async () => {
  const { settleReads } = await import("../shared/worker/upstream.js");
  let release;
  const sibling = new Promise((resolve) => {
    release = resolve;
  });
  let finished = false;
  const failure = new Error("unavailable");
  const batch = settleReads([Promise.reject(failure), sibling]).finally(() => {
    finished = true;
  });
  const rejected = assert.rejects(batch, (error) => error === failure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release("late answer");
  await rejected;
  assert.deepEqual(await settleReads([Promise.resolve("first"), Promise.resolve("second")]), [
    "first",
    "second",
  ]);
});
