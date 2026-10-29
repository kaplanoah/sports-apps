import test from "node:test";
import assert from "node:assert/strict";
import { FEED_FAILURE_MS } from "../shared/worker/feed-failures.js";
import { HEALTH_REUSE_MS, ANSWER_TIMEOUT_MS, createHealthServer } from "../shared/worker/health.js";
import { SERVICES } from "../shared/worker/services.js";
import { listServices } from "../worker/apps.mjs";

const ENV = { STORE: "the store" };

/**
 * A health server over a store that answers its failing feeds as told, counting its calls.
 * @param {(env: any) => Promise<Record<string, import("../shared/worker/feed-failures.js").FeedFailure>>} answer
 * @param {{ now?: () => number }} [options]
 */
function createCountedHealth(answer, { now = () => 0 } = {}) {
  const asked = [];
  const serveHealth = createHealthServer({
    readFeedFailures: (env) => (asked.push(env), answer(env)),
    release: "abc1234",
    now,
  });
  return { asked, serveHealth };
}

test("a Worker whose store answers is healthy, naming its release", async () => {
  const { asked, serveHealth } = createCountedHealth(async () => ({}));

  const response = await serveHealth(ENV);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    release: "abc1234",
    store: "ok",
    feeds: {},
  });
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.deepEqual(asked, [ENV]);
});

const refuseStore = async () => {
  throw new Error("The store answered 500");
};

test("a store that fails makes the Worker unhealthy, saying nothing of its feeds", async () => {
  const failed = createCountedHealth(refuseStore);
  const failedResponse = await failed.serveHealth(ENV);
  assert.equal(failedResponse.status, 503);
  assert.deepEqual(await failedResponse.json(), {
    ok: false,
    release: "abc1234",
    store: "no answer",
  });

  const unbound = createCountedHealth(() => {
    throw new TypeError("Cannot read properties of undefined");
  });
  assert.equal((await unbound.serveHealth({})).status, 503);
});

test("a store that takes too long counts as not answering", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { serveHealth } = createCountedHealth(() => new Promise(() => {}));

  const pending = serveHealth(ENV);
  context.mock.timers.tick(ANSWER_TIMEOUT_MS);

  assert.equal((await pending).status, 503);
});

test("the store is asked once a minute at most, however often health is hit", async () => {
  let at = 0;
  const { asked, serveHealth } = createCountedHealth(refuseStore, { now: () => at });

  for (let hit = 0; hit < 5; hit += 1) assert.equal((await serveHealth(ENV)).status, 503);
  at = HEALTH_REUSE_MS - 1;
  await serveHealth(ENV);
  assert.equal(asked.length, 1);

  at = HEALTH_REUSE_MS;
  await serveHealth(ENV);
  assert.equal(asked.length, 2);
});

test("a feed failing past the threshold is reported, and the Worker stays healthy", async () => {
  const at = Date.parse("2026-09-30T20:00:00Z");
  const { serveHealth } = createCountedHealth(
    async () => ({
      scoreboard: { since: new Date(at - FEED_FAILURE_MS).toISOString(), reason: "404 for /x" },
      backup: { since: new Date(at - FEED_FAILURE_MS + 1).toISOString(), reason: "timed out" },
    }),
    { now: () => at },
  );

  const response = await serveHealth(ENV);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    release: "abc1234",
    store: "ok",
    feeds: {
      scoreboard: { since: new Date(at - FEED_FAILURE_MS).toISOString(), reason: "404 for /x" },
    },
  });
});

/**
 * A service binding whose health answers as told, counting its calls.
 * @param {() => Promise<any>} answer
 */
function createCountedService(answer) {
  const service = { asked: 0, readHealth: () => ((service.asked += 1), answer()) };
  return service;
}

test("a Worker says what each service it binds answers, apart from its own status", async () => {
  const accounts = createCountedService(async () => ({ ok: true, release: "def5678" }));
  const { serveHealth } = createCountedHealth(async () => ({}));

  const response = await serveHealth({ ...ENV, ACCOUNTS: accounts });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    release: "abc1234",
    store: "ok",
    feeds: {},
    services: { accounts: { ok: true, release: "def5678" } },
  });
});

test("an app whose service is down still reports itself healthy", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const cases = [
    async () => ({ ok: false, release: "def5678" }),
    async () => ({ ok: false, release: "def5678", problem: "no RP_ID secret" }),
    async () => {
      throw new Error("The service threw");
    },
    () => new Promise(() => {}),
  ];
  const reports = [];
  for (const answer of cases) {
    const { serveHealth } = createCountedHealth(async () => ({}));
    const pending = serveHealth({ ...ENV, ACCOUNTS: createCountedService(answer) });
    await new Promise(setImmediate);
    context.mock.timers.tick(ANSWER_TIMEOUT_MS);
    const response = await pending;
    assert.equal(response.status, 200);
    reports.push((await response.json()).services.accounts);
  }

  assert.deepEqual(reports, [
    { ok: false, release: "def5678" },
    { ok: false, release: "def5678", problem: "no RP_ID secret" },
    { ok: false, release: null, problem: "it doesn't answer" },
    { ok: false, release: null, problem: "it doesn't answer" },
  ]);
});

test("a service's problem is reported only while it isn't ok, its attention only while it is, each only as text", async () => {
  const cases = [
    [
      { ok: true, release: "def5678", problem: "no RP_ID secret" },
      { ok: true, release: "def5678" },
    ],
    [
      { ok: false, release: "def5678", problem: 42 },
      { ok: false, release: "def5678" },
    ],
    [
      { ok: true, release: "def5678", attention: "Contact delivery needs attention" },
      { ok: true, release: "def5678", attention: "Contact delivery needs attention" },
    ],
    [
      { ok: false, release: "def5678", problem: "no RP_ID secret", attention: "unread" },
      { ok: false, release: "def5678", problem: "no RP_ID secret" },
    ],
    [
      { ok: true, release: "def5678", attention: 42 },
      { ok: true, release: "def5678" },
    ],
  ];
  for (const [answer, report] of cases) {
    const { serveHealth } = createCountedHealth(async () => ({}));
    const response = await serveHealth({
      ...ENV,
      ACCOUNTS: createCountedService(async () => answer),
    });
    assert.deepEqual((await response.json()).services.accounts, report);
  }
});

test("each service is asked once a minute at most, however often health is hit", async () => {
  let at = 0;
  const accounts = createCountedService(async () => ({ ok: true, release: "def5678" }));
  const { serveHealth } = createCountedHealth(async () => ({}), { now: () => at });
  const env = { ...ENV, ACCOUNTS: accounts };

  for (let hit = 0; hit < 5; hit += 1) await serveHealth(env);
  at = HEALTH_REUSE_MS - 1;
  await serveHealth(env);
  assert.equal(accounts.asked, 1);

  at = HEALTH_REUSE_MS;
  await serveHealth(env);
  assert.equal(accounts.asked, 2);
});

test("the services a Worker reports are the ones services/ holds", () => {
  assert.deepEqual(SERVICES, listServices());
});
