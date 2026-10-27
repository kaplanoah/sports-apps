import { test } from "node:test";
import assert from "node:assert/strict";
import { isCountOwed, startDailyCount } from "../shared/page/daily-count.js";
import { WAKING_REQUEST_TIMEOUT_MS } from "../shared/page/release.js";
import { watchReturns } from "../shared/page/resume.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Midnight in New York on October 28, 2026, while it keeps Eastern Daylight Time.
const EASTERN_MIDNIGHT = Date.parse("2026-10-28T04:00:00Z");

test("a count is owed once each Eastern day, whatever the device's clock says of the day", () => {
  const counted = { countedDays: ["2026-10-27", null], isAutomated: false };
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT - 20 * HOUR_MS }), false);
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT - 1 }), false);
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT }), true);
});

test("a count is owed on a browser never counted, and on a return after days away", () => {
  assert.equal(
    isCountOwed({ countedDays: [null, null], now: EASTERN_MIDNIGHT, isAutomated: false }),
    true,
  );
  assert.equal(
    isCountOwed({
      countedDays: ["2026-10-28", "2026-10-28"],
      now: EASTERN_MIDNIGHT + 3 * DAY_MS,
      isAutomated: false,
    }),
    true,
  );
});

test("a day counted this load is enough when storage keeps none", () => {
  assert.equal(
    isCountOwed({ countedDays: [null, "2026-10-28"], now: EASTERN_MIDNIGHT, isAutomated: false }),
    false,
  );
});

test("an automated browser is never counted", () => {
  assert.equal(
    isCountOwed({ countedDays: [null, null], now: EASTERN_MIDNIGHT, isAutomated: true }),
    false,
  );
});

/** @param {Map<string, string>} stored */
const createFakeStorage = (stored) => ({
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {import("node:test").TestContext} context
 * @param {Record<string, unknown>} globals
 */
function replaceGlobals(context, globals) {
  const kept = Object.getOwnPropertyDescriptors(globalThis);
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  context.after(() => {
    for (const name of Object.keys(globals))
      if (kept[name]) Object.defineProperty(globalThis, name, kept[name]);
      else delete globalThis[name];
  });
}

test("a browser sends one empty POST a day, and keeps the day only once the Worker takes it", async (context) => {
  /** @type {{ url: string, init: RequestInit }[]} */
  const sent = [];
  let status = 500;
  const stored = new Map();
  context.mock.timers.enable({ apis: ["Date"], now: EASTERN_MIDNIGHT - HOUR_MS });
  const globals = {
    localStorage: createFakeStorage(stored),
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch: async (url, init) => {
      sent.push({ url: String(url), init });
      return new Response(null, { status });
    },
  };
  replaceGlobals(context, globals);

  startDailyCount();
  await settle();
  assert.deepEqual(
    sent.map(({ url, init }) => ({
      url,
      method: init.method,
      body: init.body,
      headers: init.headers,
    })),
    [
      {
        url: "https://worker.example/k3y/count",
        method: "POST",
        body: undefined,
        headers: undefined,
      },
    ],
  );
  assert.equal(stored.size, 0);

  status = 204;
  startDailyCount();
  await settle();
  assert.equal(sent.length, 2);
  assert.deepEqual([...stored.values()], ["2026-10-27"]);

  startDailyCount();
  await settle();
  assert.equal(sent.length, 2);

  context.mock.timers.setTime(EASTERN_MIDNIGHT);
  startDailyCount();
  await settle();
  assert.equal(sent.length, 3);
  assert.deepEqual([...stored.values()], ["2026-10-28"]);
});

test("a browser whose storage refuses sends one count while one is out, and one a load", async (context) => {
  let sentCount = 0;
  /** @type {(response: Response) => void} */
  let answer = () => {};
  context.mock.timers.enable({ apis: ["Date"], now: EASTERN_MIDNIGHT + DAY_MS });
  const refuse = () => {
    throw new Error("storage refused");
  };
  const globals = {
    localStorage: { getItem: refuse, setItem: refuse },
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch: () => {
      sentCount += 1;
      return new Promise((resolve) => (answer = resolve));
    },
  };
  replaceGlobals(context, globals);

  startDailyCount();
  startDailyCount();
  assert.equal(sentCount, 1);

  answer(new Response(null, { status: 204 }));
  await settle();
  startDailyCount();
  await settle();
  assert.equal(sentCount, 1);
});

function createFakePage() {
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    getElementById: () => null,
  });
  const switchVisibility = (hidden) => {
    document.hidden = hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  };
  return {
    globals: { document, addEventListener: page.addEventListener.bind(page) },
    leave: () => switchVisibility(true),
    comeBack: () => switchVisibility(false),
  };
}

