import test from "node:test";
import assert from "node:assert/strict";
import { createRateBudget, parseRetryAfter, parseReset } from "../worker/codex-rate-budget.mjs";
import { createRateClock } from "./codex-rate-clock.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const policy = { tokens: 100, requests: 100, windowMs: 60000, spacingMs: 0 };

test("FIFO queue time belongs to each caller's admission deadline", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, requests: 1, maxWaitMs: 100 }, clock);
  await budget.reserve(1);
  const outcomes = [];
  const queued = [1, 2].map(() =>
    budget.reserve(1).then(
      () => outcomes.push("admitted"),
      (error) => outcomes.push(/wait budget/.test(error.message) ? "expired" : "other"),
    ),
  );
  await tick();
  await clock.advance(100);
  const atDeadline = [...outcomes];
  await clock.advance(200);
  await Promise.all(queued);
  assert.deepEqual(atDeadline, ["expired", "expired"]);
});

test("a caller cancelled behind another waiter rejects before its predecessor", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, requests: 1, maxWaitMs: 100 }, clock);
  await budget.reserve(1);
  const first = budget.reserve(1).catch(() => {});
  const controller = new AbortController();
  let cancelled = false;
  const second = budget.reserve(1, controller.signal).catch(() => {
    cancelled = true;
  });
  await tick();
  controller.abort();
  await tick();
  const immediatelyCancelled = cancelled;
  await clock.advance(100);
  await clock.advance(200);
  await Promise.all([first, second]);
  assert.equal(immediatelyCancelled, true);
});

test("cancelled queued admission makes no reservation and releases its timer", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, requests: 1 }, clock);
  budget.settle(await budget.reserve(1), 1);
  const controller = new AbortController();
  const result = assert.rejects(budget.reserve(1, controller.signal), /abort/);
  await tick();
  controller.abort();
  await result;
  assert.equal(budget.readSnapshot().events.length, 1);
});

test("request count blocks a low-token burst until the window expires", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, requests: 1 }, clock);
  budget.settle(await budget.reserve(1), 1);
  let admitted = false;
  const next = budget.reserve(1).then((id) => {
    admitted = true;
    return id;
  });
  await tick();
  await clock.advance(59999);
  assert.equal(admitted, false);
  await clock.advance(60000);
  await next;
  assert.equal(admitted, true);
});

test("request spacing prevents a burst even when both budgets have capacity", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, spacingMs: 250 }, clock);
  budget.settle(await budget.reserve(1), 1);
  let admitted = false;
  const next = budget.reserve(1).then((id) => {
    admitted = true;
    return id;
  });
  await tick();
  await clock.advance(249);
  assert.equal(admitted, false);
  await clock.advance(250);
  await next;
  assert.equal(admitted, true);
});

test("an unresolved request exhausts admission wait instead of freeing unknown usage", async () => {
  const clock = createRateClock();
  const budget = createRateBudget({ ...policy, requests: 1, maxWaitMs: 100 }, clock);
  await budget.reserve(1);
  const next = assert.rejects(budget.reserve(1), /wait budget exhausted/);
  await tick();
  await clock.advance(100);
  await next;
  assert.equal(budget.readSnapshot().events[0].settled, false);
  assert.equal(budget.readSnapshot().events[0].observed, null);
});

test("bursts and rolling-window expiry cannot oversubscribe token capacity", async () => {
  const clock = createRateClock();
  const budget = createRateBudget(policy, clock);
  const first = await budget.reserve(80);
  budget.settle(first, 80);
  let admitted = false;
  const next = budget.reserve(30).then((id) => {
    admitted = true;
    return id;
  });
  await tick();
  await clock.advance(59999);
  assert.equal(admitted, false);
  await clock.advance(60000);
  budget.settle(await next, 30);
  assert.equal(admitted, true);
});

test("concurrent admission reserves atomically and actual lower usage wakes the next waiter", async () => {
  const clock = createRateClock();
  const budget = createRateBudget(policy, clock);
  const first = await budget.reserve(70);
  let admitted = false;
  const next = budget.reserve(60).then((id) => {
    admitted = true;
    return id;
  });
  await tick();
  assert.equal(admitted, false);
  budget.settle(first, 20);
  await tick();
  budget.settle(await next, 60);
  assert.equal(
    budget.readSnapshot().events.reduce((sum, event) => sum + event.charge, 0),
    80,
  );
});

test("unknown usage retains its reservation and is never exported as observed zero", async () => {
  const clock = createRateClock();
  const budget = createRateBudget(policy, clock);
  const first = await budget.reserve(100);
  budget.settle(first, null);
  assert.equal(budget.readSnapshot().events[0].charge, 100);
  assert.equal(budget.readSnapshot().events[0].observed, null);
  let admitted = false;
  const next = budget.reserve(1).then((id) => {
    admitted = true;
    return id;
  });
  await clock.advance(59999);
  assert.equal(admitted, false);
  await clock.advance(60000);
  await next;
});

test("observed overshoot becomes debt rather than being truncated to an estimate", async () => {
  const clock = createRateClock();
  const budget = createRateBudget(policy, clock);
  budget.settle(await budget.reserve(10), 120);
  assert.equal(budget.readSnapshot().events[0].charge, 120);
  const next = budget.reserve(1);
  await tick();
  await clock.advance(60000);
  await next;
});

test("Retry-After seconds, dates, milliseconds and token-reset durations preserve deadlines", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assert.equal(parseRetryAfter(new Headers({ "retry-after": "3" }), now), now + 3000);
  assert.equal(
    parseRetryAfter(new Headers({ "retry-after": "Wed, 28 Oct 2026 12:00:04 GMT" }), now),
    now + 4000,
  );
  assert.equal(parseRetryAfter(new Headers({ "retry-after-ms": "250" }), now), now + 250);
  assert.equal(parseReset("1m2.5s", now), now + 62500);
  assert.equal(parseReset("-1s", now), null);
  assert.equal(parseReset("garbage", now), null);
  assert.equal(parseRetryAfter(new Headers({ "retry-after": "9".repeat(400) }), now), null);
  assert.equal(parseRetryAfter(new Headers({ "retry-after-ms": "9007199254740991" }), now), null);
  assert.equal(parseReset("9007199254740s", now), null);
});

test("oversized request reservations reject before admission", async () => {
  const budget = createRateBudget(policy);
  await assert.rejects(budget.reserve(101), /exceeds/);
});
