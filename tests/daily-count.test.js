import { test } from "node:test";
import assert from "node:assert/strict";
import { isCountOwed, startDailyCount } from "../shared/page/daily-count.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Midnight in New York on October 28, 2026, while it keeps Eastern Daylight Time.
const EASTERN_MIDNIGHT = Date.parse("2026-10-28T04:00:00Z");

test("a count is owed once each Eastern day, whatever the device's clock says of the day", () => {
  const counted = { countedDay: "2026-10-27", isAutomated: false };
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT - 20 * HOUR_MS }), false);
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT - 1 }), false);
  assert.equal(isCountOwed({ ...counted, now: EASTERN_MIDNIGHT }), true);
});

test("a count is owed on a device never counted, and on a return after days away", () => {
  assert.equal(isCountOwed({ countedDay: null, now: EASTERN_MIDNIGHT, isAutomated: false }), true);
  assert.equal(
    isCountOwed({
      countedDay: "2026-10-28",
      now: EASTERN_MIDNIGHT + 3 * DAY_MS,
      isAutomated: false,
    }),
    true,
  );
});

test("an automated browser is never counted", () => {
  assert.equal(isCountOwed({ countedDay: null, now: EASTERN_MIDNIGHT, isAutomated: true }), false);
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

test("a device sends one empty POST a day, and keeps the day only once the Worker takes it", async (context) => {
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
  assert.deepEqual(sent, [{ url: "https://worker.example/k3y/count", init: { method: "POST" } }]);
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

test("a device whose storage refuses sends one count while one is out, and one a load", async (context) => {
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