/**
 * A page's fetch that answers each count from `answerCount`, and version.json as a local server
 * does, with no release.
 * @param {() => Promise<Response>} answerCount
 */
function createCountFetch(answerCount) {
  const counts = { sent: 0 };
  const fetch = (url) => {
    if (!String(url).endsWith("/count"))
      return Promise.resolve(new Response(null, { status: 404 }));
    counts.sent += 1;
    return answerCount();
  };
  return { counts, fetch };
}

const NOON_OCTOBER_30 = EASTERN_MIDNIGHT + 2 * DAY_MS + 12 * HOUR_MS;

test("a page back from away after Eastern midnight counts again, and not again that day", async (context) => {
  const stored = new Map();
  const page = createFakePage();
  const { counts, fetch } = createCountFetch(async () => new Response(null, { status: 204 }));
  context.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: NOON_OCTOBER_30 });
  replaceGlobals(context, {
    ...page.globals,
    localStorage: createFakeStorage(stored),
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch,
  });
  watchReturns();

  startDailyCount();
  await settle();
  assert.equal(counts.sent, 1);
  assert.deepEqual([...stored.values()], ["2026-10-30"]);

  page.leave();
  context.mock.timers.setTime(NOON_OCTOBER_30 + DAY_MS);
  page.comeBack();
  await settle();
  assert.equal(counts.sent, 2);
  assert.deepEqual([...stored.values()], ["2026-10-31"]);

  page.leave();
  context.mock.timers.setTime(NOON_OCTOBER_30 + DAY_MS + HOUR_MS);
  page.comeBack();
  await settle();
  assert.equal(counts.sent, 2);
});

test("a count whose send fails keeps no day, and the next return sends it again", async (context) => {
  const stored = new Map();
  const page = createFakePage();
  let isOffline = true;
  const { counts, fetch } = createCountFetch(async () => {
    if (isOffline) throw new TypeError("Load failed");
    return new Response(null, { status: 204 });
  });
  const now = NOON_OCTOBER_30 + 3 * DAY_MS;
  context.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now });
  replaceGlobals(context, {
    ...page.globals,
    localStorage: createFakeStorage(stored),
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch,
  });
  watchReturns();

  startDailyCount();
  await settle();
  assert.equal(counts.sent, 1);
  assert.equal(stored.size, 0);

  isOffline = false;
  page.leave();
  context.mock.timers.setTime(now + HOUR_MS);
  page.comeBack();
  await settle();
  assert.equal(counts.sent, 2);
  assert.deepEqual([...stored.values()], ["2026-11-02"]);
});

test("a count whose send never answers gives up in time, and the next return sends it again", async (context) => {
  const page = createFakePage();
  const timeout = new AbortController();
  const timeoutsAsked = [];
  context.mock.method(AbortSignal, "timeout", (milliseconds) => {
    timeoutsAsked.push(milliseconds);
    return timeout.signal;
  });
  let isHanging = true;
  const { counts, fetch } = createCountFetch(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  const hangingFetch = (url, init) => {
    if (!String(url).endsWith("/count") || !isHanging) return fetch(url);
    counts.sent += 1;
    return new Promise((resolve, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason)),
    );
  };
  const now = NOON_OCTOBER_30 + 4 * DAY_MS;
  context.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now });
  replaceGlobals(context, {
    ...page.globals,
    localStorage: createFakeStorage(new Map()),
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch: hangingFetch,
  });
  watchReturns();

  startDailyCount();
  assert.deepEqual(timeoutsAsked, [WAKING_REQUEST_TIMEOUT_MS]);
  isHanging = false;
  timeout.abort(new DOMException("timed out", "TimeoutError"));
  await settle();

  page.leave();
  context.mock.timers.setTime(now + HOUR_MS);
  page.comeBack();
  await settle();
  assert.equal(counts.sent, 2);
});

test("a browser whose storage keeps an older day but refuses today's counts once that day", async (context) => {
  const page = createFakePage();
  const { counts, fetch } = createCountFetch(async () => new Response(null, { status: 204 }));
  const now = NOON_OCTOBER_30 + 5 * DAY_MS;
  context.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now });
  replaceGlobals(context, {
    ...page.globals,
    localStorage: {
      getItem: () => "2026-11-03",
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    },
    location: { href: "https://worker.example/k3y/" },
    navigator: { webdriver: false },
    fetch,
  });
  watchReturns();

  startDailyCount();
  await settle();
  assert.equal(counts.sent, 1);

  page.leave();
  context.mock.timers.setTime(now + HOUR_MS);
  page.comeBack();
  await settle();
  assert.equal(counts.sent, 1);
});
